import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { suggestionRuntime } from "@/lib/completion-runtime";
import {
  generateGeminiCompletion,
  GEMINI_MODEL_DEFAULT,
  type GeminiChatMessage,
} from "@/lib/gemini";
import { classifyError } from "@/lib/errors";
import { buildWebContextFromText } from "@/lib/web-context";
import {
  generateSuggestion,
  type ParsedSuggestionInput,
} from "@/lib/suggestion-engine";
import type { SuggestionMode } from "@/lib/code-suggestion";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const GEMINI_MODEL = GEMINI_MODEL_DEFAULT;
const MAX_FILE_CONTEXT_CHARS = 60_000;
const MAX_HISTORY_MESSAGES = 40;

type ProjectFileTreeNode = {
  name: string;
  type: string;
  parentId?: string | null;
  _id: string;
};

const buildFileTree = (files: ProjectFileTreeNode[]): string => {
  const childrenMap = new Map<string | null, ProjectFileTreeNode[]>();

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
      const label = child.type === "folder" ? "[folder]" : "[file]";
      lines.push(`${prefix}${label} ${child.name}`);
      if (child.type === "folder") {
        lines.push(...renderNode(child._id, indent + 1));
      }
    }
    return lines;
  };

  return renderNode(null, 0).join("\n");
};

const appendGeminiMessage = (
  messages: GeminiChatMessage[],
  nextMessage: GeminiChatMessage,
) => {
  const previousMessage = messages.at(-1);
  if (previousMessage?.role === nextMessage.role) {
    previousMessage.content = `${previousMessage.content}\n\n${nextMessage.content}`;
    return;
  }

  messages.push(nextMessage);
};

export const orbit = inngest.createFunction(
  { id: "orbit-generate", triggers: [{ event: "orbit/generate" }] },
  async ({ event, step }) => {
    const { prompt } = event.data as { prompt: string };

    const webContext = await step.run("scrape-web-context", async () => {
      return await buildWebContextFromText(prompt);
    });

    const finalPrompt = webContext.markdown
      ? `Web context from referenced URLs:\n${webContext.markdown}\n\nQuestion: ${prompt}`
      : prompt;

    return await step.run("generate-text", async () => {
      const completion = await generateGeminiCompletion({
        model: GEMINI_MODEL,
        messages: [{ role: "user", content: finalPrompt }],
      });

      return {
        model: GEMINI_MODEL,
        content: completion.content,
      };
    });
  },
);

type CodeCompletionRequestedEvent = {
  requestId: string;
  fingerprint: string;
  mode: SuggestionMode;
  input: ParsedSuggestionInput;
};

type ConversationMessageRequestedEvent = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  message: string;
  userId: string;
};

const updateAssistantMessage = async (args: {
  assistantMessageId: string;
  content: string;
  status: "completed" | "failed";
}) => {
  await convex.mutation(api.system.updateMessageContent, {
    messageId: args.assistantMessageId as Id<"messages">,
    content: args.content,
    status: args.status,
  });
};

export const conversationMessageRequested = inngest.createFunction(
  {
    id: "orbit-conversation-message-requested",
    triggers: [{ event: "orbit/conversation.message.requested" }],
    concurrency: {
      limit: Number.parseInt(
        process.env.CONVERSATION_PROCESSING_CONCURRENCY ?? "4",
        10,
      ),
    },
    retries: 0,
  },
  async ({ event, step }) => {
    const payload = event.data as ConversationMessageRequestedEvent;
    const { conversationId, userMessageId, assistantMessageId, message } =
      payload;

    try {
      const conversation = await step.run("load-conversation", async () => {
        return await convex.query(api.system.getConversationById, {
          conversationId: conversationId as Id<"conversations">,
        });
      });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      const existingMessages = await step.run("load-message-history", async () => {
        return await convex.query(api.system.getMessagesByConversation, {
          conversationId: conversationId as Id<"conversations">,
        });
      });

      const projectFiles = await step.run("load-project-files", async () => {
        return await convex.query(api.system.getProjectFiles, {
          projectId: conversation.projectId,
        });
      });

      const projectContext = await step.run("build-project-context", async () => {
        const fileTree = buildFileTree(
          projectFiles.map((file) => ({
            name: file.name,
            type: file.type,
            parentId: file.parentId ?? null,
            _id: file._id,
          })),
        );

        let fileContextChars = 0;
        const fileContents: string[] = [];

        for (const file of projectFiles) {
          if (file.type !== "file" || !file.content) continue;
          if (fileContextChars + file.content.length > MAX_FILE_CONTEXT_CHARS) {
            break;
          }

          fileContents.push(`--- ${file.name} ---\n${file.content}`);
          fileContextChars += file.content.length;
        }

        return { fileTree, fileContents };
      });

      const webContext = await step.run("scrape-message-web-context", async () => {
        return await buildWebContextFromText(message);
      });

      const systemContext = [
        "You are Orbit AI, an intelligent coding assistant embedded in the Orbit code editor.",
        "You help developers write, debug, refactor, and understand code.",
        "Be concise, accurate, and helpful. Provide code examples when relevant.",
        "Use markdown formatting for code blocks, lists, and emphasis.",
        "",
        "Project file structure:",
        projectContext.fileTree || "(empty project)",
        ...(projectContext.fileContents.length > 0
          ? ["", "Key project files:", ...projectContext.fileContents]
          : []),
        ...(webContext.markdown
          ? ["", "Web context from referenced URLs:", webContext.markdown]
          : []),
      ].join("\n");

      const historyMessages = existingMessages
        .filter((historyMessage) => {
          if (!historyMessage.content) return false;
          if (historyMessage.status === "processing") return false;
          if (historyMessage.status === "failed") return false;
          if (historyMessage._id === userMessageId) return false;
          if (historyMessage._id === assistantMessageId) return false;
          return true;
        })
        .slice(-MAX_HISTORY_MESSAGES);

      const geminiMessages: GeminiChatMessage[] = [];

      for (const historyMessage of historyMessages) {
        appendGeminiMessage(geminiMessages, {
          role: historyMessage.role === "assistant" ? "model" : "user",
          content: historyMessage.content,
        });
      }

      appendGeminiMessage(geminiMessages, {
        role: "user",
        content: `${systemContext}\n\nUser request:\n${message}`,
      });

      const completion = await step.run("generate-conversation-reply", async () => {
        return await generateGeminiCompletion({
          model: GEMINI_MODEL,
          messages: geminiMessages,
        });
      });

      await step.run("save-assistant-message", async () => {
        await updateAssistantMessage({
          assistantMessageId,
          content: completion.content,
          status: "completed",
        });
      });

      return {
        conversationId,
        assistantMessageId,
        model: completion.model,
        status: "completed",
      };
    } catch (error) {
      const classified = classifyError(error);

      try {
        await step.run("save-assistant-message-error", async () => {
          await updateAssistantMessage({
            assistantMessageId,
            content: classified.message,
            status: "failed",
          });
        });
      } catch (updateError) {
        console.error("conversation.message.error-save-failed", updateError);
      }

      throw error;
    }
  },
);

export const codeCompletionRequested = inngest.createFunction(
  {
    id: "orbit-code-completion-requested",
    triggers: [{ event: "orbit/code-completion.requested" }],
    concurrency: {
      limit: Number.parseInt(
        process.env.SUGGESTION_PROCESSING_CONCURRENCY ?? "4",
        10,
      ),
    },
    rateLimit: {
      limit: Number.parseInt(
        process.env.SUGGESTION_PROCESSING_RATE_LIMIT ?? "180",
        10,
      ),
      period: "1m",
    },
    retries: 0,
  },
  async ({ event, step }) => {
    const payload = event.data as CodeCompletionRequestedEvent;
    const requestId = payload.requestId;

    suggestionRuntime.markProcessing(requestId);

    try {
      const generation = await step.run("generate-code-suggestion", () =>
        generateSuggestion(payload.mode, payload.input, {
          onRetry: ({ attempt, error }) => {
            suggestionRuntime.markRetrying(requestId, attempt, error.message);
          },
        }),
      );

      suggestionRuntime.complete({
        requestId,
        suggestion: generation.suggestion,
        model: generation.modelName,
        attempts: generation.attempts,
        latencyMs: generation.latencyMs,
      });

      return generation;
    } catch (error) {
      suggestionRuntime.fail({
        requestId,
        error,
      });
      throw error;
    }
  },
);
