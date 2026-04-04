import { beforeEach, describe, expect, it } from "vitest";
import { suggestionRuntime } from "@/lib/completion-runtime";

describe("completion-runtime", () => {
  beforeEach(() => {
    suggestionRuntime.resetForTests();
  });

  it("tracks request lifecycle, cache entries, and metrics", () => {
    const queued = suggestionRuntime.createRequest({
      fingerprint: "fingerprint-1",
      sessionKey: "session-1",
      mode: "autocomplete",
      language: "TypeScript",
    });

    const validatedQueued = suggestionRuntime.validateRequest(
      queued.requestId,
      queued.token,
    );

    expect(validatedQueued?.status).toBe("queued");

    suggestionRuntime.markProcessing(queued.requestId);
    suggestionRuntime.markRetrying(queued.requestId, 2, "Transient failure");
    suggestionRuntime.complete({
      requestId: queued.requestId,
      suggestion: "console.log(answer);",
      model: "test-model",
      attempts: 2,
      latencyMs: 420,
    });

    const validatedCompleted = suggestionRuntime.validateRequest(
      queued.requestId,
      queued.token,
    );
    const cached = suggestionRuntime.getCached("fingerprint-1");
    const metrics = suggestionRuntime.getMetrics();

    expect(validatedCompleted?.status).toBe("completed");
    expect(validatedCompleted?.suggestion).toBe("console.log(answer);");
    expect(cached?.suggestion).toBe("console.log(answer);");
    expect(metrics.totals.completed).toBe(1);
    expect(metrics.totals.retried).toBe(1);
    expect(metrics.cacheEntries).toBe(1);
    expect(metrics.latency.latestMs).toBe(420);
  });

  it("enforces request rate limits per session key", () => {
    for (let index = 0; index < 16; index += 1) {
      expect(suggestionRuntime.consumeRateLimit("session-2").allowed).toBe(
        true,
      );
    }

    const blocked = suggestionRuntime.consumeRateLimit("session-2");

    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });
});
