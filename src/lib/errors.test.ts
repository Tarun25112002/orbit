import { describe, expect, it } from "vitest";
import { classifyError } from "@/lib/errors";

describe("errors", () => {
  it("classifies nested Google RPC 429 payloads as rate limit", () => {
    const classified = classifyError({
      error: {
        code: 429,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [
              {
                description: "Rate limit guidance",
                url: "https://ai.google.dev/gemini-api/docs/rate-limits",
              },
            ],
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "31s",
          },
        ],
      },
    });

    expect(classified.category).toBe("rate_limit");
    expect(classified.retryable).toBe(true);
    expect(classified.retryAfterSeconds).toBe(31);
  });

  it("extracts auth errors from nested response payloads", () => {
    const classified = classifyError({
      response: {
        data: {
          error: {
            code: "403",
            message: "Permission denied",
          },
        },
      },
    });

    expect(classified.category).toBe("auth");
    expect(classified.retryable).toBe(false);
  });

  it("reads retry-after seconds from nested headers", () => {
    const classified = classifyError({
      response: {
        status: 429,
        headers: {
          "retry-after": "12",
        },
      },
    });

    expect(classified.category).toBe("rate_limit");
    expect(classified.retryAfterSeconds).toBe(12);
  });
});
