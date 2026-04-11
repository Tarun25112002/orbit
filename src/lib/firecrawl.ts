import Firecrawl from "@mendable/firecrawl-js";

type FirecrawlClient = InstanceType<typeof Firecrawl>;

let client: FirecrawlClient | null = null;

const getFirecrawlClient = () => {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not configured");
  }

  client ??= new Firecrawl({ apiKey });
  return client;
};

export const firecrawl = {
  scrape: (...args: Parameters<FirecrawlClient["scrape"]>) =>
    getFirecrawlClient().scrape(...args),
};
