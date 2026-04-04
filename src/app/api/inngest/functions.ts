import { inngest } from "@/inngest/client";
import { firecrawl } from "@/lib/firecrawl";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_API_KEY =
  process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const gemini = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
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
      if (!GEMINI_API_KEY) {
        throw new Error(
          "Missing Gemini API key. Set GOOGLE_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY).",
        );
      }

      return await generateText({
        model: gemini(GEMINI_MODEL),
        prompt: finalPrompt,
        experimental_telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
        },
      });
    });
  },
);
