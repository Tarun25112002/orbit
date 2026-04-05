import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("rebuilds the cached runtime when the stored instance is stale", async () => {
    const originalRuntime = suggestionRuntime;
    const staleRuntime = {
      runtimeVersion: 0,
    } as never;
    const globalScope = globalThis as typeof globalThis & {
      __orbitSuggestionRuntime__?: unknown;
    };

    globalScope.__orbitSuggestionRuntime__ = staleRuntime;

    await vi.resetModules();

    try {
      const { suggestionRuntime: reloadedRuntime } =
        await import("@/lib/completion-runtime");

      expect(reloadedRuntime).not.toBe(staleRuntime);
      expect(reloadedRuntime.runtimeVersion).toBe(1);
      expect(typeof reloadedRuntime.getProviderCooldown).toBe("function");
    } finally {
      globalScope.__orbitSuggestionRuntime__ = originalRuntime;
      await vi.resetModules();
    }
  });
});
