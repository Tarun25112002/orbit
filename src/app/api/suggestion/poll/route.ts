import { type NextRequest, NextResponse } from "next/server";
import { suggestionRuntime } from "@/lib/completion-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get("requestId")?.trim();
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!requestId || !token) {
    return NextResponse.json(
      {
        error: "Missing requestId or token.",
      },
      { status: 400 },
    );
  }

  const record = suggestionRuntime.validateRequest(requestId, token);
  if (!record) {
    return NextResponse.json(
      {
        error: "Suggestion request not found.",
      },
      { status: 404 },
    );
  }

  const payload = suggestionRuntime.toApiResponse(record);
  if (record.status === "completed") {
    return NextResponse.json(payload);
  }

  if (record.status === "failed") {
    return NextResponse.json(payload, {
      status: record.retryAfterSeconds ? 429 : 500,
      headers: record.retryAfterSeconds
        ? {
            "Retry-After": String(Math.ceil(record.retryAfterSeconds)),
          }
        : undefined,
    });
  }

  return NextResponse.json(payload, { status: 202 });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
