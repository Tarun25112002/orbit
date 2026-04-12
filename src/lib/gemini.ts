import { GoogleGenAI } from "@google/genai";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_ENV_PATH = resolve(process.cwd(), ".env.local");
let cachedLocalEnvMtimeMs: number | null = null;
let cachedLocalEnvValues: Record<string, string> = {};

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

const getOpenRouterConfig = () => {
  const fallbackModels = Array.from(
    new Set([
      ...(getRuntimeEnvValue("OPENROUTER_FALLBACK_MODELS")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean) ?? []),
      "google/gemma-4-31b-it:free",
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
      "google/gemma-4-26b-a4b-it:free",
    fallbackModels,
    appName: getRuntimeEnvValue("OPENROUTER_APP_NAME") || "Orbit",
    httpReferer:
      getRuntimeEnvValue("OPENROUTER_HTTP_REFERER") || "http://localhost:3000",
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
  process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

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
  messages: GeminiChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<GeminiCompletionResult> => {
  const openRouter = getOpenRouterConfig();

  if (!openRouter.apiKey) {
    throw new GeminiRequestError({
      message:
        "Gemini quota exceeded and OpenRouter fallback is not configured. Add OPENROUTER_API_KEY in .env.local.",
      status: 429,
    });
  }

  const strategies = [
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
  );

  const models = getOpenRouterModelCandidates(openRouter);
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
  const ai = getClient();
  const modelName = args.model ?? GEMINI_MODEL_DEFAULT;

  // Build contents for multi-turn conversation
  const contents = args.messages.map((msg) => ({
    role: msg.role === "user" ? ("user" as const) : ("model" as const),
    parts: [{ text: msg.content }],
  }));

  try {
    const response = await ai.models.generateContent({
      model: modelName,
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
      model: modelName,
    };
  } catch (error) {
    if (error instanceof GeminiRequestError) {
      throw error;
    }

    const rawMessage =
      error instanceof Error ? error.message : "Gemini request failed";

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

    if (isQuotaExhausted) {
      try {
        return await generateOpenRouterFallbackCompletion({
          messages: args.messages,
          maxTokens: args.maxTokens,
          temperature: args.temperature,
        });
      } catch (fallbackError) {
        if (fallbackError instanceof GeminiRequestError) {
          throw fallbackError;
        }

        throw new GeminiRequestError({
          message:
            fallbackError instanceof Error
              ? fallbackError.message
              : "AI usage quota has been exceeded.",
          status: 429,
        });
      }
    }

    if (isRateLimited) {
      throw new GeminiRequestError({
        message:
          "AI is temporarily busy due to rate limits. Please wait a moment and try again.",
        status: 429,
      });
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
      throw new GeminiRequestError({
        message:
          "AI API key is invalid or missing. Please check your configuration.",
        status: 401,
      });
    }

    throw new GeminiRequestError({
      message: "AI service encountered an error. Please try again.",
      status: 500,
    });
  }
};
