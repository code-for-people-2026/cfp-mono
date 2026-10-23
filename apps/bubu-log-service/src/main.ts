import { createRuntime } from "./runtime";
import { identityDirectory, operationsOrigin } from "./runtime-config";
import { startRuntimeServer } from "./server";

const publicOrigin = process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320";
const opsOrigin = operationsOrigin();
const port = Number(process.env.PORT || 3320);
const hostname = process.env.HOST || "127.0.0.1";
const production = process.env.NODE_ENV === "production";
if (production && (!publicOrigin.startsWith("https://") || !opsOrigin.startsWith("https://") || !process.env.BUBU_IDENTITY_DIRECTORY || !process.env.BUBU_PAYLOAD_SECRET)) {
  throw new Error("Production requires HTTPS BUBU_PUBLIC_ORIGIN/BUBU_OPS_ORIGIN, persistent BUBU_IDENTITY_DIRECTORY and BUBU_PAYLOAD_SECRET.");
}
const runtime = await createRuntime({
  directory: identityDirectory(), secret: process.env.BUBU_PAYLOAD_SECRET,
  publicOrigin, opsOrigin,
  // Internal MCP always addresses this process, never a browser-supplied URL.
  mcpUrl: `http://127.0.0.1:${port}/api/mcp`,
});
const server = await startRuntimeServer(runtime, { port, hostname, production });
console.log("哺哺日记服务与 Payload 运营后台已启动");
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  if (closing) return;
  closing = true;
  void server.close().then(() => process.exit(0));
});
