import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { suggestionRuntime } from "@/lib/completion-runtime";
import { prepareSuggestionRequest } from "@/lib/suggestion-engine";

const sendMock = vi.fn();

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: sendMock,
  },
}));

describe("suggestion route", () => {
  beforeEach(() => {
    suggestionRuntime.resetForTests();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ ids: ["event-1"] });
  });

  it("returns a queued async handle when there is no cache hit", async () => {
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
    expect(sendMock).toHaveBeenCalledTimes(1);
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
    expect(sendMock).not.toHaveBeenCalled();
  });
});
