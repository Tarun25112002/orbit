import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  SuggestionMode,
  SuggestionProjectContext,
  SuggestionRequestBody,
} from "@/lib/code-suggestion";
import {
  OpenRouterRequestError,
  requestOpenRouterCompletion,
  type OpenRouterChatMessage,
} from "@/lib/openrouter";

const MAX_CONTEXT_CHARS = 5_000;
const MAX_CODE_WINDOW_CHARS = 24_000;
const MAX_SUGGESTION_CHARS = 1_200;
const MAX_WORKSPACE_SUMMARY_CHARS = 1_000;
const MAX_WORKSPACE_TREE_CHARS = 4_500;
const MAX_RELATED_FILE_CHARS = 3_000;
const MAX_RELATED_FILES = 6;
const MAX_IMPORT_HINTS = 12;
const MAX_SOURCE_CODE_CHARS = 80_000;
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "qwen/qwen3.6-plus:free";
const OPENROUTER_FALLBACK_MODELS = (
  process.env.OPENROUTER_FALLBACK_MODELS ?? ""
)
  .split(",")
  .map((model) => model.trim())
  .filter((model) => model.length > 0);
const GENERATION_MAX_ATTEMPTS = Number.parseInt(
  process.env.SUGGESTION_GENERATION_ATTEMPTS ?? "3",
  10,
);
const GENERATION_BASE_BACKOFF_MS = Number.parseInt(
  process.env.SUGGESTION_GENERATION_BACKOFF_MS ?? "350",
  10,
);

const projectContextSchema = z.object({
  activeFilePath: z.string().trim().min(1).optional(),
  workspaceSummary: z.string().optional(),
  workspaceTree: z.string().optional(),
  importHints: z
    .array(z.string().trim().min(1))
    .max(MAX_IMPORT_HINTS)
    .optional(),
  relatedFiles: z
    .array(
      z.object({
        path: z.string().trim().min(1),
        content: z.string(),
        score: z.number().optional(),
        reason: z.string().optional(),
      }),
    )
    .max(MAX_RELATED_FILES)
    .optional(),
});

export const suggestionRequestSchema = z
  .object({
    mode: z.enum(["autocomplete", "transform"]).optional(),
    fileName: z.string().trim().min(1).optional(),
    language: z.string().trim().min(1).optional(),
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
    projectContext: projectContextSchema.optional(),
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

export type ParsedSuggestionInput = z.infer<typeof suggestionRequestSchema>;

export type PreparedSuggestionRequest = {
  mode: SuggestionMode;
  input: ParsedSuggestionInput;
  fingerprint: string;
};

export type SuggestionGenerationResult = {
  modelName: string;
  suggestion: string;
  attempts: number;
  latencyMs: number;
};

export class SuggestionGenerationError extends Error {
  statusCode: number;
  retryAfterSeconds: number | null;
  retryable: boolean;

  constructor(args: {
    message: string;
    statusCode: number;
    retryAfterSeconds?: number | null;
    retryable: boolean;
  }) {
    super(args.message);
    this.name = "SuggestionGenerationError";
    this.statusCode = args.statusCode;
    this.retryAfterSeconds = args.retryAfterSeconds ?? null;
    this.retryable = args.retryable;
  }
}

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

const removeOverlapWithLeadingText = (
  suggestion: string,
  textBefore: string,
) => {
  if (!suggestion || !textBefore) {
    return suggestion;
  }

  const maxOverlap = Math.min(suggestion.length, textBefore.length, 200);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (textBefore.slice(-overlap) === suggestion.slice(0, overlap)) {
      return suggestion.slice(overlap);
    }
  }

  return suggestion;
};

const sanitizeProjectContext = (
  projectContext?: SuggestionProjectContext,
): SuggestionProjectContext | undefined => {
  if (!projectContext) {
    return undefined;
  }

  const importHints = projectContext.importHints
    ?.map((hint) => hint.trim())
    .filter(Boolean)
    .slice(0, MAX_IMPORT_HINTS);

  const relatedFiles = projectContext.relatedFiles
    ?.filter(
      (
        file,
      ): file is NonNullable<
        SuggestionProjectContext["relatedFiles"]
      >[number] =>
        Boolean(file.path?.trim() && typeof file.content === "string"),
    )
    .slice(0, MAX_RELATED_FILES)
    .map((file) => ({
      ...file,
      path: file.path.trim(),
      content: limitContext(file.content, MAX_RELATED_FILE_CHARS),
      reason: file.reason?.trim(),
    }));

  return {
    activeFilePath: projectContext.activeFilePath?.trim(),
    workspaceSummary: projectContext.workspaceSummary
      ? limitContext(
          projectContext.workspaceSummary,
          MAX_WORKSPACE_SUMMARY_CHARS,
        )
      : undefined,
    workspaceTree: projectContext.workspaceTree
      ? limitContext(projectContext.workspaceTree, MAX_WORKSPACE_TREE_CHARS)
      : undefined,
    importHints,
    relatedFiles,
  };
};

export const formatProjectContextForPrompt = (
  projectContext?: SuggestionProjectContext,
) => {
  const sanitized = sanitizeProjectContext(projectContext);
  if (!sanitized) {
    return "";
  }

  const blocks: string[] = [];

  if (sanitized.activeFilePath) {
    blocks.push(`Active file path: ${sanitized.activeFilePath}`);
  }

  if (sanitized.workspaceSummary) {
    blocks.push("Workspace summary:");
    blocks.push(sanitized.workspaceSummary);
  }

  if (sanitized.importHints && sanitized.importHints.length > 0) {
    blocks.push("Import and dependency hints:");
    blocks.push(sanitized.importHints.join(", "));
  }

  if (sanitized.workspaceTree) {
    blocks.push("Workspace tree:");
    blocks.push(sanitized.workspaceTree);
  }

  if (sanitized.relatedFiles && sanitized.relatedFiles.length > 0) {
    blocks.push("Related files:");

    for (const file of sanitized.relatedFiles) {
      const headerBits = [`Path: ${file.path}`];
      if (typeof file.score === "number") {
        headerBits.push(`Score: ${file.score}`);
      }
      if (file.reason) {
        headerBits.push(`Reason: ${file.reason}`);
      }

      blocks.push(headerBits.join(" | "));
      blocks.push(file.content);
    }
  }

  return blocks.join("\n");
};

export const buildAutocompletePrompt = (
  input: ParsedSuggestionInput,
  projectContextBlock?: string,
) => {
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
    "Optimize for low-latency, editor-safe completions across multiple programming languages.",
    "If no useful completion is appropriate, return an empty string.",
    "",
    `File: ${fileName}`,
    `Language: ${input.language ?? "Unknown"}`,
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
    ...(projectContextBlock
      ? ["", "Relevant workspace context:", projectContextBlock]
      : []),
    "",
    "File content window:",
    buildCodeWindow(input.code, input.cursorOffset),
  ].join("\n");
};

export const buildTransformPrompt = (
  input: ParsedSuggestionInput,
  projectContextBlock?: string,
) => {
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
    `Language: ${input.language ?? "Unknown"}`,
    "",
    "Instruction:",
    limitContext(instruction, MAX_CONTEXT_CHARS),
    "",
    "Selected code:",
    selectedCode,
    ...(projectContextBlock
      ? ["", "Relevant workspace context:", projectContextBlock]
      : []),
    "",
    "Broader file context:",
    buildCodeWindow(
      input.code,
      input.selectionStartOffset ?? input.cursorOffset,
    ),
  ].join("\n");
};

export const normalizeSuggestion = (
  suggestion: string,
  mode: "autocomplete" | "transform",
  textBeforeCursor: string,
  textAfterCursor: string,
) => {
  let normalized = trimTrailingWhitespace(
    removeCodeFence(suggestion).replace(/\r\n/g, "\n"),
  ).slice(0, MAX_SUGGESTION_CHARS);

  if (mode === "autocomplete") {
    normalized = removeOverlapWithLeadingText(normalized, textBeforeCursor);
    normalized = removeOverlapWithFollowingText(normalized, textAfterCursor);
  }

  return normalized;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const isRateLimitedError = (message: string) =>
  /(quota exceeded|rate limit|resource_exhausted|too many requests|status\s*429)/i.test(
    message,
  );

const parseRetryAfterSeconds = (message: string) => {
  const retryInMatch = message.match(/retry in\s+([\d.]+)s/i);
  if (retryInMatch?.[1]) {
    const seconds = Number.parseFloat(retryInMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds;
    }
  }

  return null;
};

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

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const sanitizeSuggestionRequestBody = (
  input: ParsedSuggestionInput,
): ParsedSuggestionInput => ({
  ...input,
  code: input.code.slice(0, MAX_SOURCE_CODE_CHARS),
  currentLine: input.currentLine?.slice(0, MAX_CONTEXT_CHARS),
  previousLines: input.previousLines?.slice(-MAX_CONTEXT_CHARS),
  nextLines: input.nextLines?.slice(0, MAX_CONTEXT_CHARS),
  textBeforeCursor: input.textBeforeCursor?.slice(-MAX_CONTEXT_CHARS),
  textAfterCursor: input.textAfterCursor?.slice(0, MAX_CONTEXT_CHARS),
  selectedCode: input.selectedCode?.slice(0, MAX_CODE_WINDOW_CHARS),
  instruction: input.instruction?.slice(0, MAX_CONTEXT_CHARS),
  fileName: input.fileName?.trim(),
  language: input.language?.trim(),
  projectContext: sanitizeProjectContext(input.projectContext),
});

const buildFingerprintPayload = (input: ParsedSuggestionInput) => ({
  mode: input.mode ?? "autocomplete",
  fileName: input.fileName ?? "",
  language: input.language ?? "",
  lineNumber: input.lineNumber ?? 0,
  cursorOffset: input.cursorOffset ?? 0,
  currentLine: input.currentLine ?? "",
  previousLines: input.previousLines ?? "",
  nextLines: input.nextLines ?? "",
  textBeforeCursor: input.textBeforeCursor ?? "",
  textAfterCursor: input.textAfterCursor ?? "",
  selectedCode: input.selectedCode ?? "",
  instruction: input.instruction ?? "",
  projectContext: input.projectContext ?? null,
  codeWindow: buildCodeWindow(input.code, input.cursorOffset),
});

export const buildSuggestionFingerprint = (input: ParsedSuggestionInput) =>
  createHash("sha256")
    .update(JSON.stringify(buildFingerprintPayload(input)))
    .digest("hex");

export const prepareSuggestionRequest = (
  body: SuggestionRequestBody,
): PreparedSuggestionRequest => {
  const parsed = suggestionRequestSchema.parse(body);
  const input = sanitizeSuggestionRequestBody(parsed);

  return {
    mode: input.mode ?? "autocomplete",
    input,
    fingerprint: buildSuggestionFingerprint(input),
  };
};

export const buildSuggestionExecutionInput = ({
  mode,
  input,
}: {
  mode: SuggestionMode;
  input: ParsedSuggestionInput;
}) => {
  const projectContextBlock = formatProjectContextForPrompt(
    input.projectContext,
  );
  const llmPrompt =
    mode === "transform"
      ? buildTransformPrompt(input, projectContextBlock)
      : buildAutocompletePrompt(input, projectContextBlock);

  return {
    mode,
    llmPrompt,
    textBeforeCursor: input.textBeforeCursor ?? "",
    textAfterCursor: input.textAfterCursor ?? "",
  };
};

const shouldRetryGeneration = (error: unknown) => {
  if (error instanceof SuggestionGenerationError) {
    return error.retryable;
  }

  if (error instanceof OpenRouterRequestError) {
    return error.status === 429 || error.status >= 500;
  }

  const message = getErrorMessage(error);
  return isRateLimitedError(message);
};

const normalizeGenerationError = (error: unknown) => {
  if (error instanceof SuggestionGenerationError) {
    return error;
  }

  if (error instanceof OpenRouterRequestError) {
    const retryAfterSeconds =
      error.retryAfterSeconds ?? parseRetryAfterSeconds(error.message);
    const retryable = error.status === 429 || error.status >= 500;

    return new SuggestionGenerationError({
      message: error.message,
      statusCode: error.status,
      retryAfterSeconds,
      retryable,
    });
  }

  const message = getErrorMessage(error);
  const rateLimited = isRateLimitedError(message);

  return new SuggestionGenerationError({
    message,
    statusCode: rateLimited ? 429 : 500,
    retryAfterSeconds: parseRetryAfterSeconds(message),
    retryable: rateLimited,
  });
};

export async function generateSuggestion(
  mode: SuggestionMode,
  input: ParsedSuggestionInput,
  options?: {
    onRetry?: (payload: {
      attempt: number;
      model: string;
      error: SuggestionGenerationError;
    }) => void;
  },
): Promise<SuggestionGenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new SuggestionGenerationError({
      message:
        "Missing OpenRouter API key. Set OPENROUTER_API_KEY in your environment.",
      statusCode: 500,
      retryable: false,
    });
  }

  const execution = buildSuggestionExecutionInput({ mode, input });
  const modelCandidates = Array.from(
    new Set([OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS]),
  );
  const startedAt = Date.now();
  let lastError: unknown = null;
  let totalAttempts = 0;

  for (const modelName of modelCandidates) {
    let attempt = 0;

    while (attempt < Math.max(1, GENERATION_MAX_ATTEMPTS)) {
      attempt += 1;
      totalAttempts += 1;

      try {
        const firstResponse = await requestOpenRouterCompletion({
          apiKey,
          model: modelName,
          messages: [{ role: "user", content: execution.llmPrompt }],
          enableReasoning: true,
        });

        let suggestion = normalizeSuggestion(
          firstResponse.message.content,
          mode,
          execution.textBeforeCursor,
          execution.textAfterCursor,
        );

        if (!suggestion.trim() && firstResponse.message.reasoning_details) {
          const continuationResponse = await requestOpenRouterCompletion({
            apiKey,
            model: modelName,
            messages: buildReasoningContinuationMessages(
              execution.llmPrompt,
              firstResponse.message.content,
              firstResponse.message.reasoning_details,
            ),
            enableReasoning: false,
          });

          suggestion = normalizeSuggestion(
            continuationResponse.message.content,
            mode,
            execution.textBeforeCursor,
            execution.textAfterCursor,
          );
        }

        return {
          modelName,
          suggestion,
          attempts: totalAttempts,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const normalizedError = normalizeGenerationError(error);

        if (
          shouldRetryGeneration(error) &&
          attempt < Math.max(1, GENERATION_MAX_ATTEMPTS)
        ) {
          options?.onRetry?.({
            attempt: totalAttempts,
            model: modelName,
            error: normalizedError,
          });
          await wait(GENERATION_BASE_BACKOFF_MS * attempt);
          continue;
        }

        if (error instanceof OpenRouterRequestError) {
          if (
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ) {
            throw normalizedError;
          }
        }

        break;
      }
    }
  }

  throw normalizeGenerationError(
    lastError ?? new Error("Suggestion generation failed"),
  );
}
