import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  experimental: { cpus: 1 },
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
};
export default withPayload(config);
