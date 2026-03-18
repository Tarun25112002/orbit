import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "lightningcss",
    "@tailwindcss/oxide",
  ],
};

export default nextConfig;
