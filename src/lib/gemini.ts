import { GoogleGenAI } from "@google/genai";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_ENV_PATH = resolve(process.cwd(), ".env.local");
let cachedLocalEnvMtimeMs: number | null = null;
let cachedLocalEnvValues: Record<string, string> = {};
const geminiModelCooldownUntilMs = new Map<string, number>();

const parseLocalEnvFile = (content: string) => {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    values[key] = unquoted;
  }

  return values;
};

const getLocalEnvValues = () => {
  try {
    if (!existsSync(LOCAL_ENV_PATH)) {
      cachedLocalEnvMtimeMs = null;
      cachedLocalEnvValues = {};
      return cachedLocalEnvValues;
    }

    const stats = statSync(LOCAL_ENV_PATH);
    if (cachedLocalEnvMtimeMs === stats.mtimeMs) {
      return cachedLocalEnvValues;
    }

    const content = readFileSync(LOCAL_ENV_PATH, "utf8");
    cachedLocalEnvValues = parseLocalEnvFile(content);
    cachedLocalEnvMtimeMs = stats.mtimeMs;

    return cachedLocalEnvValues;
  } catch {
    return cachedLocalEnvValues;
  }
};

const getRuntimeEnvValue = (name: string) => {
  const localValue = getLocalEnvValues()[name];
  if (typeof localValue === "string" && localValue.trim()) {
    return localValue.trim();
  }

  const processValue = process.env[name];
  return typeof processValue === "string" ? processValue.trim() : "";
};

const parseOptionalPositiveInt = (value: string) => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const applyAttemptCap = <T>(items: T[], maxItems: number | null) => {
  if (typeof maxItems !== "number") {
    return items;
  }

  return items.slice(0, maxItems);
};

const getGeminiApiKey = () =>
  getRuntimeEnvValue("GEMINI_API_KEY") || getRuntimeEnvValue("GOOGLE_API_KEY");

const getGeminiKeyScope = (apiKey: string) => {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return "no-key";
  }

  const suffix = trimmed.slice(-6);
  return `${trimmed.length}:${suffix}`;
};

const toModelCooldownKey = (model: string, apiKey: string) =>
  `${model}::${getGeminiKeyScope(apiKey)}`;

const GEMINI_FREE_FALLBACK_CHAIN = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-live-preview",
] as const;

const getGeminiFallbackModels = () => {
  const configured = getRuntimeEnvValue("GEMINI_FALLBACK_MODELS")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return Array.from(new Set([...GEMINI_FREE_FALLBACK_CHAIN, ...configured]));
};

const getGeminiModelCandidates = (preferredModel: string) =>
  Array.from(new Set([preferredModel, ...getGeminiFallbackModels()]));

const getRequestAttemptBudget = () => ({
  maxGeminiModels: parseOptionalPositiveInt(
    getRuntimeEnvValue("AI_MAX_GEMINI_MODELS_PER_REQUEST"),
  ),
});

const parseRetryAfterSeconds = (value: string) => {
  const retryInMatch = value.match(/retry\s*(?:in|after)\s+([\d.]+)\s*s/i);
  if (retryInMatch?.[1]) {
    const seconds = Number.parseFloat(retryInMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
  }

  const retryDelayMatch = value.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (retryDelayMatch?.[1]) {
    const seconds = Number.parseFloat(retryDelayMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
  }

  return null;
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
    return null;
  }

  const normalized = Math.trunc(numericCandidate);
  if (normalized >= 100 && normalized <= 599) {
    return normalized;
  }

  return null;
};

const toRetryAfterSeconds = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.ceil(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
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

  return null;
};

const extractStructuredStatusCode = (error: unknown) => {
  for (const record of collectErrorRecords(error)) {
    const status =
      toStatusCode(record.status) ??
      toStatusCode(record.statusCode) ??
      toStatusCode(record.code);

    if (typeof status === "number") {
      return status;
    }
  }

  return null;
};

const extractStructuredRetryAfterSeconds = (error: unknown) => {
  for (const record of collectErrorRecords(error)) {
    const retryAfter =
      toRetryAfterSeconds(record.retryAfterSeconds) ??
      toRetryAfterSeconds(record.retryAfter) ??
      toRetryAfterSeconds(record.retryDelay);

    if (typeof retryAfter === "number") {
      return retryAfter;
    }

    const headers = toRecord(record.headers);
    const headerRetryAfter =
      headers?.["retry-after"] ?? headers?.["Retry-After"];
    const parsedHeaderRetryAfter = toRetryAfterSeconds(headerRetryAfter);

    if (typeof parsedHeaderRetryAfter === "number") {
      return parsedHeaderRetryAfter;
    }
  }

  return null;
};

const isRateLimitedGeminiError = (args: {
  statusCode: number | null;
  message: string;
}) =>
  args.statusCode === 429 ||
  args.message.includes("429") ||
  /rate.?limit/i.test(args.message) ||
  /quota/i.test(args.message) ||
  /resource.?exhausted/i.test(args.message) ||
  /too many requests/i.test(args.message);

const extractRawErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error !== "object" || error === null) {
    return "Gemini request failed";
  }

  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }

  if (
    "error" in record &&
    typeof record.error === "object" &&
    record.error !== null
  ) {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message;
    }

    try {
      return JSON.stringify(record.error);
    } catch {
      return "Gemini request failed";
    }
  }

  try {
    return JSON.stringify(record);
  } catch {
    return "Gemini request failed";
  }
};

export const getGeminiRateLimitMetadata = (error: unknown) => {
  const rawMessage = extractRawErrorMessage(error);
  const statusCode = extractStructuredStatusCode(error);
  const retryAfterSeconds =
    parseRetryAfterSeconds(rawMessage) ??
    extractStructuredRetryAfterSeconds(error) ??
    10;

  if (!isRateLimitedGeminiError({ statusCode, message: rawMessage })) {
    return null;
  }

  return {
    retryAfterSeconds,
    statusCode,
    message: rawMessage,
  };
};

const getModelCooldownSeconds = (model: string, apiKey?: string) => {
  const resolvedApiKey = apiKey ?? getGeminiApiKey();
  const until = geminiModelCooldownUntilMs.get(
    toModelCooldownKey(model, resolvedApiKey),
  );
  if (!until) {
    return 0;
  }

  const remainingMs = until - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
};

const setModelCooldown = (
  model: string,
  retryAfterSeconds: number | null,
  apiKey?: string,
) => {
  const resolvedApiKey = apiKey ?? getGeminiApiKey();
  const seconds =
    retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds : 10;
  geminiModelCooldownUntilMs.set(
    toModelCooldownKey(model, resolvedApiKey),
    Date.now() + seconds * 1000,
  );
};

export const isGeminiModelCoolingDown = (model: string) =>
  getModelCooldownSeconds(model) > 0;

export const getGeminiModelCooldownSeconds = (model: string) =>
  getModelCooldownSeconds(model);

export const markGeminiModelRateLimited = (
  model: string,
  retryAfterSeconds?: number | null,
) => {
  setModelCooldown(model, retryAfterSeconds ?? null);
};

/** Default model used across the app — configurable via GEMINI_MODEL env var */
export const GEMINI_MODEL_DEFAULT =
  getRuntimeEnvValue("GEMINI_MODEL") || GEMINI_FREE_FALLBACK_CHAIN[0];

export type GeminiChatMessage = {
  role: "user" | "model";
  content: string;
  reasoning_details?: unknown;
};

export type GeminiCompletionResult = {
  content: string;
  model: string;
  reasoning_details?: unknown;
};

export class GeminiRequestError extends Error {
  status: number;

  constructor(args: { message: string; status: number }) {
    super(args.message);
    this.name = "GeminiRequestError";
    this.status = args.status;
  }
}

const getClient = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new GeminiRequestError({
      message: "GEMINI_API_KEY is not configured",
      status: 500,
    });
  }

  return new GoogleGenAI({ apiKey });
};

export const generateGeminiCompletion = async (args: {
  model?: string;
  messages: GeminiChatMessage[];
  maxTokens?: number;
  temperature?: number;
  responseMimeType?: string;
}): Promise<GeminiCompletionResult> => {
  const attemptBudget = getRequestAttemptBudget();
  const modelName = (args.model ?? GEMINI_MODEL_DEFAULT).trim();
  const modelCandidates = applyAttemptCap(
    getGeminiModelCandidates(modelName),
    attemptBudget.maxGeminiModels,
  );
  const activeGeminiApiKey = getGeminiApiKey();

  let ai: GoogleGenAI | null = null;
  let lastRateLimitError: GeminiRequestError | null = null;
  let lastServiceUnavailableError: GeminiRequestError | null = null;
  let lastModelCompatibilityError: GeminiRequestError | null = null;

  const contents = args.messages.map((msg) => ({
    role: msg.role === "user" ? ("user" as const) : ("model" as const),
    parts: [{ text: msg.content }],
  }));

  for (const candidateModel of modelCandidates) {
    const cooldownSeconds = getModelCooldownSeconds(
      candidateModel,
      activeGeminiApiKey,
    );

    if (cooldownSeconds > 0) {
      lastRateLimitError = new GeminiRequestError({
        message: `Model ${candidateModel} is temporarily rate-limited. Retry in ${cooldownSeconds}s.`,
        status: 429,
      });
      continue;
    }

    try {
      ai ??= getClient();
      const config: {
        maxOutputTokens?: number;
        temperature?: number;
        responseMimeType?: string;
      } = {
        maxOutputTokens: args.maxTokens,
        temperature: args.temperature,
      };

      if (args.responseMimeType) {
        config.responseMimeType = args.responseMimeType;
      }

      const response = await ai.models.generateContent({
        model: candidateModel,
        contents,
        config,
      });

      const text = response.text?.trim() ?? "";
      if (!text) {
        throw new GeminiRequestError({
          message: "Gemini response did not include any content",
          status: 502,
        });
      }

      return {
        content: text,
        model: candidateModel,
      };
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        throw error;
      }

      const rawMessage = extractRawErrorMessage(error);
      const structuredStatusCode = extractStructuredStatusCode(error);
      const retryAfterSeconds =
        parseRetryAfterSeconds(rawMessage) ??
        extractStructuredRetryAfterSeconds(error);

      const isRateLimited = isRateLimitedGeminiError({
        statusCode: structuredStatusCode,
        message: rawMessage,
      });

      const isModelCompatibilityIssue =
        structuredStatusCode === 404 ||
        /model.*not.*found/i.test(rawMessage) ||
        /not supported for generatecontent/i.test(rawMessage) ||
        /invalid model|unknown model/i.test(rawMessage);

      if (isModelCompatibilityIssue) {
        lastModelCompatibilityError = new GeminiRequestError({
          message: `Model ${candidateModel} is unavailable for this API key/version.`,
          status: 400,
        });
        continue;
      }

      if (isRateLimited) {
        setModelCooldown(candidateModel, retryAfterSeconds, activeGeminiApiKey);

        const cooldownForMessage =
          retryAfterSeconds ??
          getModelCooldownSeconds(candidateModel, activeGeminiApiKey) ??
          10;

        lastRateLimitError = new GeminiRequestError({
          message: `AI model ${candidateModel} is rate-limited. Retry in ${cooldownForMessage}s.`,
          status: 429,
        });
        continue;
      }

      const isServiceUnavailableError =
        structuredStatusCode === 500 ||
        structuredStatusCode === 502 ||
        structuredStatusCode === 503 ||
        /service\.?unavailable/i.test(rawMessage) ||
        /bad\.?gateway/i.test(rawMessage) ||
        /internal\.?error/i.test(rawMessage) ||
        /overloaded|capacity/i.test(rawMessage);

      if (isServiceUnavailableError) {
        // Cool down this model briefly so bursty multi-agent calls skip it.
        setModelCooldown(candidateModel, 8, activeGeminiApiKey);

        lastServiceUnavailableError = new GeminiRequestError({
          message: `AI model ${candidateModel} is temporarily unavailable.`,
          status: structuredStatusCode ?? 503,
        });
        continue;
      }

      if (
        /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
          rawMessage,
        )
      ) {
        throw new GeminiRequestError({
          message:
            "Unable to reach the AI service. Please check your internet connection.",
          status: 503,
        });
      }

      if (/api.?key|permission.?denied|forbidden/i.test(rawMessage)) {
        throw new GeminiRequestError({
          message:
            "AI API key is invalid or missing. Please check your configuration.",
          status: 401,
        });
      }

      if (structuredStatusCode === 401 || structuredStatusCode === 403) {
        throw new GeminiRequestError({
          message:
            "AI API key is invalid or missing. Please check your configuration.",
          status: 401,
        });
      }

      throw new GeminiRequestError({
        message:
          rawMessage || "AI service encountered an error. Please try again.",
        status: structuredStatusCode ?? 500,
      });
    }
  }

  if (lastRateLimitError) {
    throw lastRateLimitError;
  }

  if (lastServiceUnavailableError) {
    throw lastServiceUnavailableError;
  }

  if (lastModelCompatibilityError) {
    throw lastModelCompatibilityError;
  }

  throw new GeminiRequestError({
    message: "No Gemini model candidate produced a valid response.",
    status: 500,
  });
};
