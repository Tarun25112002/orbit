import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { classifyError } from "@/lib/errors";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  conversationId: z.string().min(1),
  userMessageId: z.string().min(1),
  assistantMessageId: z.string().min(1),
  message: z.string().min(1),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Please sign in to continue." },
      { status: 401 },
    );
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

  const { conversationId, userMessageId, assistantMessageId, message } =
    parsed.data;

  try {
    const conversation = await convex.query(api.system.getConversationById, {
      conversationId: conversationId as Id<"conversations">,
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    await inngest.send({
      name: "orbit/conversation.message.requested",
      id: assistantMessageId,
      data: {
        conversationId,
        userMessageId,
        assistantMessageId,
        message,
        userId,
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
