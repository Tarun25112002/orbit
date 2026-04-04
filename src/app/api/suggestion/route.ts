import { type NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { inngest } from "@/inngest/client";
import { suggestionRuntime } from "@/lib/completion-runtime";
import type { SuggestionRequestBody } from "@/lib/code-suggestion";
import { prepareSuggestionRequest } from "@/lib/suggestion-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const getSessionKey = (request: NextRequest) => {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown";
  return `${ip}:${userAgent}`;
};

const buildAsyncResponse = (requestId: string, token: string) => ({
  requestId,
  token,
  status: "queued" as const,
  execution: "inngest" as const,
  streamUrl: `/api/suggestion/stream?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(token)}`,
  pollUrl: `/api/suggestion/poll?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(token)}`,
});

export async function POST(request: NextRequest) {
  let body: SuggestionRequestBody;

  try {
    body = (await request.json()) as SuggestionRequestBody;
  } catch {
    return NextResponse.json(
      {
        error: "Invalid request body",
      },
      { status: 400 },
    );
  }

  let prepared;
  try {
    prepared = prepareSuggestionRequest(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    throw error;
  }

  const cached = suggestionRuntime.getCached(prepared.fingerprint);
  if (cached) {
    return NextResponse.json(
      suggestionRuntime.createCachedResponse({
        fingerprint: prepared.fingerprint,
        mode: prepared.mode,
        suggestion: cached.suggestion,
        model: cached.model,
      }),
    );
  }

  const sessionKey = getSessionKey(request);
  const rateLimit = suggestionRuntime.consumeRateLimit(sessionKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Suggestion service is rate-limited right now.",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  const queued = suggestionRuntime.createRequest({
    fingerprint: prepared.fingerprint,
    sessionKey,
    mode: prepared.mode,
    language: prepared.input.language,
  });

  try {
    await inngest.send({
      name: "orbit/code-completion.requested",
      id: queued.requestId,
      data: {
        requestId: queued.requestId,
        fingerprint: prepared.fingerprint,
        mode: prepared.mode,
        input: prepared.input,
      },
    });
  } catch (error) {
    suggestionRuntime.fail({
      requestId: queued.requestId,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to queue suggestion request."),
    });

    return NextResponse.json(
      {
        error: "Failed to queue suggestion request.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }

  return NextResponse.json(buildAsyncResponse(queued.requestId, queued.token), {
    status: 202,
  });
}
