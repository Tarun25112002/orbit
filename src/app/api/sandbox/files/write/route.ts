import { NextRequest, NextResponse } from "next/server";
import {
  syncProjectToContainer,
  syncFileToContainer,
} from "@/lib/docker/file-sync";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      filePath?: string;
      content?: string;
      files?: Array<{ path: string; content: string }>;
    };

    if (!body.sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    if (body.files && Array.isArray(body.files)) {
      await syncProjectToContainer(body.sessionId, body.files);
      return NextResponse.json({
        success: true,
        synced: body.files.length,
      });
    }

    if (body.filePath && typeof body.content === "string") {
      await syncFileToContainer(body.sessionId, body.filePath, body.content);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Provide either 'files' array or 'filePath' + 'content'" },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to write files";
    console.error("[sandbox/files/write]", message);

    if (
      /\bsession\b[\s\S]*\bnot found\b/i.test(message) ||
      /\bno such container\b|\bcontainer\b[\s\S]*\bnot found\b/i.test(message)
    ) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
