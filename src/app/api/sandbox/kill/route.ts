import { NextRequest, NextResponse } from "next/server";
import { killSession } from "@/lib/docker/session-manager";
import { getClerkUserId } from "@/lib/clerk-auth";
import {
  assertSandboxSessionOwner,
  releaseSandboxSession,
} from "@/lib/docker/sandbox-session-auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await getClerkUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { sessionId?: string };

    if (!body.sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    try {
      assertSandboxSessionOwner(body.sessionId, userId);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await killSession(body.sessionId);
    releaseSandboxSession(body.sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to kill sandbox";
    console.error("[sandbox/kill]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
