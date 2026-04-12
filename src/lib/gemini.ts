import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY?.trim() ||
  process.env.GOOGLE_API_KEY?.trim() ||
  "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() || "";
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
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
const OPENROUTER_GEMMA_MODEL =
  process.env.OPENROUTER_GEMMA_MODEL?.trim() ||
  "google/gemma-4-26b-a4b-it:free";
const OPENROUTER_FALLBACK_MODELS = Array.from(
  new Set([
    ...(process.env.OPENROUTER_FALLBACK_MODELS?.split(",")
      .map((model) => model.trim())
      .filter(Boolean) ?? []),
    "google/gemma-4-31b-it:free",
    "google/gemma-3-27b-it:free",
    "openai/gpt-oss-20b:free",
  ]),
);
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME?.trim() || "Orbit";
const OPENROUTER_HTTP_REFERER =
  process.env.OPENROUTER_HTTP_REFERER?.trim() || "http://localhost:3000";
const OPENROUTER_REASONING_ENABLED = parseBooleanEnv(
  process.env.OPENROUTER_REASONING_ENABLED,
  true,
);
const OPENROUTER_PRESERVE_REASONING_DETAILS = parseBooleanEnv(
  process.env.OPENROUTER_PRESERVE_REASONING_DETAILS,
  true,
);

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
  const apiKey = GEMINI_API_KEY;
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

const getOpenRouterModelCandidates = () => {
  const unique = new Set<string>([
    OPENROUTER_GEMMA_MODEL,
    ...OPENROUTER_FALLBACK_MODELS,
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
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": OPENROUTER_HTTP_REFERER,
      "X-Title": OPENROUTER_APP_NAME,
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
  if (!OPENROUTER_API_KEY) {
    throw new GeminiRequestError({
      message:
        "Gemini quota exceeded and OpenRouter fallback is not configured. Add OPENROUTER_API_KEY in .env.local.",
      status: 429,
    });
  }

  const strategies = [
    {
      enableReasoning: OPENROUTER_REASONING_ENABLED,
      includeReasoningDetails: OPENROUTER_PRESERVE_REASONING_DETAILS,
    },
    {
      enableReasoning: false,
      includeReasoningDetails: OPENROUTER_PRESERVE_REASONING_DETAILS,
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

  const models = getOpenRouterModelCandidates();
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
