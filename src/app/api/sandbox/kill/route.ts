/**
 * POST /api/sandbox/kill — Destroy a sandbox session.
 */

import { NextRequest, NextResponse } from "next/server";
import { killSession } from "@/lib/docker/session-manager";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sessionId?: string };

    if (!body.sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    await killSession(body.sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to kill sandbox";
    console.error("[sandbox/kill]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
