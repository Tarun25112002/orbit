import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { inngest } from "@/inngest/client";
import { classifyError } from "@/lib/errors";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  conversationId: z.string().min(1),
  userMessageId: z.string().min(1),
  assistantMessageId: z.string().min(1),
  message: z.string().min(1),
  activeFilePath: z.string().trim().min(1).max(512).optional(),
  activeFolderPath: z.string().trim().min(1).max(512).optional(),
});

const resolveSubjectFromJwt = (token: string) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as { sub?: unknown };

    return typeof parsed.sub === "string" && parsed.sub.trim()
      ? parsed.sub
      : null;
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  const { userId, getToken } = await auth();

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

  const {
    conversationId,
    userMessageId,
    assistantMessageId,
    message,
    activeFilePath,
    activeFolderPath,
  } = parsed.data;

  try {
    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) {
      return NextResponse.json(
        { error: "Please sign in to continue." },
        { status: 401 },
      );
    }

    const resolvedUserId = userId ?? resolveSubjectFromJwt(convexToken);
    if (!resolvedUserId) {
      return NextResponse.json(
        { error: "Could not verify workspace access." },
        { status: 401 },
      );
    }

    const userConvex = new ConvexHttpClient(
      process.env.NEXT_PUBLIC_CONVEX_URL!,
    );
    userConvex.setAuth(convexToken);

    const conversation = await userConvex.query(api.conversations.getById, {
      id: conversationId as Id<"conversations">,
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // ── Check AI usage limits ──────────────────────────────────────────────
    const aiAccess = await userConvex.query(api.projects.checkAiAccess, {});
    if (!aiAccess.allowed) {
      return NextResponse.json(
        {
          error: `AI limit reached. You've used ${aiAccess.count}/${aiAccess.limit} projects on the ${aiAccess.tier} plan. Please upgrade to continue using AI.`,
          code: "AI_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }

    const conversationMessages = await userConvex.query(
      api.conversations.getMessages,
      {
        conversationId: conversationId as Id<"conversations">,
      },
    );

    const userMessage = conversationMessages.find(
      (candidate) => candidate._id === (userMessageId as Id<"messages">),
    );
    const assistantMessage = conversationMessages.find(
      (candidate) => candidate._id === (assistantMessageId as Id<"messages">),
    );

    if (!userMessage || userMessage.role !== "user") {
      return NextResponse.json(
        { error: "User message was not found in this conversation." },
        { status: 400 },
      );
    }

    if (!assistantMessage || assistantMessage.role !== "assistant") {
      return NextResponse.json(
        { error: "Assistant message was not found in this conversation." },
        { status: 400 },
      );
    }

    if (assistantMessage.status !== "processing") {
      return NextResponse.json(
        { error: "Assistant message is no longer processing." },
        { status: 409 },
      );
    }

    await inngest.send({
      name: "orbit/conversation.message.requested",
      id: assistantMessageId,
      data: {
        conversationId,
        userMessageId,
        assistantMessageId,
        message: userMessage.content.trim() || message,
        activeFilePath,
        activeFolderPath,
        userId: resolvedUserId,
      },
    });

    return NextResponse.json(
      {
        status: "queued",
        conversationId,
        assistantMessageId,
      },
      { status: 202 },
    );
  } catch (error) {
    const classified = classifyError(error);
    const statusCode =
      classified.category === "rate_limit" ||
      classified.category === "quota_exceeded"
        ? 429
        : classified.category === "auth"
          ? 401
          : classified.category === "timeout"
            ? 504
            : 500;

    return NextResponse.json(
      { error: classified.message },
      {
        status: statusCode,
        ...(classified.retryAfterSeconds
          ? {
              headers: {
                "Retry-After": String(classified.retryAfterSeconds),
              },
            }
          : {}),
      },
    );
  }
}
