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
};

export default withPayload(nextConfig);
