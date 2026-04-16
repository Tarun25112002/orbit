import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { classifyError } from "@/lib/errors";

const requestSchema = z.object({
  messageId: z.string(),
  content: z.string(),
  status: z.enum(["completed", "failed"]),
});

export async function POST(request: Request) {
  const { getToken } = await auth();

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

  try {
    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) {
      return NextResponse.json(
        { error: "Please sign in to continue." },
        { status: 401 },
      );
    }

    const message = await convex.query(api.system.getMessageById, {
      messageId: parsed.data.messageId as Id<"messages">,
    });

    if (!message || message.role !== "assistant") {
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
      id: message.conversationId,
    });

    await convex.mutation(api.system.updateMessageContent, {
      messageId: parsed.data.messageId as Id<"messages">,
      content: parsed.data.content,
      status: parsed.data.status,
    });

    return NextResponse.json({ success: true });
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
