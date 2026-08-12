import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  output: "standalone",
  serverExternalPackages: ["exceljs"],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    const stagingHeaders = process.env.TEACHNOTES_ENVIRONMENT === "staging"
      ? [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]
      : [];
    return [
      {
        source: "/:path*",
        headers: [...staticSecurityHeaders, ...stagingHeaders],
      },
    ];
  },
};

export default nextConfig;
