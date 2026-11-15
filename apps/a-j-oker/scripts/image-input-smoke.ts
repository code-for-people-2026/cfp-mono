import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { historySchema, sessionSchema, turnResultSchema } from "@cfp/a-j-oker-contracts";

// Real model smoke test with synthetic identities in a disposable database.
// Never seed age evidence, consent, or credentials into a user's database.
assert.ok(process.env.DEEPSEEK_API_KEY, "需要真实模型配置");
const directory = await mkdtemp(path.join(tmpdir(), "hello-http-e2e-live-"));
const origin = "http://127.0.0.1:3315";
const env: NodeJS.ProcessEnv = { ...process.env, HELLO_ORIGIN: origin, HELLO_DATABASE_URI: `file:${directory}/test.db`, HELLO_PRIVACY_DELETION_LEDGER: `${directory}/ledger.ndjson`, HELLO_HTTP_ISOLATED: "true", HELLO_TRUST_PROXY: "true", HELLO_ADMIN_BOOTSTRAP: "false", NODE_ENV: "production" };
const child = (script: string, extra: Partial<NodeJS.ProcessEnv> = {}, args: string[] = []) => promisify(execFile)(process.execPath, ["--import", "tsx", script, ...args], { env: { ...env, ...extra }, timeout: 240_000, maxBuffer: 2 ** 20 });
let server: ReturnType<typeof spawn> | undefined;
let stage = "initialize";
const secrets = Object.entries(process.env).filter(([key, value]) => /secret|token|key|password/i.test(key) && value).map(([, value]) => value!);
let deleteFixture: (() => Promise<void>) | undefined;
try {
  await child("scripts/seed.ts");
  const seeded = await child("scripts/http-fixture.ts");
  const fixtures = JSON.parse(seeded.stdout.trim().split("\n").at(-1)!) as { native: { token: string }; otherCookie: string };
  secrets.push(fixtures.native.token);
  // The isolated listener is loopback-only; emulate the trusted proxy header.
  const headers = { "X-Real-IP": "127.0.0.1", Authorization: `Bearer ${fixtures.native.token}`, "Content-Type": "application/json" };
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
  deleteFixture = async () => {
    const result = await post("privacy/delete", { confirmation: "删除我的全部在线数据" });
    assert.equal(result.deleted, true, "隔离测试图片必须清理");
  };
  const policy = await (await fetch(`${origin}/api/hello/legal`)).json();
  assert.equal(policy.ready, true);
  assert.equal(policy.imageReviewDisclosed, true);
  await post("privacy/consent", { version: policy.version, core: true, model: true, sensitive: true, external: true, externalRecipient: { name: "隔离验收客户端与 DeepSeek", contact: "test@example.invalid", region: "中国境内", privacyUrl: "https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html" } });
  const session = sessionSchema.parse(await post("sessions", { title: "隔离图片识别验收" }));
  stage = "review-and-upload";
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="white"/><circle cx="150" cy="140" r="80" fill="red"/><rect x="360" y="60" width="160" height="160" fill="blue"/><text x="240" y="310" font-size="60" fill="black">4827</text></svg>')).jpeg({ quality: 90 }).toBuffer();
  const media = await post("upload", { base64: image.toString("base64") });
  const mediaUrl = `${origin}/api/hello/media/${media.id}`;
  const own = await fetch(mediaUrl, { headers });
  assert.equal(own.status, 200);
  assert.equal((await sharp(Buffer.from(await own.arrayBuffer())).metadata()).format, "jpeg");
  assert.equal((await fetch(mediaUrl)).status, 401);
  assert.equal((await fetch(mediaUrl, { headers: { Cookie: fixtures.otherCookie } })).status, 404);
  console.log("PASS real upload review, private storage, owner-only image access");
  for (const mode of ["platform", "byok"] as const) {
    stage = `${mode}-vision`;
    const turn = turnResultSchema.parse(await post("greet", { sessionId: session.id, requestId: randomUUID(), mode, ...(mode === "byok" ? { apiKey: process.env.DEEPSEEK_API_KEY } : {}), input: { text: "请先准确描述我上传图片左边和右边的形状与颜色，再读出图片里的四位数字。请简短回答。", mediaIds: [media.id] } }));
    assert.equal(turn.status, "completed");
    for (const expected of [/红/, /圆/, /蓝/, /方/, /4827/]) assert.match(turn.greeting || "", expected);
    console.log(`PASS real ${mode} vision: red circle, blue square, 4827`);
  }
  stage = "history-export";
  const history = historySchema.parse(await (await fetch(`${origin}/api/hello/sessions/${session.id}`, { headers })).json());
  assert.equal(history.length, 2);
  assert.ok(!JSON.stringify(history).includes(process.env.DEEPSEEK_API_KEY!));
  const exported = await fetch(`${origin}/api/hello/privacy/export`, { headers });
  const exportData = await exported.json();
  assert.equal(exported.status, 200, exportData.error || "图片与对话应能导出");
  assert.equal(exportData.records.greetings.length, 2);
  assert.equal(exportData.media.length, 1);
  assert.ok(exportData.media[0].base64);
  stage = "fixture-cleanup";
  await deleteFixture(); deleteFixture = undefined;
  assert.equal((await fetch(mediaUrl, { headers })).status, 401);
  console.log("PASS image history, export, deletion; no customer database used");
} catch (error) {
  // Keep diagnostic output limited to the disposable fixture; redact credentials.
  let detail = error instanceof Error ? error.message : "unknown";
  for (const secret of secrets) if (secret.length >= 6) detail = detail.split(secret).join("[redacted]");
  detail = detail.replace(/Bearer\s+[A-Za-z0-9_-]+/g, "Bearer [redacted]");
  console.error(JSON.stringify({ stage, error: detail.slice(-6000) }));
  process.exitCode = 1;
} finally {
  if (deleteFixture && server?.exitCode === null) {
    try { await deleteFixture(); }
    catch { console.error("隔离测试数据清理失败，需要按本次测试身份重试清理"); process.exitCode = 1; }
  }
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>((resolve) => server!.once("exit", () => resolve()));
    server.kill("SIGTERM");
    const timer = setTimeout(() => server!.kill("SIGKILL"), 5000);
    await stopped; clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
