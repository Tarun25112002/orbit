import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTransformPrompt,
  buildSuggestionFingerprint,
  generateSuggestion,
  normalizeSuggestion,
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

  it("normalizes autocomplete suggestions to suffix-only text", () => {
    const result = normalizeSuggestion(
      "return answer;",
      "autocomplete",
      "  return",
      "",
    );

    expect(result).toBe(" answer;");
  });

  it("keeps full transform responses instead of truncating them to autocomplete length", () => {
    const fullFile = `export default function App() {\n${"  console.log('line');\n".repeat(120)}  return <div>Hello</div>;\n}`;

    const result = normalizeSuggestion(fullFile, "transform", "", "");

    expect(result).toBe(fullFile);
    expect(result.length).toBeGreaterThan(1_200);
  });

  it("asks transform mode for the full updated file", () => {
    const prompt = buildTransformPrompt({
      mode: "transform",
      fileName: "src/app.tsx",
      language: "TypeScript",
      code: "const value = 1;\nconsole.log(value);\n",
      selectedCode: "value = 1",
      instruction: "Rename value to count",
      selectionStartOffset: 6,
      selectionEndOffset: 15,
    });

    expect(prompt).toContain("Return the full updated file contents");
    expect(prompt).toContain("<orbit-selection-start>");
    expect(prompt).toContain("<orbit-selection-end>");
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

    expect(result.suggestion).toBe(" answer;");
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstRequest = JSON.parse(
      fetchMock.mock.calls[0][1]?.body as string,
    ) as {
      model?: string;
    };
    const secondRequest = JSON.parse(
      fetchMock.mock.calls[1][1]?.body as string,
    ) as {
      model?: string;
    };

    expect(firstRequest.model).toBe("google/gemini-2.5-flash:free");
    expect(secondRequest.model).toBe("deepseek/deepseek-chat-v3-0324:free");
  });

  it("stops the fallback chain when OpenRouter reports the free-model minute cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Rate limit exceeded: free-models-per-min.",
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "45",
          },
        },
      ),
    );

    global.fetch = fetchMock as typeof fetch;

    await expect(
      generateSuggestion("autocomplete", {
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
      }),
    ).rejects.toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 45,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("returns the full transformed file from the model response", async () => {
    const fullFile = "const answer = 42;\nconsole.log(answer);\n";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: fullFile,
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
    ) as typeof fetch;

    const result = await generateSuggestion("transform", {
      mode: "transform",
      fileName: "src/example.ts",
      language: "TypeScript",
      code: "const answer = 41;\nconsole.log(answer);\n",
      selectedCode: "41",
      instruction: "Replace 41 with 42",
      textBeforeCursor: "const answer = ",
      textAfterCursor: ";\nconsole.log(answer);\n",
      cursorOffset: 15,
      selectionStartOffset: 15,
      selectionEndOffset: 17,
    });

    expect(result.suggestion).toBe(fullFile);
  });
});
