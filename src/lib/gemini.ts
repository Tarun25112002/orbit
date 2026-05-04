import { GoogleGenAI } from "@google/genai";
import { createGroq } from "@ai-sdk/groq";
import { generateText, streamText } from "ai";
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

const getAllGroqApiKeys = (): string[] => {
  const commaKeys = getRuntimeEnvValue("GROQ_API_KEYS");
  if (commaKeys) {
    const keys = commaKeys.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  const indexed: string[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const key = getRuntimeEnvValue(`GROQ_API_KEY_${i}`);
    if (key) indexed.push(key);
  }
  if (indexed.length > 0) return indexed;
  const single = getRuntimeEnvValue("GROQ_API_KEY");
  return single ? [single] : [];
};

let cachedGroqKeys: string[] | null = null;
const getGroqKeys = (): string[] => {
  if (cachedGroqKeys === null) cachedGroqKeys = getAllGroqApiKeys();
  return cachedGroqKeys;
};

const getGroqApiKey = () => {
  const keys = getGroqKeys();
  return keys.length > 0 ? keys[0]! : "";
};

const isGroqEnabled = () => getGroqKeys().length > 0;

const GROQ_CALL_TIMEOUT_MS = 90_000;
const groqKeyCooldownUntilMs = new Map<string, number>();
let groqKeyRoundRobinIndex = 0;

const setGroqKeyCooldown = (apiKey: string, seconds: number) => {
  groqKeyCooldownUntilMs.set(apiKey, Date.now() + Math.max(1, seconds) * 1000);
};

const isGroqKeyCoolingDown = (apiKey: string): boolean => {
  const until = groqKeyCooldownUntilMs.get(apiKey);
  if (!until) return false;
  if (Date.now() >= until) { groqKeyCooldownUntilMs.delete(apiKey); return false; }
  return true;
};

const pickAvailableGroqKey = (): { key: string; index: number } | null => {
  const keys = getGroqKeys();
  if (keys.length === 0) return null;
  for (let offset = 0; offset < keys.length; offset += 1) {
    const index = (groqKeyRoundRobinIndex + offset) % keys.length;
    const key = keys[index]!;
    if (!isGroqKeyCoolingDown(key)) {
      groqKeyRoundRobinIndex = (index + 1) % keys.length;
      return { key, index };
    }
  }
  let bestKey: string | null = null;
  let bestIndex = 0;
  let earliestExpiry = Infinity;
  for (let i = 0; i < keys.length; i += 1) {
    const until = groqKeyCooldownUntilMs.get(keys[i]!) ?? 0;
    if (until < earliestExpiry) { earliestExpiry = until; bestKey = keys[i]!; bestIndex = i; }
  }
  if (bestKey) {
    groqKeyRoundRobinIndex = (bestIndex + 1) % keys.length;
    return { key: bestKey, index: bestIndex };
  }
  return null;
};

const getGroqModel = () =>
  getRuntimeEnvValue("GROQ_MODEL") || "openai/gpt-oss-120b";
const getGroqTpmBudget = () =>
  parseOptionalPositiveInt(getRuntimeEnvValue("GROQ_TPM_BUDGET")) ?? 131_000;
const getGroqTokenSafetyMargin = () =>
  parseOptionalPositiveInt(getRuntimeEnvValue("GROQ_TOKEN_SAFETY_MARGIN")) ??
  500;
const getGroqDefaultMaxOutputTokens = () =>
  parseOptionalPositiveInt(
    getRuntimeEnvValue("GROQ_DEFAULT_MAX_OUTPUT_TOKENS"),
  ) ?? 32_768;
const getGroqMinOutputTokens = () =>
  parseOptionalPositiveInt(getRuntimeEnvValue("GROQ_MIN_OUTPUT_TOKENS")) ??
  4_096;
const getGroqMaxCompactionAttempts = () =>
  parseOptionalPositiveInt(
    getRuntimeEnvValue("GROQ_MAX_COMPACTION_ATTEMPTS"),
  ) ?? 4;
const getGroqMaxInputChars = () =>
  parseOptionalPositiveInt(getRuntimeEnvValue("GROQ_MAX_INPUT_CHARS")) ??
  80_000;
const GROQ_TRUNCATION_MARKER = "\n...[truncated for token budget]...\n";

type GroqAiMessage = {
  role: "user" | "assistant";
  content: string;
};

const estimateTokensFromGroqPayload = (args: {
  system?: string;
  messages: GroqAiMessage[];
}) => {
  const systemChars = args.system?.length ?? 0;
  const messageChars = args.messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );

  return Math.ceil((systemChars + messageChars) / 4);
};

const truncateTextKeepingEdges = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= GROQ_TRUNCATION_MARKER.length + 24) {
    return value.slice(value.length - maxChars);
  }

  const contentBudget = maxChars - GROQ_TRUNCATION_MARKER.length;
  const headLength = Math.max(24, Math.floor(contentBudget * 0.65));
  const tailLength = Math.max(24, contentBudget - headLength);

  return `${value.slice(0, headLength)}${GROQ_TRUNCATION_MARKER}${value.slice(value.length - tailLength)}`;
};

const compactGroqPayloadByChars = (args: {
  system?: string;
  messages: GroqAiMessage[];
  maxChars: number;
}) => {
  const normalizedMaxChars = Math.max(800, args.maxChars);
  const system = args.system?.trim();

  const systemBudget = system
    ? Math.min(
        Math.max(400, Math.floor(normalizedMaxChars * 0.40)),
        Math.floor(normalizedMaxChars * 0.55),
      )
    : 0;

  const compactSystem = system
    ? truncateTextKeepingEdges(system, systemBudget)
    : undefined;

  const messageBudget = Math.max(
    400,
    normalizedMaxChars - (compactSystem?.length ?? 0),
  );
  const compactMessages: GroqAiMessage[] = [];
  let remaining = messageBudget;

  for (let index = args.messages.length - 1; index >= 0; index -= 1) {
    const message = args.messages[index]!;

    if (remaining <= 0) {
      break;
    }

    if (message.content.length <= remaining) {
      compactMessages.unshift(message);
      remaining -= message.content.length;
      continue;
    }

    compactMessages.unshift({
      ...message,
      content: truncateTextKeepingEdges(message.content, remaining),
    });
    remaining = 0;
  }

  if (compactMessages.length === 0 && args.messages.length > 0) {
    const last = args.messages[args.messages.length - 1]!;
    compactMessages.push({
      ...last,
      content: truncateTextKeepingEdges(last.content, messageBudget),
    });
  }

  return {
    system: compactSystem,
    messages: compactMessages,
  };
};

const isGroqRequestTooLargeError = (message: string) =>
  /request too large|tokens per minute|\bTPM\b|requested\s+\d+/i.test(message);

const buildGroqTokenPlan = (args: {
  requestedMaxOutputTokens?: number;
  promptTokens: number;
}) => {
  const requestedOutputTokens =
    args.requestedMaxOutputTokens ?? getGroqDefaultMaxOutputTokens();
  const availableOutputTokens =
    getGroqTpmBudget() - getGroqTokenSafetyMargin() - args.promptTokens;

  if (availableOutputTokens >= getGroqMinOutputTokens()) {
    return {
      maxOutputTokens: Math.max(
        getGroqMinOutputTokens(),
        Math.min(requestedOutputTokens, availableOutputTokens),
      ),
      requiresCompaction: false,
    };
  }

  return {
    maxOutputTokens: getGroqMinOutputTokens(),
    requiresCompaction: true,
  };
};

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

export const GEMINI_MODEL_DEFAULT = isGroqEnabled()
  ? getGroqModel()
  : getRuntimeEnvValue("GEMINI_MODEL") || GEMINI_FREE_FALLBACK_CHAIN[0];

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

const getGroqClientForKey = (apiKey: string) => {
  if (!apiKey) {
    throw new GeminiRequestError({ message: "GROQ_API_KEY is not configured", status: 500 });
  }
  return createGroq({ apiKey });
};

const getGroqClient = () => {
  const picked = pickAvailableGroqKey();
  if (!picked) {
    throw new GeminiRequestError({ message: "No Groq API keys are configured", status: 500 });
  }
  return createGroq({ apiKey: picked.key });
};

const generateGroqCompletionWithKey = async (args: {
  apiKey: string;
  keyIndex: number;
  model?: string;
  messages: GeminiChatMessage[];
  maxTokens?: number;
  temperature?: number;
  system?: string;
  reasoningEffort?: "low" | "medium" | "high";
  onStreamChunk?: (chunk: string, fullText: string) => void;
}): Promise<GeminiCompletionResult> => {
  const groq = getGroqClientForKey(args.apiKey);
  const modelId = args.model ?? getGroqModel();
  const originalMessages: GroqAiMessage[] = args.messages.map((msg) => ({
    role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
    content: msg.content,
  }));

  const maxAttempts = Math.max(1, getGroqMaxCompactionAttempts());
  let charBudget = getGroqMaxInputChars();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const compactPayload = compactGroqPayloadByChars({
      system: args.system, messages: originalMessages, maxChars: charBudget,
    });
    const promptTokens = estimateTokensFromGroqPayload(compactPayload);
    const tokenPlan = buildGroqTokenPlan({ requestedMaxOutputTokens: args.maxTokens, promptTokens });

    if (tokenPlan.requiresCompaction) {
      const promptTokenBudget = Math.max(500, getGroqTpmBudget() - getGroqTokenSafetyMargin() - getGroqMinOutputTokens());
      charBudget = Math.max(1_000, Math.min(charBudget, Math.floor(promptTokenBudget * 4)));
    }

    const retryPayload = compactGroqPayloadByChars({
      system: args.system, messages: originalMessages, maxChars: charBudget,
    });

    try {
      const result = await streamText({
        model: groq(modelId),
        ...(retryPayload.system ? { system: retryPayload.system } : {}),
        messages: retryPayload.messages,
        maxOutputTokens: tokenPlan.maxOutputTokens,
        temperature: args.temperature ?? 0.2,
        ...(args.reasoningEffort
          ? { providerOptions: { groq: { reasoningEffort: args.reasoningEffort } } }
          : {}),
        abortSignal: AbortSignal.timeout(GROQ_CALL_TIMEOUT_MS),
      });

      let text = "";
      for await (const chunk of result.textStream) {
        text += chunk;
        args.onStreamChunk?.(chunk, text);
      }
      text = text.trim();

      if (!text) {
        throw new GeminiRequestError({ message: "Groq response did not include any content", status: 502 });
      }
      return { content: text, model: `groq:${modelId}` };
    } catch (error) {
      if (error instanceof GeminiRequestError) throw error;

      const rawMessage = extractRawErrorMessage(error);
      const structuredStatusCode = extractStructuredStatusCode(error);

      if (attempt < maxAttempts && isRateLimitedGeminiError({ statusCode: structuredStatusCode, message: rawMessage }) && isGroqRequestTooLargeError(rawMessage)) {
        charBudget = Math.max(1_000, Math.floor(charBudget * 0.65));
        lastError = error;
        continue;
      }

      if (structuredStatusCode === 413 || isGroqRequestTooLargeError(rawMessage)) {
        throw new GeminiRequestError({ message: `Groq payload too large (${rawMessage.slice(0, 150)}). Falling back.`, status: 413 });
      }

      const isRateLimited = isRateLimitedGeminiError({ statusCode: structuredStatusCode, message: rawMessage });
      if (isRateLimited) {
        const retrySeconds = parseRetryAfterSeconds(rawMessage) ?? extractStructuredRetryAfterSeconds(error) ?? 15;
        setGroqKeyCooldown(args.apiKey, retrySeconds);
        console.warn("groq.key-rate-limited", { keyIndex: args.keyIndex, keySlice: args.apiKey.slice(-6), retrySeconds, model: modelId });
        throw new GeminiRequestError({ message: `Groq key #${args.keyIndex + 1} rate-limited for ${retrySeconds}s. ${rawMessage}`, status: 429 });
      }

      if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|abort/i.test(rawMessage)) {
        throw new GeminiRequestError({ message: "Unable to reach Groq. Please check your internet connection.", status: 503 });
      }

      if (/api.?key|permission.?denied|forbidden|unauthorized/i.test(rawMessage)) {
        setGroqKeyCooldown(args.apiKey, 600);
        throw new GeminiRequestError({ message: `Groq API key #${args.keyIndex + 1} is invalid. Cooling down for 10 min.`, status: 401 });
      }

      throw new GeminiRequestError({ message: rawMessage || "Groq service encountered an error. Please try again.", status: structuredStatusCode ?? 500 });
    }
  }

  const fallbackMessage = extractRawErrorMessage(lastError);
  throw new GeminiRequestError({ message: fallbackMessage || "Groq service encountered an error. Please try again.", status: extractStructuredStatusCode(lastError) ?? 429 });
};

const generateGroqCompletion = async (args: {
  model?: string;
  messages: GeminiChatMessage[];
  maxTokens?: number;
  temperature?: number;
  system?: string;
  reasoningEffort?: "low" | "medium" | "high";
  onStreamChunk?: (chunk: string, fullText: string) => void;
}): Promise<GeminiCompletionResult> => {
  const keys = getGroqKeys();
  if (keys.length === 0) {
    throw new GeminiRequestError({ message: "No Groq API keys configured", status: 500 });
  }

  const triedKeyIndices = new Set<number>();
  let lastKeyError: GeminiRequestError | null = null;

  for (let round = 0; round < keys.length; round += 1) {
    const picked = pickAvailableGroqKey();
    if (!picked || triedKeyIndices.has(picked.index)) continue;
    triedKeyIndices.add(picked.index);

    console.info("groq.multi-key.attempt", { round: round + 1, totalKeys: keys.length, keyIndex: picked.index, keySlice: picked.key.slice(-6) });

    try {
      return await generateGroqCompletionWithKey({ ...args, apiKey: picked.key, keyIndex: picked.index });
    } catch (error) {
      if (!(error instanceof GeminiRequestError)) throw error;
      lastKeyError = error;

      if (error.status === 429) {
        console.warn("groq.multi-key.rotate", { failedKeyIndex: picked.index, status: error.status, message: error.message.slice(0, 120), remainingKeys: keys.length - triedKeyIndices.size });
        continue;
      }
      if (error.status === 502 || error.status === 503) {
        setGroqKeyCooldown(picked.key, 8);
        console.warn("groq.multi-key.service-error-rotate", { failedKeyIndex: picked.index, status: error.status, remainingKeys: keys.length - triedKeyIndices.size });
        continue;
      }
      throw error;
    }
  }

  if (lastKeyError) throw lastKeyError;
  throw new GeminiRequestError({ message: "All Groq API keys exhausted. Falling back.", status: 429 });
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
}): Promise<GeminiCompletionResult> => {
  const modelName = (args.model ?? GEMINI_MODEL_DEFAULT).trim();
  const isExplicitGeminiModel = modelName.toLowerCase().startsWith("gemini-");
  const shouldUseGroq = isGroqEnabled() && !isExplicitGeminiModel;

  if (shouldUseGroq) {

    const estimatedPayloadTokens = estimateTokensFromGroqPayload({
      system: args.system,
      messages: args.messages.map((msg) => ({
        role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
      })),
    });
    const tpmBudget = getGroqTpmBudget();
    const payloadExceedsBudget =
      estimatedPayloadTokens + getGroqMinOutputTokens() > tpmBudget;

    if (payloadExceedsBudget && getGeminiApiKey()) {
      console.warn("groq.skip-payload-too-large", {
        estimatedTokens: estimatedPayloadTokens,
        tpmBudget,
        minOutputTokens: getGroqMinOutputTokens(),
        reason: "Payload exceeds TPM budget, skipping to Gemini",
      });

    } else {
      try {
        return await generateGroqCompletion({ ...args, model: modelName });
      } catch (error) {
        if (error instanceof GeminiRequestError && error.status === 401) {
          throw error;
        }
        const geminiKey = getGeminiApiKey();
        if (geminiKey && error instanceof GeminiRequestError) {
          console.warn("groq.all-keys-exhausted-fallback-to-gemini", {
            groqError: error.message,
            status: error.status,
            totalKeys: getGroqKeys().length,
          });
        } else if (!geminiKey) {
          throw error;
        }
      }
    }
  }

  const attemptBudget = getRequestAttemptBudget();

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
