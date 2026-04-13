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

const getGeminiApiKey = () =>
  getRuntimeEnvValue("GEMINI_API_KEY") || getRuntimeEnvValue("GOOGLE_API_KEY");

const getGeminiKeyScope = (apiKey: string) => {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return "no-key";
  }

  // Do not store raw keys in memory structures used for diagnostics.
  const suffix = trimmed.slice(-6);
  return `${trimmed.length}:${suffix}`;
};

const toModelCooldownKey = (model: string, apiKey: string) =>
  `${model}::${getGeminiKeyScope(apiKey)}`;

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
    const nestedError = record.error as Record<string, unknown>;
    if (typeof nestedError.message === "string" && nestedError.message.trim()) {
      return nestedError.message;
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

const getGeminiFallbackModels = () => {
  const configured = getRuntimeEnvValue("GEMINI_FALLBACK_MODELS")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return Array.from(
    new Set([
      ...configured,
      "gemini-2.0-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
    ]),
  );
};

const getGeminiModelCandidates = (preferredModel: string) =>
  Array.from(new Set([preferredModel, ...getGeminiFallbackModels()]));

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

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }

  if (normalized === "0" || normalized === "false") {
    return false;
  }

  return fallback;
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

const getRequestAttemptBudget = () => ({
  maxGeminiModels: parseOptionalPositiveInt(
    getRuntimeEnvValue("AI_MAX_GEMINI_MODELS_PER_REQUEST"),
  ),
  maxOpenRouterModels: parseOptionalPositiveInt(
    getRuntimeEnvValue("AI_MAX_OPENROUTER_MODELS_PER_REQUEST"),
  ),
  maxOpenRouterStrategies: parseOptionalPositiveInt(
    getRuntimeEnvValue("AI_MAX_OPENROUTER_STRATEGIES_PER_REQUEST"),
  ),
});

const getOpenRouterConfig = () => {
  const fallbackModels = Array.from(
    new Set([
      ...(getRuntimeEnvValue("OPENROUTER_FALLBACK_MODELS")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean) ?? []),
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-3-27b-it:free",
      "openai/gpt-oss-20b:free",
    ]),
  );

  return {
    apiKey: getRuntimeEnvValue("OPENROUTER_API_KEY"),
    baseUrl:
      getRuntimeEnvValue("OPENROUTER_BASE_URL") ||
      "https://openrouter.ai/api/v1",
    primaryModel:
      getRuntimeEnvValue("OPENROUTER_GEMMA_MODEL") ||
      "google/gemma-4-31b-it:free",
    fallbackModels,
    appName: getRuntimeEnvValue("OPENROUTER_APP_NAME") || "Orbit",
    httpReferer:
      getRuntimeEnvValue("OPENROUTER_HTTP_REFERER") || "http://localhost:3000",
    preferFirst: parseBooleanEnv(
      getRuntimeEnvValue("OPENROUTER_PREFER_FIRST"),
      false,
    ),
    reasoningEnabled: parseBooleanEnv(
      getRuntimeEnvValue("OPENROUTER_REASONING_ENABLED"),
      true,
    ),
    preserveReasoningDetails: parseBooleanEnv(
      getRuntimeEnvValue("OPENROUTER_PRESERVE_REASONING_DETAILS"),
      true,
    ),
  };
};

/** Default model used across the app — configurable via GEMINI_MODEL env var */
export const GEMINI_MODEL_DEFAULT =
  getRuntimeEnvValue("GEMINI_MODEL") || "gemini-2.5-flash";

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

const extractOpenRouterErrorMessage = (payload: unknown, status: number) => {
  if (typeof payload !== "object" || payload === null) {
    return `OpenRouter request failed (${status})`;
  }

  const errorRecord =
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null
      ? (payload.error as Record<string, unknown>)
      : null;

  const directMessage =
    errorRecord && typeof errorRecord.message === "string"
      ? errorRecord.message
      : null;

  const errorCode =
    errorRecord && typeof errorRecord.code === "number"
      ? String(errorRecord.code)
      : errorRecord && typeof errorRecord.code === "string"
        ? errorRecord.code
        : null;

  // OpenRouter can nest provider details in metadata/raw fields.
  const metadata =
    errorRecord &&
    "metadata" in errorRecord &&
    typeof errorRecord.metadata === "object" &&
    errorRecord.metadata !== null
      ? (errorRecord.metadata as Record<string, unknown>)
      : null;

  const metadataRaw = metadata?.raw;
  if (typeof metadataRaw === "string" && metadataRaw.trim()) {
    return metadataRaw;
  }

  if (
    typeof metadataRaw === "object" &&
    metadataRaw !== null &&
    "message" in metadataRaw &&
    typeof (metadataRaw as Record<string, unknown>).message === "string"
  ) {
    return ((metadataRaw as Record<string, unknown>).message as string).trim();
  }

  if (directMessage?.trim()) {
    return errorCode ? `${directMessage} (code: ${errorCode})` : directMessage;
  }

  const providerName =
    metadata && typeof metadata.provider_name === "string"
      ? metadata.provider_name
      : null;

  if (providerName) {
    return `Provider returned error (${providerName})`;
  }

  return `OpenRouter request failed (${status})`;
};

const isRetryableOpenRouterError = (error: GeminiRequestError) => {
  if ([408, 409, 425, 429, 500, 502, 503, 504, 529].includes(error.status)) {
    return true;
  }

  const message = error.message.toLowerCase();

  if (
    /provider returned error|upstream|temporar|timeout|overload|unavailable|try again|rate.?limit|free-models-per-(?:min|minute|day)/i.test(
      message,
    )
  ) {
    return true;
  }

  if (
    error.status === 400 &&
    /model.*not.*found|invalid model|unknown model|not available/i.test(message)
  ) {
    return true;
  }

  return false;
};

const getOpenRouterModelCandidates = (
  config: ReturnType<typeof getOpenRouterConfig>,
) => {
  const unique = new Set<string>([
    config.primaryModel,
    ...config.fallbackModels,
  ]);
  return [...unique];
};

const buildOpenRouterRequestMessages = (
  messages: GeminiChatMessage[],
  includeReasoningDetails: boolean,
) =>
  messages.map((message) => ({
    role: message.role === "model" ? "assistant" : "user",
    content: message.content,
    ...(includeReasoningDetails &&
    message.role === "model" &&
    message.reasoning_details !== undefined
      ? { reasoning_details: message.reasoning_details }
      : {}),
  }));

const requestOpenRouterCompletion = async (args: {
  model: string;
  messages: GeminiChatMessage[];
  maxTokens?: number;
  temperature?: number;
  enableReasoning: boolean;
  includeReasoningDetails: boolean;
}) => {
  const openRouter = getOpenRouterConfig();

  const response = await fetch(`${openRouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouter.apiKey}`,
      "HTTP-Referer": openRouter.httpReferer,
      "X-Title": openRouter.appName,
    },
    body: JSON.stringify({
      model: args.model,
      messages: buildOpenRouterRequestMessages(
        args.messages,
        args.includeReasoningDetails,
      ),
      max_tokens: args.maxTokens,
      temperature: args.temperature,
      ...(args.enableReasoning ? { reasoning: { enabled: true } } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new GeminiRequestError({
      message: `[OpenRouter ${args.model}${args.enableReasoning ? " reasoning" : ""}${args.includeReasoningDetails ? " details" : ""}] ${extractOpenRouterErrorMessage(payload, response.status)}`,
      status: response.status,
    });
  }

  const assistantMessage = extractOpenRouterAssistantMessage(payload);
  const text = assistantMessage.content.trim();

  if (!text) {
    throw new GeminiRequestError({
      message: `[OpenRouter ${args.model}] response did not include any content`,
      status: 502,
    });
  }

  const responseModel =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).model === "string"
      ? ((payload as Record<string, unknown>).model as string)
      : args.model;

  return {
    content: text,
    model: responseModel,
    ...(assistantMessage.reasoning_details !== undefined
      ? { reasoning_details: assistantMessage.reasoning_details }
      : {}),
  } satisfies GeminiCompletionResult;
};

const extractOpenRouterAssistantMessage = (payload: unknown) => {
  if (typeof payload !== "object" || payload === null) {
    return { content: "" } as { content: string; reasoning_details?: unknown };
  }

  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: "" } as { content: string; reasoning_details?: unknown };
  }

  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) {
    return { content: "" } as { content: string; reasoning_details?: unknown };
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) {
    return { content: "" } as { content: string; reasoning_details?: unknown };
  }

  const messageRecord = message as Record<string, unknown>;
  const reasoningDetails = messageRecord.reasoning_details;

  const content = messageRecord.content;
  if (typeof content === "string") {
    return reasoningDetails === undefined
      ? { content }
      : { content, reasoning_details: reasoningDetails };
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as Record<string, unknown>).type === "text" &&
          "text" in part &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }

        return "";
      })
      .join("");

    return reasoningDetails === undefined
      ? { content: text }
      : { content: text, reasoning_details: reasoningDetails };
  }

  return { content: "" };
};

const generateOpenRouterFallbackCompletion = async (args: {
  config?: ReturnType<typeof getOpenRouterConfig>;
  messages: GeminiChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<GeminiCompletionResult> => {
  const openRouter = args.config ?? getOpenRouterConfig();
  const attemptBudget = getRequestAttemptBudget();

  if (!openRouter.apiKey) {
    throw new GeminiRequestError({
      message:
        "Gemini quota exceeded and OpenRouter fallback is not configured. Add OPENROUTER_API_KEY in .env.local.",
      status: 429,
    });
  }

  const strategies = applyAttemptCap(
    [
      {
        enableReasoning: openRouter.reasoningEnabled,
        includeReasoningDetails: openRouter.preserveReasoningDetails,
      },
      {
        enableReasoning: false,
        includeReasoningDetails: openRouter.preserveReasoningDetails,
      },
      {
        enableReasoning: false,
        includeReasoningDetails: false,
      },
    ].filter(
      (strategy, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.enableReasoning === strategy.enableReasoning &&
            candidate.includeReasoningDetails ===
              strategy.includeReasoningDetails,
        ) === index,
    ),
    attemptBudget.maxOpenRouterStrategies,
  );

  const models = applyAttemptCap(
    getOpenRouterModelCandidates(openRouter),
    attemptBudget.maxOpenRouterModels,
  );
  let lastError: GeminiRequestError | null = null;

  for (const model of models) {
    for (const strategy of strategies) {
      try {
        return await requestOpenRouterCompletion({
          model,
          messages: args.messages,
          maxTokens: args.maxTokens,
          temperature: args.temperature,
          enableReasoning: strategy.enableReasoning,
          includeReasoningDetails: strategy.includeReasoningDetails,
        });
      } catch (error) {
        if (error instanceof GeminiRequestError) {
          if (
            error.status === 429 &&
            /rate.?limit|too many requests|free-models-per-(?:min|minute|day)/i.test(
              error.message,
            )
          ) {
            throw error;
          }

          lastError = error;

          if (!isRetryableOpenRouterError(error)) {
            throw error;
          }

          continue;
        }

        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new GeminiRequestError({
    message: "OpenRouter fallback failed without an explicit error.",
    status: 500,
  });
};

/**
 * Generate a single response from Gemini.
 */
export const generateGeminiCompletion = async (args: {
  model?: string;
  messages: GeminiChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<GeminiCompletionResult> => {
  const attemptBudget = getRequestAttemptBudget();
  let ai: GoogleGenAI | null = null;
  const activeGeminiApiKey = getGeminiApiKey();
  const openRouterConfig = getOpenRouterConfig();
  const shouldTryOpenRouterFirst =
    openRouterConfig.preferFirst && Boolean(openRouterConfig.apiKey);
  let openRouterFirstError: GeminiRequestError | null = null;
  const modelName = (args.model ?? GEMINI_MODEL_DEFAULT).trim();
  const modelCandidates = applyAttemptCap(
    getGeminiModelCandidates(modelName),
    attemptBudget.maxGeminiModels,
  );
  let lastQuotaOrRateLimitError: GeminiRequestError | null = null;
  let lastModelCompatibilityError: GeminiRequestError | null = null;

  if (shouldTryOpenRouterFirst) {
    try {
      return await generateOpenRouterFallbackCompletion({
        config: openRouterConfig,
        messages: args.messages,
        maxTokens: args.maxTokens,
        temperature: args.temperature,
      });
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        openRouterFirstError = error;
      } else {
        throw error;
      }
    }
  }

  // Build contents for multi-turn conversation
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
      lastQuotaOrRateLimitError = new GeminiRequestError({
        message: `Model ${candidateModel} is temporarily rate-limited. Please retry in ${cooldownSeconds}s.`,
        status: 429,
      });
      continue;
    }

    try {
      ai ??= getClient();
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents,
        config: {
          maxOutputTokens: args.maxTokens,
          temperature: args.temperature,
        },
      });

      const text = response.text ?? "";

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
      const retryAfterSeconds = parseRetryAfterSeconds(rawMessage);

      // Detect rate limiting / quota issues
      const isRateLimited =
        rawMessage.includes("429") ||
        /rate.?limit/i.test(rawMessage) ||
        /quota/i.test(rawMessage) ||
        /resource.?exhausted/i.test(rawMessage) ||
        /too many requests/i.test(rawMessage);

      // Detect quota specifically (different from transient rate limit)
      const isQuotaExhausted =
        /quota.?exceed/i.test(rawMessage) ||
        /resource.?exhausted/i.test(rawMessage) ||
        /free.?tier/i.test(rawMessage) ||
        /limit:\s*0/i.test(rawMessage);
      const isProjectQuotaZero =
        isQuotaExhausted && /limit:\s*0/i.test(rawMessage);

      const isModelCompatibilityIssue =
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

      if (isQuotaExhausted || isRateLimited) {
        setModelCooldown(candidateModel, retryAfterSeconds, activeGeminiApiKey);

        const cooldownForMessage =
          retryAfterSeconds ??
          getModelCooldownSeconds(candidateModel, activeGeminiApiKey) ??
          10;
        lastQuotaOrRateLimitError = new GeminiRequestError({
          message: isProjectQuotaZero
            ? `Gemini quota is 0 for ${candidateModel} in the current project. Rotating API keys inside the same project does not reset quota. Retry in ${cooldownForMessage}s, use a billing-enabled project, or enable OpenRouter fallback.`
            : isQuotaExhausted
              ? `AI usage quota for ${candidateModel} is exhausted. Retry in ${cooldownForMessage}s or use a fallback provider.`
              : `AI model ${candidateModel} is rate-limited. Retry in ${cooldownForMessage}s.`,
          status: 429,
        });

        continue;
      }

      // Detect network / connectivity issues
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

      // Detect invalid API key
      if (/api.?key|permission.?denied|forbidden/i.test(rawMessage)) {
        if (lastQuotaOrRateLimitError) {
          continue;
        }

        throw new GeminiRequestError({
          message:
            "AI API key is invalid or missing. Please check your configuration.",
          status: 401,
        });
      }

      throw new GeminiRequestError({
        message:
          rawMessage || "AI service encountered an error. Please try again.",
        status: 500,
      });
    }
  }

  const hasOpenRouterFallback = Boolean(openRouterConfig.apiKey);

  if (!hasOpenRouterFallback) {
    if (lastQuotaOrRateLimitError) {
      throw lastQuotaOrRateLimitError;
    }

    if (lastModelCompatibilityError) {
      throw lastModelCompatibilityError;
    }
  }

  try {
    if (openRouterFirstError) {
      throw openRouterFirstError;
    }

    return await generateOpenRouterFallbackCompletion({
      config: openRouterConfig,
      messages: args.messages,
      maxTokens: args.maxTokens,
      temperature: args.temperature,
    });
  } catch (fallbackError) {
    if (fallbackError instanceof GeminiRequestError) {
      if (fallbackError.status >= 500 && lastQuotaOrRateLimitError) {
        throw lastQuotaOrRateLimitError;
      }

      if (fallbackError.status === 429 && lastQuotaOrRateLimitError) {
        throw new GeminiRequestError({
          message:
            "All configured AI providers are currently rate-limited. Please retry shortly.",
          status: 429,
        });
      }

      throw fallbackError;
    }

    if (lastQuotaOrRateLimitError) {
      throw lastQuotaOrRateLimitError;
    }

    throw new GeminiRequestError({
      message:
        fallbackError instanceof Error
          ? fallbackError.message
          : "AI service encountered an error. Please try again.",
      status: 500,
    });
  }
};
