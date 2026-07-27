import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const e2eDistDirs = new Set([".next-kith-inn-e2e", ".next-kith-inn-v1-e2e"]);
const e2eDistDir = process.env.CFP_CMS_E2E_DIST_DIR;
if (e2eDistDir && !e2eDistDirs.has(e2eDistDir)) {
  throw new Error("CFP_CMS_E2E_DIST_DIR must identify a known isolated E2E build directory");
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  ...(e2eDistDir ? { distDir: e2eDistDir } : {}),
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  // Workspace source packages consumed by this host export .ts source (not built
  // dist), so Next must transpile them.
  transpilePackages: ["@cfp/kith-inn-payload", "@cfp/kith-inn-shared"],
};

export default withPayload(nextConfig);
