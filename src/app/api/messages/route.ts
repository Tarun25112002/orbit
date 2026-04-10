import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { firecrawl } from "@/lib/firecrawl";
import { generateGeminiCompletion, GEMINI_MODEL_DEFAULT, type GeminiChatMessage } from "@/lib/gemini";

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string().min(1),
});

const GEMINI_MODEL = GEMINI_MODEL_DEFAULT;
const URL_REGEX = /https?:\/\/[^\s]+/g;
const MAX_FILE_CONTEXT_CHARS = 60_000;
const MAX_HISTORY_MESSAGES = 40;

const buildFileTree = (
  files: Array<{ name: string; type: string; parentId?: string | null; _id: string }>,
): string => {
  const childrenMap = new Map<string | null, typeof files>();

  for (const file of files) {
    const parentKey = file.parentId ?? null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(file);
  }

  const renderNode = (id: string | null, indent: number): string[] => {
    const children = childrenMap.get(id) ?? [];
    children.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name);
    });

    const lines: string[] = [];
    for (const child of children) {
      const prefix = "  ".repeat(indent);
      const icon = child.type === "folder" ? "📁" : "📄";
      lines.push(`${prefix}${icon} ${child.name}`);
      if (child.type === "folder") {
        lines.push(...renderNode(child._id, indent + 1));
      }
    }
    return lines;
  };

  return renderNode(null, 0).join("\n");
};

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { conversationId, message } = parsed.data;

  const conversation = await convex.query(api.system.getConversationById, {
    conversationId: conversationId as Id<"conversations">,
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  try {
    // 1. Fetch conversation history
    const existingMessages = await convex.query(
      api.system.getMessagesByConversation,
      { conversationId: conversationId as Id<"conversations"> },
    );

    // 2. Fetch project files for context
    const projectFiles = await convex.query(api.system.getProjectFiles, {
      projectId: conversation.projectId,
    });

    // 3. Build file tree context
    const fileTree = buildFileTree(
      projectFiles.map((f) => ({
        name: f.name,
        type: f.type,
        parentId: f.parentId ?? null,
        _id: f._id,
      })),
    );

    // 4. Gather file contents for context (limit total size)
    let fileContextChars = 0;
    const fileContents: string[] = [];
    for (const file of projectFiles) {
      if (file.type !== "file" || !file.content) continue;
      if (fileContextChars + file.content.length > MAX_FILE_CONTEXT_CHARS)
        break;
      fileContents.push(`--- ${file.name} ---\n${file.content}`);
      fileContextChars += file.content.length;
    }

    // 5. Scrape any URLs in the user message
    const urls = message.match(URL_REGEX) ?? [];
    let scrapedContent = "";
    if (urls.length > 0) {
      try {
        const results = await Promise.all(
          urls.slice(0, 3).map(async (url) => {
            try {
              const result = await firecrawl.scrape(url, {
                formats: ["markdown"],
                maxAge: 3600000,
                fastMode: true,
              });
              return result.markdown ?? null;
            } catch {
              return null;
            }
          }),
        );
        scrapedContent = results.filter(Boolean).join("\n\n");
      } catch {
        // URL scraping is best-effort
      }
    }

    // 6. Build the messages array for Gemini
    const systemContext = [
      "You are Orbit AI, an intelligent coding assistant embedded in the Orbit code editor.",
      "You help developers write, debug, refactor, and understand code.",
      "Be concise, accurate, and helpful. Provide code examples when relevant.",
      "Use markdown formatting for code blocks, lists, and emphasis.",
      "",
      "Project file structure:",
      fileTree || "(empty project)",
      ...(fileContents.length > 0
        ? ["", "Key project files:", ...fileContents]
        : []),
      ...(scrapedContent
        ? ["", "Scraped URL content:", scrapedContent]
        : []),
    ].join("\n");

    const geminiMessages: GeminiChatMessage[] = [];

    // Add conversation history
    const historyMessages = existingMessages
      .filter((m) => m.content && m.status !== "processing" && m.status !== "failed")
      .slice(-MAX_HISTORY_MESSAGES);

    for (const msg of historyMessages) {
      geminiMessages.push({
        role: msg.role === "assistant" ? "model" : "user",
        content: msg.content,
      });
    }

    // Add the current user message with system context prepended
    const userContent = historyMessages.length === 0
      ? `${systemContext}\n\n${message}`
      : message;
    geminiMessages.push({ role: "user", content: userContent });

    // If this is the first message, prepend system context
    if (historyMessages.length > 0 && geminiMessages[0]?.role !== "user") {
      // Ensure conversation starts with user turn for Gemini
      geminiMessages.unshift({
        role: "user",
        content: systemContext,
      });
      geminiMessages.splice(1, 0, {
        role: "model",
        content: "Understood. I'm Orbit AI, ready to help with your code.",
      });
    }

    // 7. Call Gemini
    const completion = await generateGeminiCompletion({
      model: GEMINI_MODEL,
      messages: geminiMessages,
    });

    // 8. Return response
    return NextResponse.json({
      content: completion.content,
      conversationId,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 },
    );
  }
}