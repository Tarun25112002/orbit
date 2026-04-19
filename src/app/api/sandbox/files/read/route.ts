/**
 * GET /api/sandbox/files/read — Read a file from the container.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileFromContainer } from "@/lib/docker/file-sync";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const sessionId = searchParams.get("sessionId");
    const filePath = searchParams.get("filePath");

    if (!sessionId || !filePath) {
      return NextResponse.json(
        { error: "sessionId and filePath query params are required" },
        { status: 400 },
      );
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

    if (/\bsession\b[\s\S]*\bnot found\b/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
