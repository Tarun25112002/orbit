import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_CONTEXT_CHARS = 5_000;
const MAX_CODE_WINDOW_CHARS = 24_000;
const MAX_SUGGESTION_CHARS = 1_200;

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

const suggestionSchema = z.object({
  suggestion: z
    .string()
    .describe(
      "The exact code insertion/replacement text. Return an empty string if no suggestion is appropriate.",
    ),
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
  let normalized = removeCodeFence(suggestion).slice(0, MAX_SUGGESTION_CHARS);

  if (mode === "autocomplete") {
    normalized = removeOverlapWithFollowingText(normalized, textAfterCursor);
  }

  return normalized;
};

export async function POST(request: Request) {
  try {
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

    const { output } = await generateText({
      model: google("gemini-2.5-flash"),
      output: Output.object({ schema: suggestionSchema }),
      prompt,
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: true,
        recordOutputs: true,
      },
    });

    const suggestion = normalizeSuggestion(
      output.suggestion,
      mode,
      input.textAfterCursor ?? "",
    );

    return NextResponse.json({
      mode,
      suggestion,
      sugegstions: suggestion,
    });
  } catch (error) {
    console.error("Suggestion error:", error);

    return NextResponse.json(
      {
        error: "Failed to generate suggestion",
      },
      { status: 500 },
    );
  }
}
