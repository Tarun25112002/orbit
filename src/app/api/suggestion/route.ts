import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OpenRouterRequestError,
  requestOpenRouterCompletion,
  type OpenRouterChatMessage,
} from "@/lib/openrouter";

const MAX_CONTEXT_CHARS = 5_000;
const MAX_CODE_WINDOW_CHARS = 24_000;
const MAX_SUGGESTION_CHARS = 1_200;
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "qwen/qwen3.6-plus:free";
const OPENROUTER_FALLBACK_MODELS = (
  process.env.OPENROUTER_FALLBACK_MODELS ?? ""
)
  .split(",")
  .map((model) => model.trim())
  .filter((model) => model.length > 0);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();

const requestSchema = z
  .object({
    mode: z.enum(["autocomplete", "transform"]).optional(),
    fileName: z.string().trim().min(1).optional(),
    code: z.string().trim().min(1, "Code is required"),
    lineNumber: z.number().int().min(1).optional(),
    currentLine: z.string().optional(),
    previousLines: z.string().optional(),
    nextLines: z.string().optional(),
    textBeforeCursor: z.string().optional(),
    textAfterCursor: z.string().optional(),
    cursorOffset: z.number().int().min(0).optional(),
    selectedCode: z.string().optional(),
    instruction: z.string().optional(),
    selectionStartOffset: z.number().int().min(0).optional(),
    selectionEndOffset: z.number().int().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "transform") {
      if (!value.selectedCode?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selectedCode"],
          message: "Selected code is required for transform mode",
        });
      }

      if (!value.instruction?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["instruction"],
          message: "Instruction is required for transform mode",
        });
      }
    }
  });

const limitContext = (value: string, max: number, fromEnd = false) => {
  if (value.length <= max) {
    return value;
  }

  if (fromEnd) {
    return `...${value.slice(value.length - max)}`;
  }

  return `${value.slice(0, max)}...`;
};

const buildCodeWindow = (code: string, cursorOffset?: number) => {
  if (code.length <= MAX_CODE_WINDOW_CHARS) {
    return code;
  }

  if (typeof cursorOffset !== "number") {
    return `${code.slice(0, MAX_CODE_WINDOW_CHARS)}...`;
  }

  const safeOffset = Math.max(0, Math.min(cursorOffset, code.length));
  const halfWindow = Math.floor(MAX_CODE_WINDOW_CHARS / 2);
  const start = Math.max(0, safeOffset - halfWindow);
  const end = Math.min(code.length, safeOffset + halfWindow);

  return `${start > 0 ? "...\n" : ""}${code.slice(start, end)}${end < code.length ? "\n..." : ""}`;
};

const removeCodeFence = (value: string) =>
  value.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/\n?```$/, "");

const trimTrailingWhitespace = (value: string) =>
  value
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

const removeOverlapWithFollowingText = (
  suggestion: string,
  textAfter: string,
) => {
  if (!suggestion || !textAfter) {
    return suggestion;
  }

  const maxOverlap = Math.min(suggestion.length, textAfter.length, 200);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (suggestion.slice(-overlap) === textAfter.slice(0, overlap)) {
      return suggestion.slice(0, -overlap);
    }
  }

  return suggestion;
};

const buildAutocompletePrompt = (input: z.infer<typeof requestSchema>) => {
  const fileName = input.fileName ?? "untitled";
  const lineNumber = input.lineNumber ?? 1;
  const currentLine = input.currentLine ?? "";
  const previousLines = input.previousLines ?? "";
  const nextLines = input.nextLines ?? "";
  const textBeforeCursor = input.textBeforeCursor ?? "";
  const textAfterCursor = input.textAfterCursor ?? "";

  return [
    "You are an inline code autocomplete engine.",
    "Generate only the code suffix that should be inserted at the cursor.",
    "Do not add markdown, explanations, or code fences.",
    "The suggestion must be well formatted and match surrounding indentation and spacing style.",
    "Never repeat text that is already before the cursor.",
    "Avoid duplicating the text that already exists after the cursor.",
    "If no useful completion is appropriate, return an empty string.",
    "",
    `File: ${fileName}`,
    `Line: ${lineNumber}`,
    "",
    "Current line:",
    currentLine,
    "",
    "Text before cursor:",
    limitContext(textBeforeCursor, MAX_CONTEXT_CHARS, true),
    "",
    "Text after cursor:",
    limitContext(textAfterCursor, MAX_CONTEXT_CHARS),
    "",
    "Previous lines:",
    limitContext(previousLines, MAX_CONTEXT_CHARS, true),
    "",
    "Next lines:",
    limitContext(nextLines, MAX_CONTEXT_CHARS),
    "",
    "File content window:",
    buildCodeWindow(input.code, input.cursorOffset),
  ].join("\n");
};

const buildTransformPrompt = (input: z.infer<typeof requestSchema>) => {
  const fileName = input.fileName ?? "untitled";
  const selectedCode = input.selectedCode ?? "";
  const instruction = input.instruction ?? "";

  return [
    "You rewrite selected code based on user instruction.",
    "Return only the replacement code for the selection.",
    "Do not add markdown, explanations, or code fences.",
    "Return well-formatted code with consistent indentation, spacing, and line breaks.",
    "Preserve language syntax and indentation style.",
    "If the instruction is unsafe or not actionable, return the original selected code unchanged.",
    "",
    `File: ${fileName}`,
    "",
    "Instruction:",
    limitContext(instruction, MAX_CONTEXT_CHARS),
    "",
    "Selected code:",
    selectedCode,
    "",
    "Broader file context:",
    buildCodeWindow(
      input.code,
      input.selectionStartOffset ?? input.cursorOffset,
    ),
  ].join("\n");
};

const normalizeSuggestion = (
  suggestion: string,
  mode: "autocomplete" | "transform",
  textAfterCursor: string,
) => {
  let normalized = trimTrailingWhitespace(
    removeCodeFence(suggestion).replace(/\r\n/g, "\n"),
  ).slice(0, MAX_SUGGESTION_CHARS);

  if (mode === "autocomplete") {
    normalized = removeOverlapWithFollowingText(normalized, textAfterCursor);
  }

  return normalized;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const getRetryAfterSeconds = (message: string) => {
  const retryInMatch = message.match(/retry in\s+([\d.]+)s/i);
  if (retryInMatch?.[1]) {
    const seconds = Number.parseFloat(retryInMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds;
    }
  }

  return null;
};

const isRateLimitedError = (message: string) =>
  /(quota exceeded|rate limit|resource_exhausted|too many requests|status\s*429)/i.test(
    message,
  );

const buildReasoningContinuationMessages = (
  prompt: string,
  content: string,
  reasoningDetails: unknown,
) => {
  const messages: OpenRouterChatMessage[] = [
    {
      role: "user",
      content: prompt,
    },
    {
      role: "assistant",
      content,
      reasoning_details: reasoningDetails,
    },
    {
      role: "user",
      content:
        "Return only the final code suggestion now. Do not include markdown fences, explanations, or extra commentary.",
    },
  ];

  return messages;
};

export async function POST(request: Request) {
  try {
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json(
        {
          error:
            "Missing OpenRouter API key. Set OPENROUTER_API_KEY in your environment.",
        },
        { status: 500 },
      );
    }

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const mode = input.mode ?? "autocomplete";
    const prompt =
      mode === "transform"
        ? buildTransformPrompt(input)
        : buildAutocompletePrompt(input);

    const modelCandidates = Array.from(
      new Set([OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS]),
    );

    let lastError: unknown = null;

    for (const modelName of modelCandidates) {
      try {
        const firstResponse = await requestOpenRouterCompletion({
          apiKey: OPENROUTER_API_KEY,
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          enableReasoning: true,
        });

        let suggestion = normalizeSuggestion(
          firstResponse.message.content,
          mode,
          input.textAfterCursor ?? "",
        );

        if (!suggestion.trim() && firstResponse.message.reasoning_details) {
          const continuationResponse = await requestOpenRouterCompletion({
            apiKey: OPENROUTER_API_KEY,
            model: modelName,
            messages: buildReasoningContinuationMessages(
              prompt,
              firstResponse.message.content,
              firstResponse.message.reasoning_details,
            ),
            enableReasoning: false,
          });

          suggestion = normalizeSuggestion(
            continuationResponse.message.content,
            mode,
            input.textAfterCursor ?? "",
          );
        }

        return NextResponse.json({
          mode,
          suggestion,
          sugegstions: suggestion,
          model: modelName,
        });
      } catch (structuredError) {
        lastError = structuredError;
      }
    }

    throw lastError ?? new Error("Suggestion generation failed");
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const openRouterError =
      error instanceof OpenRouterRequestError ? error : null;

    const retryAfterSeconds =
      openRouterError?.retryAfterSeconds ?? getRetryAfterSeconds(errorMessage);
    const rateLimited =
      (openRouterError?.status ?? 0) === 429 ||
      isRateLimitedError(errorMessage);

    console.error("Suggestion error:", errorMessage, error);

    return NextResponse.json(
      {
        error: rateLimited
          ? "Suggestion service is rate-limited right now."
          : "Failed to generate suggestion",
        detail: errorMessage,
        retryAfterSeconds,
      },
      {
        status: rateLimited
          ? 429
          : openRouterError && openRouterError.status >= 400
            ? openRouterError.status
            : 500,
        headers: retryAfterSeconds
          ? {
              "Retry-After": String(Math.ceil(retryAfterSeconds)),
            }
          : undefined,
      },
    );
  }
}
