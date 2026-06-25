import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  // The chat route reads knowledge/*.md at runtime via fs; make sure those files
  // are traced into the serverless function bundle on Vercel.
  outputFileTracingIncludes: {
    "/api/chat": ["./knowledge/**/*.md"],
  },
  // The interactive matrix moved from /map to /wam. Already-seeded Payload data
  // (site-settings.directionMapUrl, headerNav, footerLinks) and any old bookmarks
  // may still point at /map, so redirect the old paths instead of 404ing.
  async redirects() {
    return [
      { source: "/map", destination: "/wam", permanent: true },
      { source: "/map/:path*", destination: "/wam/:path*", permanent: true },
    ];
  },
};

export default withPayload(nextConfig);
