import { inngest } from "@/inngest/client";
import { firecrawl } from "@/lib/firecrawl";
import { requestOpenRouterCompletion } from "@/lib/openrouter";

const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "qwen/qwen3.6-plus:free";
const OPENROUTER_FALLBACK_MODELS = (
  process.env.OPENROUTER_FALLBACK_MODELS ?? ""
)
  .split(",")
  .map((model) => model.trim())
  .filter((model) => model.length > 0);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
const URL_REGEX = /https?:\/\/[^\s]+/g;
export const orbit = inngest.createFunction(
  { id: "orbit-generate", triggers: [{ event: "orbit/generate" }] },
  async ({ event, step }) => {
    const { prompt } = event.data as { prompt: string };

    const urls = (await step.run("exctract-urls", async () => {
      return prompt.match(URL_REGEX) ?? [];
    })) as string[];
    const scrapedContent = await step.run("scrape-urls", async () => {
      const results = await Promise.all(
        urls.map(async (url) => {
          const result = await firecrawl.scrape(url, {
            formats: ["markdown"],
            maxAge: 3600000,
            fastMode: true,
          });
          return result.markdown ?? null;
        }),
      );
      return results.filter(Boolean).join("\n\n");
    });

    const finalPrompt = scrapedContent
      ? `Context:\n${scrapedContent}\n\nQuestion: ${prompt}`
      : prompt;

    await step.run("generate-text", async () => {
      if (!OPENROUTER_API_KEY) {
        throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY.");
      }

      const modelCandidates = Array.from(
        new Set([OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS]),
      );

      let lastError: unknown = null;

      for (const modelName of modelCandidates) {
        try {
          const completion = await requestOpenRouterCompletion({
            apiKey: OPENROUTER_API_KEY,
            model: modelName,
            messages: [{ role: "user", content: finalPrompt }],
            enableReasoning: true,
          });

          return {
            model: modelName,
            content: completion.message.content,
            reasoning_details: completion.message.reasoning_details,
          };
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError ?? new Error("OpenRouter generation failed");
    });
  },
);
