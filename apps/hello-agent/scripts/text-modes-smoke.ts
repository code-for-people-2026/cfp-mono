import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { historySchema, sessionSchema, turnResultSchema } from "@cfp/hello-agent-contracts";

// Real model smoke test with synthetic identities in a disposable database.
// Never seed age evidence, consent, or credentials into a user's database.
assert.ok(process.env.DEEPSEEK_API_KEY, "需要真实模型配置");
const directory = await mkdtemp(path.join(tmpdir(), "hello-http-e2e-live-"));
const origin = "http://127.0.0.1:3315";
const env: NodeJS.ProcessEnv = { ...process.env, HELLO_ORIGIN: origin, HELLO_DATABASE_URI: `file:${directory}/test.db`, HELLO_PRIVACY_DELETION_LEDGER: `${directory}/ledger.ndjson`, HELLO_HTTP_ISOLATED: "true", HELLO_TRUST_PROXY: "false", HELLO_ADMIN_BOOTSTRAP: "false", NODE_ENV: "production" };
const child = (script: string, extra: Partial<NodeJS.ProcessEnv> = {}, args: string[] = []) => promisify(execFile)(process.execPath, ["--import", "tsx", script, ...args], { env: { ...env, ...extra }, timeout: 240_000, maxBuffer: 2 ** 20 });
let server: ReturnType<typeof spawn> | undefined;
try {
  await child("scripts/init-db.ts");
  const seeded = await child("scripts/http-fixture.ts");
  const fixtures = JSON.parse(seeded.stdout.trim().split("\n").at(-1)!) as { native: { token: string } };
  const headers = { Authorization: `Bearer ${fixtures.native.token}`, "Content-Type": "application/json" };
  server = spawn(process.execPath, [createRequire(import.meta.url).resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3315"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let ready = false;
  server.stdout!.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) ready = true; });
  server.stderr!.resume();
  for (let attempt = 0; !ready && attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, "隔离服务未能启动");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "隔离服务启动超时");
  const post = async (route: string, body: unknown) => {
    const response = await fetch(`${origin}/api/hello/${route}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
    assert.equal(response.status, 200, `${route} HTTP ${response.status}`);
    return response.json();
  };
  const policy = await (await fetch(`${origin}/api/hello/legal`)).json();
  assert.equal(policy.ready, true);
  await post("privacy/consent", { version: policy.version, core: true, model: true, sensitive: true, external: true, externalRecipient: { name: "隔离验收客户端与 DeepSeek", contact: "test@example.invalid", region: "中国境内", privacyUrl: "https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html" } });
  const session = sessionSchema.parse(await post("sessions", { title: "隔离三种文字聊天验收" }));
  for (const mode of ["platform", "byok"] as const) {
    const turn = turnResultSchema.parse(await post("greet", { sessionId: session.id, requestId: randomUUID(), mode, ...(mode === "byok" ? { apiKey: process.env.DEEPSEEK_API_KEY } : {}), input: { text: "今天把桌面收拾整齐了，感觉轻松了一点。请简短回应。", mediaIds: [] } }));
    assert.equal(turn.status, "completed");
    assert.ok(turn.greeting);
    console.log(`PASS real ${mode} text generation`);
  }
  const credential = await post("token", {}) as { token: string };
  const external = await child("scripts/external-agent.ts", { HELLO_MCP_TOKEN: credential.token, HELLO_SESSION_ID: String(session.id) }, ["今天散步看到了阳光，请简短回应。"]);
  assert.equal(JSON.parse(external.stdout).status, "completed");
  const history = historySchema.parse(await (await fetch(`${origin}/api/hello/sessions/${session.id}`, { headers })).json());
  assert.deepEqual(history.map((row) => row.mode), ["platform", "byok", "external"]);
  assert.ok(!JSON.stringify(history).includes(process.env.DEEPSEEK_API_KEY!));
  console.log("PASS real external MCP generation and shared history; no customer database used");
} catch {
  // Child-process errors can contain request credentials; never echo raw errors.
  console.error("三种真实文字聊天验收失败，未输出请求、密钥或原始异常。");
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>((resolve) => server!.once("exit", () => resolve()));
    server.kill("SIGTERM");
    const timer = setTimeout(() => server!.kill("SIGKILL"), 5000);
    await stopped; clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
