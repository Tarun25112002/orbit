import { type NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { inngest } from "@/inngest/client";
import { suggestionRuntime } from "@/lib/completion-runtime";
import type { SuggestionRequestBody } from "@/lib/code-suggestion";
import {
  generateSuggestion,
  prepareSuggestionRequest,
  SuggestionGenerationError,
} from "@/lib/suggestion-engine";
import { classifyError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type SuggestionGenerationResult = Awaited<
  ReturnType<typeof generateSuggestion>
>;

declare global {
  var __orbitAutocompleteInFlight__:
    | Map<string, Promise<SuggestionGenerationResult>>
    | undefined;
}

const resolveAutocompleteInFlight = () => {
  const existing = globalThis.__orbitAutocompleteInFlight__;
  if (existing) {
    return existing;
  }

  const next = new Map<string, Promise<SuggestionGenerationResult>>();
  globalThis.__orbitAutocompleteInFlight__ = next;
  return next;
};

const autocompleteInFlight = resolveAutocompleteInFlight();

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

const buildSuggestionErrorResponse = (error: unknown) => {
  const normalized =
    error instanceof SuggestionGenerationError
      ? error
      : (() => {
          const classified = classifyError(error);
          return new SuggestionGenerationError({
            message: classified.message,
            statusCode:
              classified.category === "rate_limit" ||
              classified.category === "quota_exceeded"
                ? 429
                : 500,
            retryable: classified.retryable,
            retryAfterSeconds: classified.retryAfterSeconds,
          });
        })();

  const retryAfterSeconds = normalized.retryAfterSeconds ?? undefined;
  const errorMessage =
    normalized.statusCode === 429
      ? "Suggestion service is rate-limited right now."
      : normalized.message;

  return NextResponse.json(
    {
      error: errorMessage,
      retryAfterSeconds,
    },
    {
      status: normalized.statusCode,
      headers:
        typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
          ? {
              "Retry-After": String(Math.ceil(retryAfterSeconds)),
            }
          : undefined,
    },
  );
};

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

  if (prepared.mode === "autocomplete") {
    const inFlight = autocompleteInFlight.get(prepared.fingerprint);
    if (inFlight) {
      try {
        const generation = await inFlight;

        return NextResponse.json(
          suggestionRuntime.createCachedResponse({
            fingerprint: prepared.fingerprint,
            mode: prepared.mode,
            suggestion: generation.suggestion,
            model: generation.modelName,
          }),
        );
      } catch (error) {
        if (
          error instanceof SuggestionGenerationError &&
          error.statusCode === 429
        ) {
          const sessionKey = getSessionKey(request);
          suggestionRuntime.setProviderCooldown(
            sessionKey,
            error.retryAfterSeconds,
          );
        }

        return buildSuggestionErrorResponse(error);
      }
    }
  }

  const sessionKey = getSessionKey(request);
  const providerCooldown = suggestionRuntime.getProviderCooldown(sessionKey);
  if (providerCooldown) {
    return NextResponse.json(
      {
        error: "Suggestion service is rate-limited right now.",
        retryAfterSeconds: providerCooldown.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(providerCooldown.retryAfterSeconds),
        },
      },
    );
  }

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

  if (prepared.mode === "autocomplete") {
    const generationPromise = generateSuggestion(prepared.mode, prepared.input);
    autocompleteInFlight.set(prepared.fingerprint, generationPromise);

    try {
      const generation = await generationPromise;

      return NextResponse.json(
        suggestionRuntime.createSyncResponse({
          fingerprint: prepared.fingerprint,
          mode: prepared.mode,
          suggestion: generation.suggestion,
          model: generation.modelName,
          attempts: generation.attempts,
          latencyMs: generation.latencyMs,
        }),
      );
    } catch (error) {
      if (
        error instanceof SuggestionGenerationError &&
        error.statusCode === 429
      ) {
        suggestionRuntime.setProviderCooldown(
          sessionKey,
          error.retryAfterSeconds,
        );
      }

      return buildSuggestionErrorResponse(error);
    } finally {
      const activePromise = autocompleteInFlight.get(prepared.fingerprint);
      if (activePromise === generationPromise) {
        autocompleteInFlight.delete(prepared.fingerprint);
      }
    }
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
    const queueError =
      error instanceof Error
        ? error
        : new Error("Failed to queue suggestion request.");

    console.warn("suggestion.request.queue-fallback", {
      requestId: queued.requestId,
      detail: queueError.message,
    });

    suggestionRuntime.markProcessing(queued.requestId);

    try {
      const generation = await generateSuggestion(
        prepared.mode,
        prepared.input,
        {
          onRetry: ({ attempt, error: retryError }) => {
            suggestionRuntime.markRetrying(
              queued.requestId,
              attempt,
              retryError.message,
            );
          },
        },
      );

      suggestionRuntime.complete({
        requestId: queued.requestId,
        suggestion: generation.suggestion,
        model: generation.modelName,
        attempts: generation.attempts,
        latencyMs: generation.latencyMs,
      });

      return NextResponse.json({
        requestId: queued.requestId,
        mode: prepared.mode,
        execution: "sync" as const,
        suggestion: generation.suggestion,
        sugegstions: generation.suggestion,
        model: generation.modelName,
        cached: false,
        status: "completed" as const,
        attempt: generation.attempts,
      });
    } catch (generationError) {
      if (
        generationError instanceof SuggestionGenerationError &&
        generationError.statusCode === 429
      ) {
        suggestionRuntime.setProviderCooldown(
          sessionKey,
          generationError.retryAfterSeconds,
        );
      }

      suggestionRuntime.fail({
        requestId: queued.requestId,
        error: generationError,
      });

      return buildSuggestionErrorResponse(generationError);
    }
  }

  return NextResponse.json(buildAsyncResponse(queued.requestId, queued.token), {
    status: 202,
  });
}
