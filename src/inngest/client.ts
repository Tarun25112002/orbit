import { Inngest } from "inngest";
import { sentryMiddleware } from "@inngest/middleware-sentry";
import { endpointAdapter } from "inngest/next";

export const inngest = new Inngest({
  id: "orbit",
  middleware: [sentryMiddleware()],
  endpointAdapter,
});
