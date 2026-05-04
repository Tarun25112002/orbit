import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  type SandboxRuntime,
} from "@/lib/docker/session-manager";
import { ensureCapacity } from "@/lib/docker/resource-guard";
import { getClerkUserId } from "@/lib/clerk-auth";
import { registerSandboxSession } from "@/lib/docker/sandbox-session-auth";

const VALID_RUNTIMES = new Set<SandboxRuntime>(["node", "python", "bash"]);

export async function POST(request: NextRequest) {
  try {
    const userId = await getClerkUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      sessionId?: string;
      runtime?: string;
      projectKey?: string;
    };

    const { sessionId, runtime, projectKey } = body;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    if (!runtime || !VALID_RUNTIMES.has(runtime as SandboxRuntime)) {
      return NextResponse.json(
        { error: `runtime must be one of: ${[...VALID_RUNTIMES].join(", ")}` },
        { status: 400 },
      );
    }

    const hasCapacity = await ensureCapacity();
    if (!hasCapacity) {
      return NextResponse.json(
        { error: "Server is at maximum capacity. Try again later." },
        { status: 503 },
      );
    }

    const normalizedProjectKey =
      typeof projectKey === "string" && projectKey.trim().length > 0
        ? projectKey.trim().slice(0, 120)
        : undefined;

    const result = await createSession(sessionId, runtime as SandboxRuntime, {
      projectKey: normalizedProjectKey,
    });

    registerSandboxSession(result.sessionId, userId);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create sandbox";
    console.error("[sandbox/create]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
