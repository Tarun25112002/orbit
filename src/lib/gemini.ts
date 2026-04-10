import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY?.trim() ||
  process.env.GOOGLE_API_KEY?.trim() ||
  "";

export type GeminiChatMessage = {
  role: "user" | "model";
  content: string;
};

export type GeminiCompletionResult = {
  content: string;
  model: string;
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
  const modelName = args.model ?? "gemini-2.0-flash";

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

    const message =
      error instanceof Error ? error.message : "Gemini request failed";

    // Check for rate limiting
    const isRateLimited =
      message.includes("429") ||
      message.toLowerCase().includes("rate limit") ||
      message.toLowerCase().includes("quota");

    throw new GeminiRequestError({
      message,
      status: isRateLimited ? 429 : 500,
    });
  }
};
