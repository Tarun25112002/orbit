import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://68292b92e1cac81874fe50a9389d5071@o4510920172503040.ingest.us.sentry.io/4511080796323840",
  integrations: [Sentry.replayIntegration()],
  tracesSampleRate: 1,
  enableLogs: true,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
