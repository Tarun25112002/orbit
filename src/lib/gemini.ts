import { GoogleGenAI } from "@google/genai";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { classifyError } from "@/lib/errors";

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

const parseOptionalNonNegativeInt = (value: string) => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
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

const jitterMs = (baseMs: number) => {
  const jitterRange = Math.max(50, Math.floor(baseMs * 0.2));
  return Math.floor(Math.random() * jitterRange);
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

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
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-live-preview",
] as const;

const getGeminiFallbackModels = () => {
  const configured = getRuntimeEnvValue("GEMINI_FALLBACK_MODELS")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return Array.from(new Set([...configured, ...GEMINI_FREE_FALLBACK_CHAIN]));
};

const getGeminiModelCandidates = (preferredModel: string) =>
  Array.from(new Set([preferredModel, ...getGeminiFallbackModels()]));

type GeminiExecutionPolicy = {
  maxGeminiModels: number | null;
  maxRetriesPerModel: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  tokenWindowMs: number;
  requestsPerWindow: number | null;
  tokensPerWindow: number | null;
};

const getGeminiExecutionPolicy = (): GeminiExecutionPolicy => ({
  maxGeminiModels: parseOptionalPositiveInt(
    getRuntimeEnvValue("AI_MAX_GEMINI_MODELS_PER_REQUEST"),
  ),
  maxRetriesPerModel:
    parseOptionalNonNegativeInt(
      getRuntimeEnvValue("AI_GEMINI_MAX_RETRIES_PER_MODEL"),
    ) ?? 1,
  backoffBaseMs:
    parseOptionalPositiveInt(getRuntimeEnvValue("AI_GEMINI_BACKOFF_BASE_MS")) ??
    750,
  backoffMaxMs:
    parseOptionalPositiveInt(getRuntimeEnvValue("AI_GEMINI_BACKOFF_MAX_MS")) ??
    20_000,
  tokenWindowMs:
    parseOptionalPositiveInt(getRuntimeEnvValue("AI_GEMINI_WINDOW_MS")) ??
    60_000,
  requestsPerWindow: parseOptionalPositiveInt(
    getRuntimeEnvValue("AI_GEMINI_RPM_LIMIT"),
  ),
  tokensPerWindow: parseOptionalPositiveInt(
    getRuntimeEnvValue("AI_GEMINI_TPM_LIMIT"),
  ),
});

type GeminiWindowUsage = {
  timestamps: number[];
  tokenEvents: Array<{ atMs: number; tokens: number }>;
};

const geminiUsageWindowByKey = new Map<string, GeminiWindowUsage>();

const getGeminiUsageWindowKey = (model: string, apiKey: string) =>
  `${model}::${getGeminiKeyScope(apiKey)}`;

export type GeminiChatMessage = {
  role: "user" | "model";
  content: string;
  reasoning_details?: unknown;
};

const estimateGeminiPromptTokens = (args: {
  system?: string;
  messages: GeminiChatMessage[];
}) => {
  const systemChars = args.system?.length ?? 0;
  const messageChars = args.messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );

  return Math.max(1, Math.ceil((systemChars + messageChars) / 4));
};

const consumeGeminiWindowBudget = (args: {
  model: string;
  apiKey: string;
  promptTokens: number;
  policy: GeminiExecutionPolicy;
}) => {
  if (
    typeof args.policy.requestsPerWindow !== "number" &&
    typeof args.policy.tokensPerWindow !== "number"
  ) {
    return { allowed: true as const };
  }

  const key = getGeminiUsageWindowKey(args.model, args.apiKey);
  const now = Date.now();
  const windowStart = now - args.policy.tokenWindowMs;
  const usage = geminiUsageWindowByKey.get(key) ?? {
    timestamps: [],
    tokenEvents: [],
  };

  usage.timestamps = usage.timestamps.filter(
    (timestamp) => timestamp >= windowStart,
  );
  usage.tokenEvents = usage.tokenEvents.filter(
    (event) => event.atMs >= windowStart,
  );

  if (
    typeof args.policy.requestsPerWindow === "number" &&
    usage.timestamps.length >= args.policy.requestsPerWindow
  ) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((usage.timestamps[0]! + args.policy.tokenWindowMs - now) / 1_000),
    );
    geminiUsageWindowByKey.set(key, usage);
    return { allowed: false as const, retryAfterSeconds };
  }

  if (typeof args.policy.tokensPerWindow === "number") {
    const usedTokens = usage.tokenEvents.reduce(
      (sum, event) => sum + event.tokens,
      0,
    );
    if (usedTokens + args.promptTokens > args.policy.tokensPerWindow) {
      const earliestTokenEvent = usage.tokenEvents[0]?.atMs ?? now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((earliestTokenEvent + args.policy.tokenWindowMs - now) / 1_000),
      );
      geminiUsageWindowByKey.set(key, usage);
      return { allowed: false as const, retryAfterSeconds };
    }
  }

  usage.timestamps.push(now);
  usage.tokenEvents.push({ atMs: now, tokens: args.promptTokens });
  geminiUsageWindowByKey.set(key, usage);
  return { allowed: true as const };
};

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
  return remainingMs > 0 ? Math.ceil(remainingMs / 1_000) : 0;
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
    Date.now() + seconds * 1_000,
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

export const GEMINI_MODEL_PREFERRED =
  getRuntimeEnvValue("GEMINI_MODEL") || GEMINI_FREE_FALLBACK_CHAIN[0];
export const GEMINI_MODEL_DEFAULT = GEMINI_MODEL_PREFERRED;

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
  system?: string;
  reasoningEffort?: "low" | "medium" | "high";
  onStreamChunk?: (chunk: string, fullText: string) => void;
  onAttempt?: (payload: {
    attempt: number;
    model: string;
    error: GeminiRequestError;
    willRetry: boolean;
    retryAfterSeconds?: number | null;
  }) => void;
}): Promise<GeminiCompletionResult> => {
  const modelName = (args.model ?? GEMINI_MODEL_DEFAULT).trim();
  const policy = getGeminiExecutionPolicy();
  const modelCandidates = applyAttemptCap(
    getGeminiModelCandidates(modelName),
    policy.maxGeminiModels,
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
  let globalAttempt = 0;
  const promptTokens = estimateGeminiPromptTokens({
    system: args.system,
    messages: args.messages,
  });

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

    for (
      let attemptForModel = 0;
      attemptForModel <= policy.maxRetriesPerModel;
      attemptForModel += 1
    ) {
      globalAttempt += 1;
      const budgetCheck = consumeGeminiWindowBudget({
        model: candidateModel,
        apiKey: activeGeminiApiKey,
        promptTokens,
        policy,
      });
      if (!budgetCheck.allowed) {
        setModelCooldown(
          candidateModel,
          budgetCheck.retryAfterSeconds,
          activeGeminiApiKey,
        );
        lastRateLimitError = new GeminiRequestError({
          message: `AI model ${candidateModel} reached configured token/request limits. Retry in ${budgetCheck.retryAfterSeconds}s.`,
          status: 429,
        });
        (
          lastRateLimitError as GeminiRequestError & {
            retryAfterSeconds?: number;
          }
        ).retryAfterSeconds = budgetCheck.retryAfterSeconds;
        args.onAttempt?.({
          attempt: globalAttempt,
          model: candidateModel,
          error: lastRateLimitError,
          willRetry: false,
          retryAfterSeconds: budgetCheck.retryAfterSeconds,
        });
        break;
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

        const responseStream = await ai.models.generateContentStream({
          model: candidateModel,
          contents,
          config,
        });

        let text = "";
        for await (const chunk of responseStream) {
          if (chunk.text) {
            text += chunk.text;
            args.onStreamChunk?.(chunk.text, text);
          }
        }

        text = text.trim();
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
          args.onAttempt?.({
            attempt: globalAttempt,
            model: candidateModel,
            error: lastModelCompatibilityError,
            willRetry: false,
          });
          break;
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
          (
            lastRateLimitError as GeminiRequestError & {
              retryAfterSeconds?: number;
            }
          ).retryAfterSeconds = cooldownForMessage;
          args.onAttempt?.({
            attempt: globalAttempt,
            model: candidateModel,
            error: lastRateLimitError,
            willRetry: false,
            retryAfterSeconds: cooldownForMessage,
          });
          break;
        }

        const classified = classifyError(error);
        const shouldRetrySameModel =
          classified.retryable && attemptForModel < policy.maxRetriesPerModel;
        const wrappedError = new GeminiRequestError({
          message:
            rawMessage || "AI service encountered an error. Please try again.",
          status: structuredStatusCode ?? 500,
        });
        (
          wrappedError as GeminiRequestError & {
            retryAfterSeconds?: number;
          }
        ).retryAfterSeconds = classified.retryAfterSeconds;

        args.onAttempt?.({
          attempt: globalAttempt,
          model: candidateModel,
          error: wrappedError,
          willRetry: shouldRetrySameModel,
          retryAfterSeconds: classified.retryAfterSeconds ?? null,
        });

        if (shouldRetrySameModel) {
          const backoffMs = Math.min(
            policy.backoffMaxMs,
            policy.backoffBaseMs * 2 ** attemptForModel,
          );
          await sleep(backoffMs + jitterMs(backoffMs));
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

        if (isServiceUnavailableError || classified.category === "network") {
          setModelCooldown(candidateModel, 8, activeGeminiApiKey);
          lastServiceUnavailableError = new GeminiRequestError({
            message: `AI model ${candidateModel} is temporarily unavailable.`,
            status: structuredStatusCode ?? 503,
          });
          continue;
        }

        if (structuredStatusCode === 401 || structuredStatusCode === 403) {
          throw new GeminiRequestError({
            message:
              "AI API key is invalid or missing. Please check your configuration.",
            status: 401,
          });
        }

        throw wrappedError;
      }
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
