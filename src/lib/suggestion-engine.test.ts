import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSuggestionFingerprint,
  generateSuggestion,
  prepareSuggestionRequest,
} from "@/lib/suggestion-engine";

describe("suggestion-engine", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalApiKey;
  });

  it("prepares requests and generates a stable fingerprint", () => {
    const request = prepareSuggestionRequest({
      mode: "autocomplete",
      fileName: "src/example.ts",
      language: "TypeScript",
      code: "const answer = 41;",
      currentLine: "const answer = ",
      textBeforeCursor: "const answer = ",
      textAfterCursor: "41;",
      cursorOffset: 15,
    });

    const sameFingerprint = buildSuggestionFingerprint(request.input);

    expect(request.mode).toBe("autocomplete");
    expect(request.input.language).toBe("TypeScript");
    expect(request.fingerprint).toBe(sameFingerprint);
  });

  it("retries transient provider failures and returns the final suggestion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Rate limit reached. Retry in 0.2s",
            },
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "1",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "return answer;",
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    global.fetch = fetchMock as typeof fetch;

    const result = await generateSuggestion("autocomplete", {
      mode: "autocomplete",
      fileName: "src/example.ts",
      language: "TypeScript",
      code: "function getAnswer() {\n  return\n}",
      currentLine: "  return",
      previousLines: "function getAnswer() {\n",
      nextLines: "\n}",
      textBeforeCursor: "  return",
      textAfterCursor: "",
      cursorOffset: 27,
      lineNumber: 2,
    });

    expect(result.suggestion).toBe("return answer;");
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks client errors as non-retryable", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid request payload",
          },
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    ) as typeof fetch;

    await expect(
      generateSuggestion("transform", {
        mode: "transform",
        fileName: "src/example.ts",
        language: "TypeScript",
        code: "const answer = 41;",
        selectedCode: "41",
        instruction: "Replace with 42",
        textBeforeCursor: "const answer = ",
        textAfterCursor: ";",
        cursorOffset: 15,
        selectionStartOffset: 15,
        selectionEndOffset: 17,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      retryable: false,
    });
  });
});
