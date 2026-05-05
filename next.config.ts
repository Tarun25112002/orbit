import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tells Vercel's bundler to skip these native Docker/SSH packages
  serverExternalPackages: ["dockerode", "ssh2"],
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
