import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import OSS from "ali-oss";
import sharp from "sharp";
import { CATALOG_ID, createRunReader } from "@cfp/a-j-oker-protocol";
import { historySchema, sessionSchema } from "@cfp/a-j-oker-contracts";
import { seedSyntheticAge } from "./synthetic-age";

// Explicit paid test. Synthetic identities live only in a fresh disposable DB;
// image generation, moderation and OSS use real configured providers.
assert.equal(process.env.HELLO_IMAGE_LIVE_TEST, "true", "请显式允许真实生图验收（会调用付费服务）");
for (const key of ["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "HELLO_OSS_BUCKET", "HELLO_OSS_REGION", "HELLO_OSS_ACCESS_KEY_ID", "HELLO_OSS_ACCESS_KEY_SECRET"])
  assert.ok(process.env[key], `缺少 ${key}`);
assert.equal(process.env.HELLO_MEDIA_STORAGE, "oss");
const directory = await mkdtemp(path.join(tmpdir(), "hello-http-e2e-image-"));
const origin = "http://127.0.0.1:3341";
const output = path.resolve(".data/image-live");
await mkdir(output, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${directory}/test.db`, HELLO_DEPLOYED: "false",
  HELLO_ORIGIN: origin, HELLO_TRUST_PROXY: "false", HELLO_ADMIN_BOOTSTRAP: "false",
  HELLO_PRIVACY_DELETION_LEDGER: `${directory}/ledger.ndjson`, PAYLOAD_SECRET: randomUUID(),
});
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const { mintCredential, COOKIE } = await import("../src/server/auth");
const payload = await cms();
const owner = { id: randomUUID(), auth: "miniapp" as const, wechatKey: "" };
const other = { id: randomUUID(), auth: "miniapp" as const, wechatKey: "" };
const repo = new Repository(payload, owner);
const privacy = new PrivacyService(repo);
const objects = new OSS({ bucket: process.env.HELLO_OSS_BUCKET, region: process.env.HELLO_OSS_REGION,
  accessKeyId: process.env.HELLO_OSS_ACCESS_KEY_ID!, accessKeySecret: process.env.HELLO_OSS_ACCESS_KEY_SECRET!,
  secure: true, authorizationV4: true, timeout: 20_000 });
const prefix = `hello-agent/${createHash("sha256").update(owner.id).digest("hex").slice(0, 32)}/`;
const secrets = Object.entries(process.env).filter(([key, value]) => /secret|token|key|password/i.test(key) && value).map(([, value]) => value!);
let server: ReturnType<typeof spawn> | undefined;
let stage = "fixture";
let cleaned = false;
const started = Date.now();
try {
  await (await import("../src/cms/seed")).seedAgents(payload);
  await seedSyntheticAge(payload, owner);
  await seedSyntheticAge(payload, other);
  const native = await mintCredential(payload, "miniapp", owner.id, owner.wechatKey);
  const cookie = await mintCredential(payload, "cookie", owner.id, owner.wechatKey);
  const stranger = await mintCredential(payload, "miniapp", other.id, other.wechatKey);
  secrets.push(native.token, cookie.token, stranger.token);
  const headers = { Authorization: `Bearer ${native.token}`, "Content-Type": "application/json" };
  const policy = privacyPolicy();
  assert.equal(policy.ready, true);
  assert.equal(policy.imageReviewDisclosed, true);
  assert.match(JSON.stringify(policy.documents), /万相/);
  await privacy.consent({ version: policy.version, core: true, model: true, sensitive: true, external: false });
  server = spawn(process.execPath, [createRequire(import.meta.url).resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3341"], {
    env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.resume(); server.stderr!.resume();
  stage = "server";
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, "隔离服务启动失败");
    try { ready = (await fetch(`${origin}/api/ready`)).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "隔离服务启动超时");
  const json = async (route: string, body?: unknown) => {
    const response = await fetch(`${origin}/api/hello/${route}`, { headers,
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), signal: AbortSignal.timeout(240_000) });
    const data = await response.json();
    assert.equal(response.status, 200, `${route}: ${response.status} ${data.error || ""}`);
    return data;
  };
  assert.equal((await json("config")).imageGenerationConfigured, true);
  const session = sessionSchema.parse(await json("sessions", { title: "真实生图手机端验收（合成测试身份）" }));
  stage = "native-generation";
  const runId = randomUUID();
  const run = async (route: string, body: unknown, id: string) => {
    const response = await fetch(`${origin}/api/hello/${route}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
    assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
    // Native Taro buffers the same SSE response before consuming it.
    const reader = createRunReader(id);
    reader.push(await response.text()); reader.finish();
  };
  try {
    await run("ag-ui", { protocolVersion: "1.0", threadId: String(session.id), runId, tools: [], context: [],
      messages: [{ id: `user_${runId}`, role: "user", content: "请调用生图工具为我画一张真正的水彩插画：阳光下窗台上的一盆红番茄，没有人物，没有文字，方形画幅。不要用几何图形代替图片。配一句简短祝福。" }],
      forwardedProps: { mode: "platform", mediaIds: [], a2uiClientCapabilities: { supportedCatalogIds: [CATALOG_ID] } } }, runId);
  } catch (error) {
    const history = historySchema.parse(await json(`sessions/${session.id}`));
    const pending = history.find((row) => row.imageGeneration?.canResume);
    if (!pending) throw error;
    console.log("原生请求中断，使用原任务继续取图（不重新提交生成）");
    const resumeId = randomUUID();
    await run("image-resume", { turnId: pending.id, requestId: resumeId }, resumeId);
  }
  console.log("PASS real native AG-UI image generation");
  if (process.env.HELLO_IMAGE_LIVE_BROWSER === "true") {
    await rm(path.join(output, "browser-done"), { force: true });
    await writeFile(path.join(output, "access.json"), JSON.stringify({ origin, cookie: { name: COOKIE, value: cookie.token }, sessionId: session.id }), { mode: 0o600 });
    console.log("浏览器验收就绪；凭证只写入本地私密文件 .data/image-live/access.json");
    stage = "browser";
    let done = false;
    for (let attempt = 0; attempt < 900; attempt++) {
      try { await access(path.join(output, "browser-done")); done = true; break; } catch { /* UI test running */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(done, "浏览器验收未完成");
  }
  stage = "storage-and-auth";
  const history = historySchema.parse(await json(`sessions/${session.id}`));
  assert.ok(history.length >= 1);
  const media = await repo.all("media");
  assert.ok(media.length >= 1, "必须生成真实媒体，不能只返回结构化插画");
  const publicHistory = JSON.stringify(history);
  assert.ok(!/maas\.aliyuncs|dashscope-result|taskId|oss-cn-shenzhen/.test(publicHistory));
  const report: { bytes: number; width?: number; height?: number }[] = [];
  for (const row of media) {
    assert.equal(row.base64, null);
    assert.equal((row.generation as { model: string }).model, "wan2.6-t2i");
    assert.equal((row.safetyReview as { decision: string }).decision, "allow");
    const object = row.object as { key: string; bucket: string; region: string; sha256: string };
    assert.ok(object.key.startsWith(prefix));
    const stored = Buffer.from((await objects.get(object.key)).content);
    assert.equal(createHash("sha256").update(stored).digest("hex"), object.sha256);
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.format, "jpeg");
    if (process.env.HELLO_IMAGE_LIVE_CAPTURE === "true")
      await writeFile(path.join(output, `generated-${report.length + 1}.jpg`), stored, { mode: 0o600 });
    const turn = history.find((entry) => entry.artifacts?.some((a) => a.kind === "image" && a.source.type === "media" && a.source.mediaId === row.id));
    assert.ok(turn, "真实图片必须关联为手机端的回应作品");
    assert.equal(turn.status, "completed");
    const artifact = turn.artifacts!.find((a) => a.kind === "image" && a.source.type === "media" && a.source.mediaId === row.id)!;
    for (const route of [`media/${row.id}`, `artifact-image/${turn.id}/${artifact.id}`]) {
      const url = `${origin}/api/hello/${route}`;
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), stored);
      assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${stranger.token}` } })).status, 404);
      assert.equal((await fetch(url)).status, 401);
      assert.equal((await fetch(url, { headers: { Cookie: `${COOKIE}=${cookie.token}` } })).status, 200);
    }
    assert.equal((await fetch(`https://${object.bucket}.${object.region}.aliyuncs.com/${object.key}`)).status, 403);
    report.push({ bytes: stored.length, width: metadata.width, height: metadata.height });
  }
  const exported = await json("privacy/export");
  assert.equal(exported.media.length, media.length);
  console.log("PASS real Green review, OSS hash readback, native/H5 owner access, stranger 404, anonymous 401, OSS private 403, export");
  stage = "deletion";
  await json("privacy/delete", { confirmation: "删除我的全部在线数据" });
  assert.equal((await objects.list({ prefix, "max-keys": 100 }, {})).objects?.length || 0, 0);
  cleaned = true;
  const result = { at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), images: report, deleted: true };
  await writeFile(path.join(output, "report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  let detail = error instanceof Error ? error.message : "unknown";
  for (const secret of secrets) if (secret.length >= 6) detail = detail.split(secret).join("[redacted]");
  console.error(JSON.stringify({ stage, error: detail.slice(-3000) })); process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>((resolve) => server!.once("exit", () => resolve()));
    server.kill("SIGTERM"); const timer = setTimeout(() => server!.kill("SIGKILL"), 5000);
    await stopped; clearTimeout(timer);
  }
  if (!cleaned) {
    try { await privacy.deleteData(); assert.equal((await objects.list({ prefix, "max-keys": 100 }, {})).objects?.length || 0, 0); cleaned = true; }
    catch { console.error(`清理需重试，保留隔离库：${directory}`); process.exitCode = 1; }
  }
  await payload.destroy();
  await rm(path.join(output, "access.json"), { force: true });
  if (cleaned) await rm(directory, { recursive: true, force: true });
}
