import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { classifyError } from "@/lib/errors";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  assistantMessageId: z.string().min(1),
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

  const { assistantMessageId } = parsed.data;

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

    const assistantMessage = await convex.query(api.system.getMessageById, {
      messageId: assistantMessageId as Id<"messages">,
    });

    if (!assistantMessage || assistantMessage.role !== "assistant") {
      return NextResponse.json(
        { error: "Assistant message not found." },
        { status: 404 },
      );
    }

    const userConvex = new ConvexHttpClient(
      process.env.NEXT_PUBLIC_CONVEX_URL!,
    );
    userConvex.setAuth(convexToken);

    await userConvex.query(api.conversations.getById, {
      id: assistantMessage.conversationId,
    });

    const cancelled = await convex.mutation(api.system.cancelMessage, {
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
