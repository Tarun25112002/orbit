import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import type {
  SuggestionApiResponse,
  SuggestionMode,
  SuggestionRequestStatus,
} from "@/lib/code-suggestion";
import { SuggestionGenerationError } from "@/lib/suggestion-engine";

const REQUEST_TTL_MS = Number.parseInt(
  process.env.SUGGESTION_REQUEST_TTL_MS ?? "900000",
  10,
);
const CACHE_TTL_MS = Number.parseInt(
  process.env.SUGGESTION_CACHE_TTL_MS ?? "120000",
  10,
);
const MAX_REQUESTS_PER_WINDOW = Number.parseInt(
  process.env.SUGGESTION_RATE_LIMIT_MAX ?? "16",
  10,
);
const RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.SUGGESTION_RATE_LIMIT_WINDOW_MS ?? "30000",
  10,
);
const PROCESSING_CONCURRENCY = Number.parseInt(
  process.env.SUGGESTION_PROCESSING_CONCURRENCY ?? "4",
  10,
);
const HEARTBEAT_MS = 15_000;

type CacheEntry = {
  fingerprint: string;
  suggestion: string;
  model: string;
  createdAt: number;
  expiresAt: number;
};

type RequestRecord = {
  requestId: string;
  fingerprint: string;
  mode: SuggestionMode;
  language?: string;
  sessionKey: string;
  tokenHash: Buffer;
  status: SuggestionRequestStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  queuePosition: number;
  suggestion: string;
  model?: string;
  error?: string;
  detail?: string;
  retryAfterSeconds?: number;
  attempts: number;
  execution: "cache" | "inngest";
  cached: boolean;
};

type RuntimeEvent = {
  record: RequestRecord;
};

type MetricsSnapshot = {
  totals: {
    requested: number;
    queued: number;
    started: number;
    completed: number;
    failed: number;
    cacheHits: number;
    rateLimited: number;
    retried: number;
  };
  queueDepth: number;
  activeRuns: number;
  cacheEntries: number;
  latency: {
    averageMs: number;
    p95Ms: number;
    latestMs: number | null;
  };
  generatedAt: string;
};

const createTokenHash = (token: string) =>
  createHash("sha256").update(token).digest();

const safeBufferEquals = (left: Buffer, right: Buffer) =>
  left.length === right.length && timingSafeEqual(left, right);

class SuggestionRuntime {
  private requests = new Map<string, RequestRecord>();
  private cache = new Map<string, CacheEntry>();
  private listeners = new Map<string, Set<(event: RuntimeEvent) => void>>();
  private rateWindows = new Map<string, number[]>();
  private latencies: number[] = [];
  private totals = {
    requested: 0,
    queued: 0,
    started: 0,
    completed: 0,
    failed: 0,
    cacheHits: 0,
    rateLimited: 0,
    retried: 0,
  };

  private emit(record: RequestRecord) {
    const listeners = this.listeners.get(record.requestId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    const event = { record };
    for (const listener of listeners) {
      listener(event);
    }
  }

  private pruneExpired() {
    const now = Date.now();

    for (const [fingerprint, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(fingerprint);
      }
    }

    for (const [requestId, record] of this.requests.entries()) {
      if (record.updatedAt + REQUEST_TTL_MS <= now) {
        this.requests.delete(requestId);
        this.listeners.delete(requestId);
      }
    }

    for (const [key, timestamps] of this.rateWindows.entries()) {
      const filtered = timestamps.filter(
        (timestamp) => timestamp + RATE_LIMIT_WINDOW_MS > now,
      );

      if (filtered.length === 0) {
        this.rateWindows.delete(key);
        continue;
      }

      this.rateWindows.set(key, filtered);
    }
  }

  private getActiveRuns() {
    let activeRuns = 0;

    for (const record of this.requests.values()) {
      if (record.status === "processing" || record.status === "retrying") {
        activeRuns += 1;
      }
    }

    return activeRuns;
  }

  private getQueuedRecords() {
    return Array.from(this.requests.values())
      .filter((record) => record.status === "queued")
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  private recalculateQueuePositions() {
    const queuedRecords = this.getQueuedRecords();
    queuedRecords.forEach((record, index) => {
      const nextQueuePosition = Math.max(
        0,
        index - Math.max(0, PROCESSING_CONCURRENCY - this.getActiveRuns()) + 1,
      );

      if (record.queuePosition !== nextQueuePosition) {
        record.queuePosition = nextQueuePosition;
        record.updatedAt = Date.now();
        this.emit(record);
      }
    });
  }

  private addLatency(value: number) {
    this.latencies.push(value);
    if (this.latencies.length > 200) {
      this.latencies.shift();
    }
  }

  getCached(fingerprint: string) {
    this.pruneExpired();
    return this.cache.get(fingerprint) ?? null;
  }

  consumeRateLimit(sessionKey: string) {
    this.pruneExpired();

    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const existing = this.rateWindows.get(sessionKey) ?? [];
    const filtered = existing.filter((timestamp) => timestamp >= windowStart);

    if (filtered.length >= MAX_REQUESTS_PER_WINDOW) {
      this.totals.rateLimited += 1;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((filtered[0] + RATE_LIMIT_WINDOW_MS - now) / 1_000),
      );

      return {
        allowed: false as const,
        retryAfterSeconds,
      };
    }

    filtered.push(now);
    this.rateWindows.set(sessionKey, filtered);

    return {
      allowed: true as const,
    };
  }

  createRequest(args: {
    fingerprint: string;
    sessionKey: string;
    mode: SuggestionMode;
    language?: string;
  }) {
    this.pruneExpired();

    const requestId = randomUUID();
    const token = randomUUID();
    const now = Date.now();
    const record: RequestRecord = {
      requestId,
      fingerprint: args.fingerprint,
      mode: args.mode,
      language: args.language,
      sessionKey: args.sessionKey,
      tokenHash: createTokenHash(token),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      queuePosition: this.getQueuedRecords().length + 1,
      suggestion: "",
      attempts: 0,
      execution: "inngest",
      cached: false,
    };

    this.requests.set(requestId, record);
    this.totals.requested += 1;
    this.totals.queued += 1;
    this.recalculateQueuePositions();
    this.emit(record);

    console.info("suggestion.request.queued", {
      requestId,
      mode: args.mode,
      language: args.language,
      queuePosition: record.queuePosition,
    });

    return {
      requestId,
      token,
      record,
    };
  }

  createCachedResponse(args: {
    fingerprint: string;
    mode: SuggestionMode;
    suggestion: string;
    model: string;
  }): SuggestionApiResponse {
    this.totals.cacheHits += 1;

    return {
      mode: args.mode,
      execution: "cache",
      suggestion: args.suggestion,
      sugegstions: args.suggestion,
      model: args.model,
      cached: true,
      status: "completed",
    };
  }

  createSyncResponse(args: {
    fingerprint: string;
    mode: SuggestionMode;
    suggestion: string;
    model: string;
    attempts: number;
    latencyMs: number;
  }): SuggestionApiResponse {
    const now = Date.now();

    this.cache.set(args.fingerprint, {
      fingerprint: args.fingerprint,
      suggestion: args.suggestion,
      model: args.model,
      createdAt: now,
      expiresAt: now + CACHE_TTL_MS,
    });

    this.totals.requested += 1;
    this.totals.completed += 1;
    this.addLatency(args.latencyMs);

    console.info("suggestion.request.completed", {
      execution: "sync",
      attempts: args.attempts,
      latencyMs: args.latencyMs,
      model: args.model,
    });

    return {
      mode: args.mode,
      execution: "sync",
      suggestion: args.suggestion,
      sugegstions: args.suggestion,
      model: args.model,
      cached: false,
      status: "completed",
      attempt: args.attempts,
    };
  }

  markProcessing(requestId: string) {
    const record = this.requests.get(requestId);
    if (!record) {
      return null;
    }

    record.status = "processing";
    record.startedAt = record.startedAt ?? Date.now();
    record.updatedAt = Date.now();
    record.queuePosition = 0;
    this.totals.started += 1;
    this.recalculateQueuePositions();
    this.emit(record);

    console.info("suggestion.request.processing", {
      requestId,
      mode: record.mode,
      language: record.language,
    });

    return record;
  }

  markRetrying(requestId: string, attempt: number, detail?: string) {
    const record = this.requests.get(requestId);
    if (!record) {
      return null;
    }

    record.status = "retrying";
    record.attempts = attempt;
    record.detail = detail;
    record.updatedAt = Date.now();
    this.totals.retried += 1;
    this.emit(record);

    return record;
  }

  complete(args: {
    requestId: string;
    suggestion: string;
    model: string;
    attempts: number;
    latencyMs: number;
  }) {
    const record = this.requests.get(args.requestId);
    if (!record) {
      return null;
    }

    const now = Date.now();
    record.status = "completed";
    record.suggestion = args.suggestion;
    record.model = args.model;
    record.attempts = args.attempts;
    record.completedAt = now;
    record.updatedAt = now;
    record.cached = false;
    record.error = undefined;
    record.detail = undefined;
    record.retryAfterSeconds = undefined;

    this.cache.set(record.fingerprint, {
      fingerprint: record.fingerprint,
      suggestion: args.suggestion,
      model: args.model,
      createdAt: now,
      expiresAt: now + CACHE_TTL_MS,
    });

    this.totals.completed += 1;
    this.addLatency(args.latencyMs);
    this.emit(record);

    console.info("suggestion.request.completed", {
      requestId: args.requestId,
      attempts: args.attempts,
      latencyMs: args.latencyMs,
      model: args.model,
    });

    return record;
  }

  fail(args: {
    requestId: string;
    error: unknown;
    attempts?: number;
  }) {
    const record = this.requests.get(args.requestId);
    if (!record) {
      return null;
    }

    const normalized =
      args.error instanceof SuggestionGenerationError
        ? args.error
        : new SuggestionGenerationError({
            message:
              args.error instanceof Error
                ? args.error.message
                : "Suggestion generation failed",
            statusCode: 500,
            retryable: false,
          });

    record.status = "failed";
    record.error =
      normalized.statusCode === 429
        ? "Suggestion service is rate-limited right now."
        : "Failed to generate suggestion";
    record.detail = normalized.message;
    record.retryAfterSeconds = normalized.retryAfterSeconds ?? undefined;
    record.attempts = args.attempts ?? record.attempts;
    record.updatedAt = Date.now();
    record.completedAt = Date.now();
    this.totals.failed += 1;
    this.emit(record);

    console.error("suggestion.request.failed", {
      requestId: args.requestId,
      statusCode: normalized.statusCode,
      retryable: normalized.retryable,
      detail: normalized.message,
    });

    Sentry.captureException(normalized, {
      tags: {
        area: "suggestion",
        requestId: args.requestId,
        statusCode: String(normalized.statusCode),
      },
    });

    return record;
  }

  validateRequest(requestId: string, token: string) {
    this.pruneExpired();
    const record = this.requests.get(requestId);
    if (!record) {
      return null;
    }

    const tokenHash = createTokenHash(token);
    if (!safeBufferEquals(record.tokenHash, tokenHash)) {
      return null;
    }

    return record;
  }

  toApiResponse(record: RequestRecord): SuggestionApiResponse {
    return {
      requestId: record.requestId,
      mode: record.mode,
      execution: record.execution,
      suggestion: record.suggestion,
      sugegstions: record.suggestion,
      model: record.model,
      error: record.error,
      detail: record.detail,
      retryAfterSeconds: record.retryAfterSeconds,
      status: record.status,
      attempt: record.attempts,
      queuePosition: record.queuePosition,
      cached: record.cached,
    };
  }

  subscribe(requestId: string, listener: (event: RuntimeEvent) => void) {
    const listeners = this.listeners.get(requestId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(requestId, listeners);

    return () => {
      const current = this.listeners.get(requestId);
      if (!current) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(requestId);
      }
    };
  }

  getMetrics(): MetricsSnapshot {
    this.pruneExpired();

    const sortedLatencies = [...this.latencies].sort((left, right) => left - right);
    const totalLatency = this.latencies.reduce((sum, value) => sum + value, 0);
    const p95Index =
      sortedLatencies.length > 0
        ? Math.min(
            sortedLatencies.length - 1,
            Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1),
          )
        : 0;

    return {
      totals: { ...this.totals },
      queueDepth: this.getQueuedRecords().length,
      activeRuns: this.getActiveRuns(),
      cacheEntries: this.cache.size,
      latency: {
        averageMs:
          this.latencies.length > 0
            ? Math.round(totalLatency / this.latencies.length)
            : 0,
        p95Ms: sortedLatencies[p95Index] ?? 0,
        latestMs: this.latencies.at(-1) ?? null,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  getHeartbeatIntervalMs() {
    return HEARTBEAT_MS;
  }

  resetForTests() {
    this.requests.clear();
    this.cache.clear();
    this.listeners.clear();
    this.rateWindows.clear();
    this.latencies = [];
    this.totals = {
      requested: 0,
      queued: 0,
      started: 0,
      completed: 0,
      failed: 0,
      cacheHits: 0,
      rateLimited: 0,
      retried: 0,
    };
  }
}

declare global {
  var __orbitSuggestionRuntime__: SuggestionRuntime | undefined;
}

export const suggestionRuntime =
  globalThis.__orbitSuggestionRuntime__ ??
  (globalThis.__orbitSuggestionRuntime__ = new SuggestionRuntime());
