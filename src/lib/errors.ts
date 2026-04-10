// ─── Error Classification ─────────────────────────────────────────────────────
//
// Converts raw technical errors into clear, user-friendly messages.
// Used across both the API layer and the client to ensure consistent messaging.

export type ErrorCategory =
  | "rate_limit"
  | "quota_exceeded"
  | "auth"
  | "network"
  | "timeout"
  | "validation"
  | "ai_unavailable"
  | "server"
  | "unknown";

export interface ClassifiedError {
  /** Short, user-friendly message safe to show in UI */
  message: string;
  /** Underlying technical category */
  category: ErrorCategory;
  /** Seconds to wait before retrying (if applicable) */
  retryAfterSeconds?: number;
  /** Whether the action can reasonably be retried */
  retryable: boolean;
}

// ─── Pattern matchers ─────────────────────────────────────────────────────────

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /free.?models?.?per.?(min|minute|day)/i,
  /throttl/i,
];

const QUOTA_PATTERNS = [
  /quota.?exceed/i,
  /resource.?exhausted/i,
  /billing/i,
  /limit:\s*0/i,
  /exceeded your current quota/i,
  /free.?tier/i,
];

const AUTH_PATTERNS = [
  /unauthorized/i,
  /unauthenticated/i,
  /auth.*failed/i,
  /invalid.*api.?key/i,
  /permission.?denied/i,
  /forbidden/i,
  /401/,
  /403/,
];

const NETWORK_PATTERNS = [
  /network/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /fetch failed/i,
  /failed to fetch/i,
  /ERR_CONNECTION/i,
  /dns/i,
];

const TIMEOUT_PATTERNS = [
  /timeout/i,
  /timed?\s*out/i,
  /deadline.?exceeded/i,
  /504/,
  /gateway.?timeout/i,
];

const AI_UNAVAILABLE_PATTERNS = [
  /model.*not.*found/i,
  /model.*unavailable/i,
  /service.?unavailable/i,
  /503/,
  /502/,
  /bad.?gateway/i,
  /overloaded/i,
  /capacity/i,
  /server.*error/i,
  /internal.*error/i,
  /500/,
];

// ─── User-friendly messages per category ──────────────────────────────────────

const USER_MESSAGES: Record<ErrorCategory, string> = {
  rate_limit:
    "AI is temporarily busy due to rate limits. Please wait a moment and try again.",
  quota_exceeded:
    "AI usage quota has been exceeded. Please check your API plan or try again later.",
  auth:
    "Authentication failed. Please sign in again to continue.",
  network:
    "Unable to reach the server. Please check your internet connection and try again.",
  timeout:
    "The request took too long to complete. Please try again with a shorter message.",
  validation:
    "The request could not be processed. Please check your input and try again.",
  ai_unavailable:
    "AI service is temporarily unavailable. Please try again in a few moments.",
  server:
    "Something went wrong on our end. Please try again shortly.",
  unknown:
    "Something unexpected happened. Please try again.",
};

// ─── Retry-after parser ───────────────────────────────────────────────────────

const parseRetrySeconds = (text: string): number | undefined => {
  const match = text.match(/retry\s*(?:in|after)\s+([\d.]+)\s*s/i);
  if (match?.[1]) {
    const seconds = Number.parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
  }
  return undefined;
};

// ─── Main classifier ─────────────────────────────────────────────────────────

/**
 * Classify any error into a user-friendly message.
 *
 * Designed to accept Error objects, raw strings, or unknown values.
 * Handles Gemini API errors, network failures, authentication issues,
 * quota/rate-limit problems, and everything in between.
 */
export const classifyError = (error: unknown): ClassifiedError => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const text = rawMessage.replace(/\s+/g, " ").trim();

  // Check rate limiting first (most common AI error)
  if (RATE_LIMIT_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.rate_limit,
      category: "rate_limit",
      retryAfterSeconds: parseRetrySeconds(text) ?? 10,
      retryable: true,
    };
  }

  // Quota exceeded (API plan issue)
  if (QUOTA_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.quota_exceeded,
      category: "quota_exceeded",
      retryAfterSeconds: parseRetrySeconds(text) ?? 60,
      retryable: true,
    };
  }

  // Authentication / authorization
  if (AUTH_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.auth,
      category: "auth",
      retryable: false,
    };
  }

  // Network issues
  if (NETWORK_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.network,
      category: "network",
      retryable: true,
    };
  }

  // Timeouts
  if (TIMEOUT_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.timeout,
      category: "timeout",
      retryable: true,
    };
  }

  // AI service issues (5xx, model not found, etc.)
  if (AI_UNAVAILABLE_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.ai_unavailable,
      category: "ai_unavailable",
      retryable: true,
    };
  }

  // Fallback
  return {
    message: text || USER_MESSAGES.unknown,
    category: "unknown",
    retryable: false,
  };
};

// ─── Convex error sanitizer ──────────────────────────────────────────────────

const sanitizeConvexErrorMessage = (message: string) => {
  const flattened = message.replace(/\s+/g, " ").trim();
  if (!flattened) {
    return "";
  }

  const withoutEnvelope = flattened
    .replace(/^\[CONVEX [^\]]+\]\s*/i, "")
    .replace(/^\[Request ID:[^\]]+\]\s*/i, "")
    .replace(/^Server Error\s*/i, "")
    .trim();

  const uncaughtMatch = withoutEnvelope.match(
    /Uncaught (?:Error|ConvexError):\s*(.+?)(?=\s+at\s+\S+\s*\(|\s+Called by client|$)/i,
  );
  if (uncaughtMatch?.[1]) {
    return uncaughtMatch[1].trim();
  }

  const serverMatch = withoutEnvelope.match(
    /Error:\s*(.+?)(?=\s+at\s+\S+\s*\(|\s+Called by client|$)/i,
  );
  if (serverMatch?.[1]) {
    return serverMatch[1].trim();
  }

  return withoutEnvelope.replace(/\s+Called by client$/i, "").trim();
};

// ─── Simple message extractor (legacy helper) ────────────────────────────────

export const getErrorMessage = (
  error: unknown,
  fallback = "Something went wrong.",
) => {
  if (error instanceof Error && error.message) {
    const normalized = sanitizeConvexErrorMessage(error.message);
    return normalized || fallback;
  }

  if (typeof error === "string") {
    const normalized = sanitizeConvexErrorMessage(error);
    return normalized || fallback;
  }

  return fallback;
};

/**
 * Get a user-friendly error message from any error.
 *
 * Shorthand for `classifyError(error).message` with an optional fallback.
 */
export const getFriendlyErrorMessage = (
  error: unknown,
  fallback?: string,
): string => {
  const classified = classifyError(error);
  if (classified.category === "unknown" && fallback) {
    return fallback;
  }
  return classified.message;
};
