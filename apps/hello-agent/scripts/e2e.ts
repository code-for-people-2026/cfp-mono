import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const directory = await mkdtemp(path.join(tmpdir(), "hello-http-e2e-"));
const origin = "http://127.0.0.1:3311";
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HELLO_ORIGIN: origin,
  HELLO_DATABASE_URI: `file:${directory}/test.db`,
  HELLO_ADMIN_BOOTSTRAP: "false",
  HELLO_HTTP_ISOLATED: "true",
  PAYLOAD_SECRET: "isolated-http-test-secret-not-for-deployment",
  DEEPSEEK_API_KEY: "",
  NODE_ENV: "production",
};
// CI 中自行启动生产构建，不要求另有开发进程，也不写入开发数据库。
await promisify(execFile)(
  process.execPath,
  ["--import", "tsx", "scripts/init-db.ts"],
  { env: { ...env, NODE_ENV: "development" }, timeout: 60_000 },
);
const require = createRequire(import.meta.url);
const server = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    "3311",
  ],
  {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
const stopped = new Promise<void>((resolve) =>
  server.once("exit", () => resolve()),
);
try {
  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error("隔离测试服务启动失败，请先构建并确认 3311 端口空闲");
    // 先确认自己启动的进程就绪，避免把其他占用端口的应用当成测试目标。
    if (!output.includes("Ready in")) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    try {
      ready = (
        await fetch(`${origin}/api/hello/config`, {
          signal: AbortSignal.timeout(1000),
        })
      ).ok;
    } catch {
      /* 启动期间稍后重试。 */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("隔离测试服务启动超时");
  const test = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "scripts/http-smoke.ts"],
    { env, timeout: 60_000 },
  );
  console.log(test.stdout);
} catch (error) {
  // 测试进程没有真实模型凭证，日志只用于定位启动失败。
  console.error(output);
  throw error;
} finally {
  server.kill("SIGTERM");
  const force = setTimeout(() => server.kill("SIGKILL"), 5000);
  await stopped;
  clearTimeout(force);
}
