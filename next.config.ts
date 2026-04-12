import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const WEB_CONTAINER_HEADERS = [
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "credentialless",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/projects/:path*",
        headers: WEB_CONTAINER_HEADERS,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "student-aki",
  project: "orbit",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
