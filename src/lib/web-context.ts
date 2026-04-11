import { firecrawl } from "@/lib/firecrawl";

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;:!?]+$/g;
const DEFAULT_MAX_URLS = 3;
const DEFAULT_MAX_CONTEXT_CHARS = 30_000;

export type WebContext = {
  urls: string[];
  markdown: string;
};

const limitContext = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
};

const normalizeUrl = (url: string) => url.replace(TRAILING_URL_PUNCTUATION, "");

export const extractUrls = (value: string, maxUrls = DEFAULT_MAX_URLS) => {
  const urls = value.match(URL_REGEX) ?? [];
  const uniqueUrls = new Set<string>();

  for (const url of urls) {
    const normalized = normalizeUrl(url);
    if (normalized) {
      uniqueUrls.add(normalized);
    }

    if (uniqueUrls.size >= maxUrls) {
      break;
    }
  }

  return Array.from(uniqueUrls);
};

export const scrapeUrlsForContext = async (
  urls: string[],
  options?: {
    maxContextChars?: number;
  },
): Promise<WebContext> => {
  const maxContextChars = options?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const uniqueUrls = Array.from(new Set(urls.map(normalizeUrl).filter(Boolean)));

  if (uniqueUrls.length === 0) {
    return { urls: [], markdown: "" };
  }

  const results = await Promise.all(
    uniqueUrls.map(async (url) => {
      try {
        const result = await firecrawl.scrape(url, {
          formats: ["markdown"],
          maxAge: 3600000,
          fastMode: true,
        });
        const markdown = result.markdown?.trim();

        if (!markdown) {
          return null;
        }

        return `Source: ${url}\n${markdown}`;
      } catch {
        return null;
      }
    }),
  );

  return {
    urls: uniqueUrls,
    markdown: limitContext(results.filter(Boolean).join("\n\n"), maxContextChars),
  };
};

export const buildWebContextFromText = async (
  value: string,
  options?: {
    maxUrls?: number;
    maxContextChars?: number;
  },
) => {
  const urls = extractUrls(value, options?.maxUrls ?? DEFAULT_MAX_URLS);
  return scrapeUrlsForContext(urls, {
    maxContextChars: options?.maxContextChars,
  });
};
