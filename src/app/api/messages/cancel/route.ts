import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { classifyError } from "@/lib/errors";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  assistantMessageId: z.string().min(1),
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

  const { assistantMessageId } = parsed.data;

  try {
    const cancelled = await convex.mutation(api.system.cancelMessage, {
      messageId: assistantMessageId as Id<"messages">,
    });

    await inngest.send({
      name: "orbit/conversation.message.cancelled",
      id: `${assistantMessageId}:cancel`,
      data: {
        assistantMessageId,
        userId,
      },
    });

    return NextResponse.json({
      success: true,
      cancelled,
      assistantMessageId,
    });
  } catch (error) {
    const classified = classifyError(error);
    return NextResponse.json(
      { error: classified.message },
      { status: 500 },
    );
  }
}
