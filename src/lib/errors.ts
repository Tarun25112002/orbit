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

  message: string;

  category: ErrorCategory;

  retryAfterSeconds?: number;

  retryable: boolean;
}

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /tokens?\s+per\s+minute/i,
  /\bTPM\b/i,
  /request\s+too\s+large/i,
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

const MODEL_CONFIG_PATTERNS = [
  /model.*not.*found/i,
  /invalid model/i,
  /unknown model/i,
  /not supported for generatecontent/i,
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
];

const AI_PROVIDER_CONTEXT_PATTERNS = [
  /\bgemini\b/i,
  /\bmodel\b/i,
  /generatecontent/i,
  /provider\s+returned\s+error/i,
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bvertex\b/i,
  /\bllm\b/i,
  /\binference\b/i,
  /\bai\s+service\b/i,
];

const USER_MESSAGES: Record<ErrorCategory, string> = {
  rate_limit:
    "AI is temporarily busy due to rate limits. Please wait a moment and try again.",
  quota_exceeded:
    "AI usage quota has been exceeded. Please check your API plan or try again later.",
  auth: "Authentication failed. Please sign in again to continue.",
  network:
    "Unable to reach the server. Please check your internet connection and try again.",
  timeout:
    "The request took too long to complete. Please try again with a shorter message.",
  validation:
    "The request could not be processed. Please check your input and try again.",
  ai_unavailable:
    "AI service is temporarily unavailable. Please try again in a few moments.",
  server: "Something went wrong on our end. Please try again shortly.",
  unknown: "Something unexpected happened. Please try again.",
};

const parseRetrySeconds = (text: string): number | undefined => {
  const match = text.match(/retry\s*(?:in|after)\s+([\d.]+)\s*s/i);
  if (match?.[1]) {
    const seconds = Number.parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
  }

  const retryDelayMatch = text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (retryDelayMatch?.[1]) {
    const seconds = Number.parseFloat(retryDelayMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
  }

  return undefined;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const collectErrorRecords = (error: unknown) => {
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: error, depth: 0 },
  ];
  const visited = new Set<unknown>();
  const records: Record<string, unknown>[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 5) {
      continue;
    }

    const record = toRecord(current.value);
    if (!record || visited.has(record)) {
      continue;
    }

    visited.add(record);
    records.push(record);

    for (const key of ["error", "response", "data", "cause"]) {
      if (key in record) {
        queue.push({ value: record[key], depth: current.depth + 1 });
      }
    }

    const details = record.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        queue.push({ value: detail, depth: current.depth + 1 });
      }
    }
  }

  return records;
};

const toStatusCode = (value: unknown) => {
  const numericCandidate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(numericCandidate)) {
    return undefined;
  }

  const normalized = Math.trunc(numericCandidate);
  if (normalized >= 100 && normalized <= 599) {
    return normalized;
  }

  return undefined;
};

const toRetryAfterSeconds = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.ceil(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const asNumber = Number.parseFloat(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return Math.ceil(asNumber);
  }

  const secondsMatch = trimmed.match(/([\d.]+)\s*s/i);
  if (secondsMatch?.[1]) {
    const seconds = Number.parseFloat(secondsMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
  }

  return undefined;
};

const getErrorMessageText = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  for (const record of collectErrorRecords(error)) {
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }

    if (typeof record.detail === "string" && record.detail.trim()) {
      return record.detail;
    }
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }

  return "";
};

const extractStatusCode = (error: unknown) => {
  for (const record of collectErrorRecords(error)) {
    const status =
      toStatusCode(record.status) ??
      toStatusCode(record.statusCode) ??
      toStatusCode(record.code);

    if (status !== undefined) {
      return status;
    }
  }

  return undefined;
};

const extractRetryAfterSeconds = (error: unknown, text: string) => {
  const parsedFromText = parseRetrySeconds(text);
  if (parsedFromText !== undefined) {
    return parsedFromText;
  }

  for (const record of collectErrorRecords(error)) {
    const retryAfter =
      toRetryAfterSeconds(record.retryAfterSeconds) ??
      toRetryAfterSeconds(record.retryAfter) ??
      toRetryAfterSeconds(record.retryDelay);

    if (retryAfter !== undefined) {
      return retryAfter;
    }

    const headers = toRecord(record.headers);
    const headerRetryAfter =
      headers?.["retry-after"] ?? headers?.["Retry-After"];
    const parsedHeaderRetryAfter = toRetryAfterSeconds(headerRetryAfter);

    if (parsedHeaderRetryAfter !== undefined) {
      return parsedHeaderRetryAfter;
    }
  }

  return undefined;
};

export const classifyError = (error: unknown): ClassifiedError => {
  const rawMessage = getErrorMessageText(error);

  const text = rawMessage.replace(/\s+/g, " ").trim();
  const statusCode = extractStatusCode(error);
  const hasAiProviderContext = AI_PROVIDER_CONTEXT_PATTERNS.some((pattern) =>
    pattern.test(text),
  );

  if (statusCode === 429) {
    return {
      message: USER_MESSAGES.rate_limit,
      category: "rate_limit",
      retryAfterSeconds: extractRetryAfterSeconds(error, text) ?? 10,
      retryable: true,
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      message: USER_MESSAGES.auth,
      category: "auth",
      retryable: false,
    };
  }

  if (statusCode === 408 || statusCode === 504) {
    return {
      message: USER_MESSAGES.timeout,
      category: "timeout",
      retryable: true,
    };
  }

  if (statusCode === 503 || statusCode === 502) {
    if (!hasAiProviderContext) {
      return {
        message: USER_MESSAGES.server,
        category: "server",
        retryable: true,
      };
    }

    return {
      message: USER_MESSAGES.ai_unavailable,
      category: "ai_unavailable",
      retryable: true,
    };
  }

  if (statusCode === 500) {
    return {
      message: USER_MESSAGES.server,
      category: "server",
      retryable: true,
    };
  }

  if (statusCode === 400 || statusCode === 422) {
    return {
      message: USER_MESSAGES.validation,
      category: "validation",
      retryable: false,
    };
  }

  if (statusCode === 404) {
    return {
      message: USER_MESSAGES.validation,
      category: "validation",
      retryable: false,
    };
  }

  if (RATE_LIMIT_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.rate_limit,
      category: "rate_limit",
      retryAfterSeconds: extractRetryAfterSeconds(error, text) ?? 10,
      retryable: true,
    };
  }

  if (QUOTA_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.quota_exceeded,
      category: "quota_exceeded",
      retryAfterSeconds: extractRetryAfterSeconds(error, text) ?? 60,
      retryable: true,
    };
  }

  if (AUTH_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.auth,
      category: "auth",
      retryable: false,
    };
  }

  if (NETWORK_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.network,
      category: "network",
      retryable: true,
    };
  }

  if (TIMEOUT_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.timeout,
      category: "timeout",
      retryable: true,
    };
  }

  if (MODEL_CONFIG_PATTERNS.some((p) => p.test(text))) {
    return {
      message: USER_MESSAGES.validation,
      category: "validation",
      retryable: false,
    };
  }

  if (AI_UNAVAILABLE_PATTERNS.some((p) => p.test(text))) {
    if (!hasAiProviderContext) {
      return {
        message: USER_MESSAGES.server,
        category: "server",
        retryable: true,
      };
    }

    return {
      message: USER_MESSAGES.ai_unavailable,
      category: "ai_unavailable",
      retryable: true,
    };
  }

  return {
    message: text || USER_MESSAGES.unknown,
    category: "unknown",
    retryable: false,
  };
};

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
