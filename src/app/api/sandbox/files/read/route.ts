import { NextRequest, NextResponse } from "next/server";
import { readFileFromContainer } from "@/lib/docker/file-sync";
import { getClerkUserId } from "@/lib/clerk-auth";
import { assertSandboxSessionOwner } from "@/lib/docker/sandbox-session-auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await getClerkUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const sessionId = searchParams.get("sessionId");
    const filePath = searchParams.get("filePath");

    if (!sessionId || !filePath) {
      return NextResponse.json(
        { error: "sessionId and filePath query params are required" },
        { status: 400 },
      );
    }

    try {
      assertSandboxSessionOwner(sessionId, userId);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const content = await readFileFromContainer(sessionId, filePath);

    if (content === null) {
      return NextResponse.json(
        { error: "File not found", content: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ content });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read file";
    console.error("[sandbox/files/read]", message);

    if (
      /\bsession\b[\s\S]*\bnot found\b/i.test(message) ||
      /\bno such container\b|\bcontainer\b[\s\S]*\bnot found\b/i.test(message)
    ) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
