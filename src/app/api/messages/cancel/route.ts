import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { inngest } from "@/inngest/client";
import { getClerkUserIdAndToken } from "@/lib/clerk-auth";
import { classifyError } from "@/lib/errors";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  assistantMessageId: z.string().min(1),
});

export async function POST(request: NextRequest) {
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

  const { assistantMessageId } = parsed.data;

  try {
    const authContext = await getClerkUserIdAndToken(request);
    if (!authContext) {
      return NextResponse.json(
        { error: "Please sign in to continue." },
        { status: 401 },
      );
    }

    const { userId: resolvedUserId, convexToken } = authContext;

    const userConvex = new ConvexHttpClient(
      process.env.NEXT_PUBLIC_CONVEX_URL!,
    );
    userConvex.setAuth(convexToken);

    const assistantMessage = await userConvex.query(api.system.getMessageById, {
      messageId: assistantMessageId as Id<"messages">,
    });

    if (!assistantMessage || assistantMessage.role !== "assistant") {
      return NextResponse.json(
        { error: "Assistant message not found." },
        { status: 404 },
      );
    }

    await userConvex.query(api.conversations.getById, {
      id: assistantMessage.conversationId,
    });

    const cancelled = await userConvex.mutation(api.system.cancelMessage, {
      messageId: assistantMessageId as Id<"messages">,
    });

    await inngest.send({
      name: "orbit/conversation.message.cancelled",
      id: `${assistantMessageId}:cancel`,
      data: {
        assistantMessageId,
        userId: resolvedUserId,
      },
    });

    return NextResponse.json({
      success: true,
      cancelled,
      assistantMessageId,
    });
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
