import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // 预览服务器仅在独立 typecheck 通过后设置，避免重复占用内存。
  typescript: { ignoreBuildErrors: process.env.HELLO_BUILD_TYPES_VERIFIED === "true" },
  transpilePackages: [
    "@cfp/hello-agent-contracts",
    "@cfp/hello-agent-protocol",
  ],
  // 小型 ECS 构建限制并行度，避免挤占同机官网的资源。
  ...(process.env.HELLO_BUILD_PREVIEW === "true"
    ? { experimental: { cpus: 1 } }
    : {}),
  serverExternalPackages: [
    // OSS SDK 包含可选代理依赖，按 Node 服务端包加载，不交给前端构建器展开。
    "ali-oss",
    "libsql",
    "unpdf",
    "@google/adk",
    "@google/genai",
    "@modelcontextprotocol/sdk",
  ],
};
export default withPayload(config);
