export type OpenRouterChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_details?: unknown;
};

export type OpenRouterAssistantMessage = {
  content: string;
  reasoning_details?: unknown;
};

export class OpenRouterRequestError extends Error {
  status: number;
  retryAfterSeconds: number | null;
  responseBody: unknown;

  constructor(args: {
    message: string;
    status: number;
    retryAfterSeconds: number | null;
    responseBody: unknown;
  }) {
    super(args.message);
    this.name = "OpenRouterRequestError";
    this.status = args.status;
    this.retryAfterSeconds = args.retryAfterSeconds;
    this.responseBody = args.responseBody;
  }
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_HTTP_REFERER =
  process.env.OPENROUTER_HTTP_REFERER?.trim() ||
  process.env.OPENROUTER_SITE_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "";
const OPENROUTER_TITLE =
  process.env.OPENROUTER_TITLE?.trim() ||
  process.env.OPENROUTER_SITE_NAME?.trim() ||
  process.env.NEXT_PUBLIC_APP_NAME?.trim() ||
  "";

const parseRetryAfter = (value: string | null) => {
  if (!value) {
    return null;
  }

  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }

  return null;
};

const normalizeAssistantContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }

      return "";
    })
    .join("");
};

export const requestOpenRouterCompletion = async (args: {
  apiKey: string;
  model?: string;
  models?: string[];
  messages: OpenRouterChatMessage[];
  enableReasoning?: boolean;
}) => {
  const apiKey = args.apiKey.trim();

  if (!apiKey) {
    throw new OpenRouterRequestError({
      message: "OpenRouter API key is missing",
      status: 500,
      retryAfterSeconds: null,
      responseBody: null,
    });
  }

  const requestedModels =
    args.models?.map((model) => model.trim()).filter(Boolean) ?? [];
  const primaryModel = args.model?.trim() ?? requestedModels[0] ?? "";

  if (!primaryModel) {
    throw new OpenRouterRequestError({
      message: "OpenRouter model is missing",
      status: 500,
      retryAfterSeconds: null,
      responseBody: null,
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (OPENROUTER_HTTP_REFERER) {
    headers["HTTP-Referer"] = OPENROUTER_HTTP_REFERER;
  }

  if (OPENROUTER_TITLE) {
    headers["X-OpenRouter-Title"] = OPENROUTER_TITLE;
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(requestedModels.length > 0
        ? { models: requestedModels }
        : { model: primaryModel }),
      messages: args.messages,
      ...(args.enableReasoning ? { reasoning: { enabled: true } } : {}),
    }),
  });

  const responseBody = (await response.json().catch(() => null)) as {
    model?: string;
    error?: { message?: string };
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_details?: unknown;
      };
    }>;
  } | null;

  if (!response.ok) {
    throw new OpenRouterRequestError({
      message:
        responseBody?.error?.message ??
        `OpenRouter request failed with status ${response.status}`,
      status: response.status,
      retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
      responseBody,
    });
  }

  const message = responseBody?.choices?.[0]?.message;
  const content = normalizeAssistantContent(message?.content);

  if (!content) {
    throw new OpenRouterRequestError({
      message: "OpenRouter response did not include assistant content",
      status: 502,
      retryAfterSeconds: null,
      responseBody,
    });
  }

  return {
    model: responseBody?.model ?? primaryModel,
    message: {
      content,
      reasoning_details: message?.reasoning_details,
    } satisfies OpenRouterAssistantMessage,
    retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
    responseBody,
  };
};
