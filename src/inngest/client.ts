import { Inngest } from "inngest";
import type { AsyncResponseValue } from "inngest/types";
import { sentryMiddleware } from "@inngest/middleware-sentry";
import { endpointAdapter } from "inngest/next";

const resolveInngestDevMode = (): boolean => {
  const explicit = process.env.INNGEST_DEV?.trim().toLowerCase();

  if (explicit === "1" || explicit === "true") {
    return true;
  }

  if (explicit === "0" || explicit === "false") {
    return false;
  }

  return process.env.NODE_ENV !== "production";
};

export const inngest = new Inngest({
  id: "orbit",
  isDev: resolveInngestDevMode(),
  middleware: [sentryMiddleware()],
  endpointAdapter: endpointAdapter.withOptions({
    functionId: "orbit-suggestion-endpoint",
    asyncRedirectUrl: "/api/suggestion/poll",
    asyncResponse: "token" as AsyncResponseValue,
  }),
});
