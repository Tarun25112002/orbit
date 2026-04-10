import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
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

  try {
    await convex.mutation(api.system.updateMessageContent, {
      messageId: parsed.data.messageId as Id<"messages">,
      content: parsed.data.content,
      status: parsed.data.status,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const classified = classifyError(error);
    return NextResponse.json(
      { error: classified.message },
      { status: 500 },
    );
  }
}
