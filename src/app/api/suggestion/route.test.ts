import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { suggestionRuntime } from "@/lib/completion-runtime";
import {
  prepareSuggestionRequest,
  SuggestionGenerationError,
} from "@/lib/suggestion-engine";

const { sendMock, generateSuggestionMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  generateSuggestionMock: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: sendMock,
  },
}));

vi.mock("@/lib/suggestion-engine", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/suggestion-engine")
  >("@/lib/suggestion-engine");

  return {
    ...actual,
    generateSuggestion: generateSuggestionMock,
  };
});

describe("suggestion route", () => {
  beforeEach(() => {
    suggestionRuntime.resetForTests();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ ids: ["event-1"] });
    generateSuggestionMock.mockReset();
    generateSuggestionMock.mockResolvedValue({
      suggestion: "1_000;",
      modelName: "google/gemma-3-4b-it:free",
      attempts: 1,
      latencyMs: 25,
    });
  });

  it("returns a synchronous autocomplete response when there is no cache hit", async () => {
    const { POST } = await import("@/app/api/suggestion/route");

    const request = new NextRequest("http://localhost/api/suggestion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "vitest",
        "X-Forwarded-For": "127.0.0.1",
      },
      body: JSON.stringify({
        mode: "autocomplete",
        fileName: "src/example.ts",
        language: "TypeScript",
        code: "const value = 1;",
        currentLine: "const value = ",
        textBeforeCursor: "const value = ",
        textAfterCursor: "1;",
        cursorOffset: 14,
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      execution: string;
      suggestion: string;
      model: string;
      status: string;
      attempt: number;
    };

    expect(response.status).toBe(200);
    expect(payload.execution).toBe("sync");
    expect(payload.suggestion).toBe("1_000;");
    expect(payload.model).toBe("google/gemma-3-4b-it:free");
    expect(payload.status).toBe("completed");
    expect(payload.attempt).toBe(1);
    expect(generateSuggestionMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent autocomplete requests with the same fingerprint", async () => {
    const { POST } = await import("@/app/api/suggestion/route");

    const generationDeferred = (() => {
      let resolve!: (value: {
        suggestion: string;
        modelName: string;
        attempts: number;
        latencyMs: number;
      }) => void;

      const promise = new Promise<{
        suggestion: string;
        modelName: string;
        attempts: number;
        latencyMs: number;
      }>((resolvePromise) => {
        resolve = resolvePromise;
      });

      return {
        promise,
        resolve,
      };
    })();

    generateSuggestionMock.mockImplementationOnce(
      () => generationDeferred.promise,
    );

    const buildRequest = () =>
      new NextRequest("http://localhost/api/suggestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "vitest",
          "X-Forwarded-For": "127.0.0.1",
        },
        body: JSON.stringify({
          mode: "autocomplete",
          fileName: "src/example.ts",
          language: "TypeScript",
          code: "const value = 1;",
          currentLine: "const value = ",
          textBeforeCursor: "const value = ",
          textAfterCursor: "1;",
          cursorOffset: 14,
        }),
      });

    const firstResponsePromise = POST(buildRequest());
    const secondResponsePromise = POST(buildRequest());

    await vi.waitFor(() => {
      expect(generateSuggestionMock).toHaveBeenCalledTimes(1);
    });

    generationDeferred.resolve({
      suggestion: "1_000;",
      modelName: "google/gemma-3-4b-it:free",
      attempts: 1,
      latencyMs: 25,
    });

    const [firstResponse, secondResponse] = await Promise.all([
      firstResponsePromise,
      secondResponsePromise,
    ]);

    const firstPayload = (await firstResponse.json()) as {
      execution: string;
      suggestion: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      execution: string;
      suggestion: string;
    };

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstPayload.suggestion).toBe("1_000;");
    expect(secondPayload.suggestion).toBe("1_000;");
    expect([firstPayload.execution, secondPayload.execution]).toEqual(
      expect.arrayContaining(["sync", "cache"]),
    );
  });

  it("returns a queued async handle for transform requests", async () => {
    const { POST } = await import("@/app/api/suggestion/route");

    const request = new NextRequest("http://localhost/api/suggestion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "vitest",
        "X-Forwarded-For": "127.0.0.1",
      },
      body: JSON.stringify({
        mode: "transform",
        fileName: "src/example.ts",
        language: "TypeScript",
        code: "const value = 1;",
        selectedCode: "1",
        instruction: "Replace 1 with 2",
        selectionStartOffset: 14,
        selectionEndOffset: 15,
        textBeforeCursor: "const value = ",
        textAfterCursor: ";",
        cursorOffset: 14,
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      requestId: string;
      token: string;
      streamUrl: string;
      pollUrl: string;
      execution: string;
    };

    expect(response.status).toBe(202);
    expect(payload.execution).toBe("inngest");
    expect(payload.requestId).toBeTruthy();
    expect(payload.token).toBeTruthy();
    expect(payload.streamUrl).toContain("/api/suggestion/stream");
    expect(payload.pollUrl).toContain("/api/suggestion/poll");
    expect(generateSuggestionMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to synchronous generation when queueing fails", async () => {
    const { POST } = await import("@/app/api/suggestion/route");

    sendMock.mockRejectedValueOnce(new Error("fetch failed"));
    generateSuggestionMock.mockResolvedValueOnce({
      suggestion: "const value = 2;",
      modelName: "google/gemma-3-4b-it:free",
      attempts: 1,
      latencyMs: 30,
    });

    const request = new NextRequest("http://localhost/api/suggestion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "vitest",
        "X-Forwarded-For": "127.0.0.1",
      },
      body: JSON.stringify({
        mode: "transform",
        fileName: "src/example.ts",
        language: "TypeScript",
        code: "const value = 1;",
        selectedCode: "1",
        instruction: "Replace 1 with 2",
        selectionStartOffset: 14,
        selectionEndOffset: 15,
        textBeforeCursor: "const value = ",
        textAfterCursor: ";",
        cursorOffset: 14,
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      execution: string;
      suggestion: string;
      status: string;
      attempt: number;
    };

    expect(response.status).toBe(200);
    expect(payload.execution).toBe("sync");
    expect(payload.suggestion).toBe("const value = 2;");
    expect(payload.status).toBe("completed");
    expect(payload.attempt).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(generateSuggestionMock).toHaveBeenCalledTimes(1);
  });

  it("serves cached completions without queueing a new event", async () => {
    const { POST } = await import("@/app/api/suggestion/route");
    const prepared = prepareSuggestionRequest({
      mode: "autocomplete",
      fileName: "src/example.ts",
      language: "TypeScript",
      code: "const value = 1_000;",
      currentLine: "const value = ",
      textBeforeCursor: "const value = ",
      textAfterCursor: "1_000;",
      cursorOffset: 14,
    });

    const seeded = suggestionRuntime.createRequest({
      fingerprint: prepared.fingerprint,
      sessionKey: "seed",
      mode: "autocomplete",
      language: "TypeScript",
    });

    suggestionRuntime.complete({
      requestId: seeded.requestId,
      suggestion: "1_000;",
      model: "test-model",
      attempts: 1,
      latencyMs: 25,
    });

    const request = new NextRequest("http://localhost/api/suggestion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "vitest",
        "X-Forwarded-For": "127.0.0.1",
      },
      body: JSON.stringify({
        mode: "autocomplete",
        fileName: "src/example.ts",
        language: "TypeScript",
        code: "const value = 1_000;",
        currentLine: "const value = ",
        textBeforeCursor: "const value = ",
        textAfterCursor: "1_000;",
        cursorOffset: 14,
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      execution: string;
      suggestion: string;
      cached: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.execution).toBe("cache");
    expect(payload.suggestion).toBe("1_000;");
    expect(payload.cached).toBe(true);
    expect(generateSuggestionMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("pauses provider calls after an OpenRouter rate-limit response", async () => {
    const { POST } = await import("@/app/api/suggestion/route");

    generateSuggestionMock.mockRejectedValueOnce(
      new SuggestionGenerationError({
        message: "Rate limit exceeded: free-models-per-min.",
        statusCode: 429,
        retryAfterSeconds: 12,
        retryable: true,
      }),
    );

    const buildRequest = () =>
      new NextRequest("http://localhost/api/suggestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "vitest",
          "X-Forwarded-For": "127.0.0.1",
        },
        body: JSON.stringify({
          mode: "autocomplete",
          fileName: "src/example.ts",
          language: "TypeScript",
          code: "const value = 1;",
          currentLine: "const value = ",
          textBeforeCursor: "const value = ",
          textAfterCursor: "1;",
          cursorOffset: 14,
        }),
      });

    const firstResponse = await POST(buildRequest());
    const firstPayload = (await firstResponse.json()) as {
      error: string;
      retryAfterSeconds?: number;
    };

    expect(firstResponse.status).toBe(429);
    expect(firstPayload.error).toBe(
      "Suggestion service is rate-limited right now.",
    );
    expect(firstPayload.retryAfterSeconds).toBe(12);
    expect(generateSuggestionMock).toHaveBeenCalledTimes(1);

    generateSuggestionMock.mockResolvedValueOnce({
      suggestion: "2;",
      modelName: "google/gemini-2.5-flash:free",
      attempts: 1,
      latencyMs: 20,
    });

    const secondResponse = await POST(buildRequest());
    const secondPayload = (await secondResponse.json()) as {
      error: string;
      retryAfterSeconds?: number;
    };

    expect(secondResponse.status).toBe(429);
    expect(secondPayload.error).toBe(
      "Suggestion service is rate-limited right now.",
    );
    expect(secondPayload.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(generateSuggestionMock).toHaveBeenCalledTimes(1);
  });
});
