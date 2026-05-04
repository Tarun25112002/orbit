import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  SuggestionMode,
  SuggestionProjectContext,
  SuggestionRequestBody,
} from "@/lib/code-suggestion";
import {
  GEMINI_MODEL_PREFERRED,
  GeminiRequestError,
  generateGeminiCompletion,
  type GeminiChatMessage,
  type GeminiCompletionResult,
} from "@/lib/gemini";
import { classifyError } from "@/lib/errors";
import { buildWebContextFromText } from "@/lib/web-context";

const MAX_CONTEXT_CHARS = 5_000;
const MAX_AUTOCOMPLETE_CONTEXT_CHARS = 2_000;
const MAX_AUTOCOMPLETE_TOKENS = 256;
const MAX_CODE_WINDOW_CHARS = 24_000;
const MAX_WORKSPACE_SUMMARY_CHARS = 1_000;
const MAX_WORKSPACE_TREE_CHARS = 4_500;
const MAX_RELATED_FILE_CHARS = 3_000;
const MAX_RELATED_FILES = 6;
const MAX_AUTOCOMPLETE_WEB_CONTEXT_CHARS = 8_000;
const MAX_TRANSFORM_WEB_CONTEXT_CHARS = 24_000;
const MAX_IMPORT_HINTS = 12;
const MAX_SOURCE_CODE_CHARS = 80_000;
const MAX_AUTOCOMPLETE_SUGGESTION_CHARS = 1_200;
const MAX_TRANSFORM_SUGGESTION_CHARS = MAX_SOURCE_CODE_CHARS;
const TRANSFORM_SELECTION_START_MARKER = "<orbit-selection-start>";
const TRANSFORM_SELECTION_END_MARKER = "<orbit-selection-end>";
const GEMINI_MODEL = GEMINI_MODEL_PREFERRED;
const AUTOCOMPLETE_WEB_CONTEXT_ENABLED = /^(1|true)$/i.test(
  process.env.SUGGESTION_AUTOCOMPLETE_WEB_CONTEXT_ENABLED?.trim() ?? "",
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

const clampOptionalOffset = (value: number | undefined, max: number) => {
  if (typeof value !== "number") {
    return value;
  }

  return Math.max(0, Math.min(value, max));
};

const buildTransformCodeContext = (input: ParsedSuggestionInput) => {
  const code = input.code;
  const startOffset = clampOptionalOffset(
    input.selectionStartOffset,
    code.length,
  );
  const endOffset = clampOptionalOffset(input.selectionEndOffset, code.length);

  if (
    typeof startOffset !== "number" ||
    typeof endOffset !== "number" ||
    endOffset <= startOffset
  ) {
    return code;
  }

  return [
    code.slice(0, startOffset),
    TRANSFORM_SELECTION_START_MARKER,
    code.slice(startOffset, endOffset),
    TRANSFORM_SELECTION_END_MARKER,
    code.slice(endOffset),
  ].join("");
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
  webContextBlock?: string,
) => {
  const fileName = input.fileName ?? "untitled";
  const lineNumber = input.lineNumber ?? 1;
  const currentLine = input.currentLine ?? "";
  const textBeforeCursor = input.textBeforeCursor ?? "";
  const textAfterCursor = input.textAfterCursor ?? "";

  return [
    "You are an inline code autocomplete engine.",
    "Generate only the code that should be inserted at the cursor position.",
    "Do not add markdown, explanations, or code fences.",
    "Match surrounding indentation and style.",
    "Never repeat text already before the cursor.",
    "Never duplicate text already after the cursor.",
    "If no useful completion exists, return an empty string.",
    "",
    `File: ${fileName} | Language: ${input.language ?? "Unknown"} | Line: ${lineNumber}`,
    "",
    "Current line:",
    currentLine,
    "",
    "Text before cursor:",
    limitContext(textBeforeCursor, MAX_AUTOCOMPLETE_CONTEXT_CHARS, true),
    "",
    "Text after cursor:",
    limitContext(textAfterCursor, MAX_AUTOCOMPLETE_CONTEXT_CHARS),
    ...(projectContextBlock
      ? ["", "Relevant workspace context:", projectContextBlock]
      : []),
    ...(webContextBlock
      ? ["", "Web context from referenced URLs:", webContextBlock]
      : []),
  ].join("\n");
};

export const buildTransformPrompt = (
  input: ParsedSuggestionInput,
  projectContextBlock?: string,
  webContextBlock?: string,
) => {
  const fileName = input.fileName ?? "untitled";
  const selectedCode = input.selectedCode ?? "";
  const instruction = input.instruction ?? "";
  const selectionStartOffset = input.selectionStartOffset ?? 0;
  const selectionEndOffset = input.selectionEndOffset ?? 0;

  return [
    "You rewrite code based on user instruction.",
    "Return the full updated file contents from the first character to the last character.",
    "Do not return only a snippet or only the selected block.",
    "Do not add markdown, explanations, or code fences.",
    "Return well-formatted code with consistent indentation, spacing, and line breaks.",
    "Preserve language syntax, imports, and indentation style.",
    "Keep unchanged code exactly as-is unless a surrounding edit is required for correctness.",
    `The selected region in the full file is wrapped with ${TRANSFORM_SELECTION_START_MARKER} and ${TRANSFORM_SELECTION_END_MARKER} markers for context only. Do not include those markers in your response.`,
    "If the instruction is unsafe or not actionable, return the original full file unchanged.",
    "",
    `File: ${fileName}`,
    `Language: ${input.language ?? "Unknown"}`,
    "",
    "Instruction:",
    limitContext(instruction, MAX_CONTEXT_CHARS),
    "",
    `Selection start offset: ${selectionStartOffset}`,
    `Selection end offset: ${selectionEndOffset}`,
    "",
    "Selected code:",
    selectedCode,
    ...(projectContextBlock
      ? ["", "Relevant workspace context:", projectContextBlock]
      : []),
    ...(webContextBlock
      ? ["", "Web context from referenced URLs:", webContextBlock]
      : []),
    "",
    "Full current file content:",
    buildTransformCodeContext(input),
  ].join("\n");
};

export const normalizeSuggestion = (
  suggestion: string,
  mode: "autocomplete" | "transform",
  textBeforeCursor: string,
  textAfterCursor: string,
) => {
  const maxChars =
    mode === "transform"
      ? MAX_TRANSFORM_SUGGESTION_CHARS
      : MAX_AUTOCOMPLETE_SUGGESTION_CHARS;
  let normalized = trimTrailingWhitespace(
    removeCodeFence(suggestion).replace(/\r\n/g, "\n"),
  ).slice(0, maxChars);

  if (mode === "autocomplete") {
    normalized = removeOverlapWithLeadingText(normalized, textBeforeCursor);
    normalized = removeOverlapWithFollowingText(normalized, textAfterCursor);
  } else {
    normalized = normalized
      .replaceAll(TRANSFORM_SELECTION_START_MARKER, "")
      .replaceAll(TRANSFORM_SELECTION_END_MARKER, "");
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

const buildContinuationMessages = (
  prompt: string,
  response: GeminiCompletionResult,
) => {
  const messages: GeminiChatMessage[] = [
    {
      role: "user",
      content: prompt,
    },
    {
      role: "model",
      content: response.content,
      ...(response.reasoning_details !== undefined
        ? { reasoning_details: response.reasoning_details }
        : {}),
    },
    {
      role: "user",
      content:
        "Return only the final code suggestion now. Do not include markdown fences, explanations, or extra commentary.",
    },
  ];

  return messages;
};

const sanitizeSuggestionRequestBody = (input: ParsedSuggestionInput) => {
  const code = input.code.slice(0, MAX_SOURCE_CODE_CHARS);
  const maxOffset = code.length;

  return {
    ...input,
    code,
    currentLine: input.currentLine?.slice(0, MAX_CONTEXT_CHARS),
    previousLines: input.previousLines?.slice(-MAX_CONTEXT_CHARS),
    nextLines: input.nextLines?.slice(0, MAX_CONTEXT_CHARS),
    textBeforeCursor: input.textBeforeCursor?.slice(-MAX_CONTEXT_CHARS),
    textAfterCursor: input.textAfterCursor?.slice(0, MAX_CONTEXT_CHARS),
    cursorOffset: clampOptionalOffset(input.cursorOffset, maxOffset),
    selectedCode: input.selectedCode?.slice(0, MAX_CODE_WINDOW_CHARS),
    instruction: input.instruction?.slice(0, MAX_CONTEXT_CHARS),
    selectionStartOffset: clampOptionalOffset(
      input.selectionStartOffset,
      maxOffset,
    ),
    selectionEndOffset: clampOptionalOffset(
      input.selectionEndOffset,
      maxOffset,
    ),
    fileName: input.fileName?.trim(),
    language: input.language?.trim(),
    projectContext: sanitizeProjectContext(input.projectContext),
  };
};

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
  webContextBlock,
}: {
  mode: SuggestionMode;
  input: ParsedSuggestionInput;
  webContextBlock?: string;
}) => {
  const projectContextBlock =
    mode === "transform"
      ? formatProjectContextForPrompt(input.projectContext)
      : "";
  const llmPrompt =
    mode === "transform"
      ? buildTransformPrompt(input, projectContextBlock, webContextBlock)
      : buildAutocompletePrompt(input, projectContextBlock, webContextBlock);

  return {
    mode,
    llmPrompt,
    textBeforeCursor: input.textBeforeCursor ?? "",
    textAfterCursor: input.textAfterCursor ?? "",
  };
};

const buildSuggestionWebContextSeed = (
  mode: SuggestionMode,
  input: ParsedSuggestionInput,
) => {
  if (mode === "transform") {
    return [
      input.instruction ?? "",
      input.selectedCode ?? "",
      input.currentLine ?? "",
      input.textBeforeCursor?.slice(-MAX_CONTEXT_CHARS) ?? "",
      input.textAfterCursor?.slice(0, MAX_CONTEXT_CHARS) ?? "",
    ].join("\n");
  }

  return [
    input.currentLine ?? "",
    input.previousLines ?? "",
    input.nextLines ?? "",
    input.textBeforeCursor?.slice(-MAX_AUTOCOMPLETE_CONTEXT_CHARS) ?? "",
    input.textAfterCursor?.slice(0, MAX_AUTOCOMPLETE_CONTEXT_CHARS) ?? "",
  ].join("\n");
};

const normalizeGenerationError = (error: unknown) => {
  if (error instanceof SuggestionGenerationError) {
    return error;
  }

  if (error instanceof GeminiRequestError) {
    const rateLimited = error.status === 429;

    return new SuggestionGenerationError({
      message: error.message,
      statusCode: error.status,
      retryAfterSeconds: rateLimited ? 10 : null,
      retryable: rateLimited || error.status >= 500,
    });
  }

  const message = getErrorMessage(error);
  const rateLimited = isRateLimitedError(message);

  const classified = classifyError(error);
  const classifiedStatusCode =
    classified.category === "rate_limit" ||
    classified.category === "quota_exceeded"
      ? 429
      : classified.category === "auth"
        ? 401
        : classified.category === "validation"
          ? 400
          : classified.category === "timeout"
            ? 504
            : classified.category === "ai_unavailable"
              ? 503
              : 500;

  return new SuggestionGenerationError({
    message: classified.message,
    statusCode: rateLimited ? 429 : classifiedStatusCode,
    retryAfterSeconds:
      parseRetryAfterSeconds(message) ?? classified.retryAfterSeconds ?? null,
    retryable: classified.retryable,
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
  const shouldLoadWebContext =
    mode === "transform" || AUTOCOMPLETE_WEB_CONTEXT_ENABLED;
  const webContext = shouldLoadWebContext
    ? await buildWebContextFromText(
        buildSuggestionWebContextSeed(mode, input),
        {
          maxUrls: mode === "transform" ? 3 : 2,
          maxContextChars:
            mode === "transform"
              ? MAX_TRANSFORM_WEB_CONTEXT_CHARS
              : MAX_AUTOCOMPLETE_WEB_CONTEXT_CHARS,
        },
      )
    : { urls: [], markdown: "" };
  const execution = buildSuggestionExecutionInput({
    mode,
    input,
    webContextBlock: webContext.markdown,
  });
  const isAutocomplete = mode === "autocomplete";
  const startedAt = Date.now();
  let attempts = 0;

  const generateWithTracking = async (messages: GeminiChatMessage[]) => {
    return await generateGeminiCompletion({
      model: GEMINI_MODEL,
      messages,
      ...(isAutocomplete
        ? { maxTokens: MAX_AUTOCOMPLETE_TOKENS, temperature: 0.2 }
        : { temperature: 0.4 }),
      onAttempt: ({ attempt, model, error, willRetry, retryAfterSeconds }) => {
        attempts = Math.max(attempts, attempt);
        if (!willRetry) {
          return;
        }

        const retryError = normalizeGenerationError(
          Object.assign(new Error(error.message), {
            status: error.status,
            statusCode: error.status,
            retryAfterSeconds: retryAfterSeconds ?? undefined,
          }),
        );
        options?.onRetry?.({
          attempt,
          model,
          error: retryError,
        });
      },
    });
  };

  try {
    const response = await generateWithTracking([
      { role: "user", content: execution.llmPrompt },
    ]);
    attempts = Math.max(attempts, 1);

    let suggestion = normalizeSuggestion(
      response.content,
      mode,
      execution.textBeforeCursor,
      execution.textAfterCursor,
    );

    if (!isAutocomplete && !suggestion.trim()) {
      const continuationResponse = await generateWithTracking(
        buildContinuationMessages(execution.llmPrompt, response),
      );

      suggestion = normalizeSuggestion(
        continuationResponse.content,
        mode,
        execution.textBeforeCursor,
        execution.textAfterCursor,
      );
    }

    return {
      modelName: response.model,
      suggestion,
      attempts,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw normalizeGenerationError(error);
  }
}
