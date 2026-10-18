import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";
import type { ImageProvider } from "../src/images/wan";
import type { ImageObjectStore } from "../src/storage/oss";
import { AppError, ContentReviewError } from "../src/domain/contracts";
import { seedSyntheticAge } from "./synthetic-age";

const directory = await mkdtemp(path.join(tmpdir(), "aj-image-generation-"));
Object.assign(process.env, { HELLO_DATABASE_URI: `file:${directory}/test.db`, PAYLOAD_SECRET: "isolated-image-generation-test", HELLO_MEDIA_STORAGE: "database", HELLO_DEPLOYED: "false", DEEPSEEK_API_KEY: "synthetic-test-only", DASHSCOPE_API_KEY: "", HELLO_PRIVACY_DELETION_LEDGER: `${directory}/deletions.ndjson` });
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { MediaService } = await import("../src/domain/media");
const { runGreeting } = await import("../src/agent/runtime");
const { ImageGenerationService, canResumeImage } = await import("../src/images/service");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const { GET, POST } = await import("../src/app/api/hello/[...path]/route");
const { mintCredential } = await import("../src/server/auth");
const payload = await cms();
await (await import("../src/cms/seed")).seedAgents(payload);
const imageInput = { prompt: "一盆窗台上的红番茄，温暖的水彩插画", title: "窗台的番茄", alt: "窗台上一盆红番茄", aspectRatio: "square" as const };
class ImageModel extends BaseLlm {
  constructor() { super({ model: "scripted-image-test-only" }); }
  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse> {
    const result = request.contents.flatMap((content) => content.parts || []).findLast((part) => part.functionResponse?.name === "generate_image")?.functionResponse?.response;
    const initial = request.contents.flatMap((content) => content.parts || []).find((part) => part.text?.includes("currentInput"))?.text;
    const existing = initial ? JSON.parse(initial).generatedImage : undefined;
    const mediaId = result?.mediaId || existing?.mediaId;
    yield { content: { role: "model", parts: [{ functionCall: { id: randomUUID(), name: mediaId ? "save_greeting" : "generate_image", args: mediaId ? {
      greeting: "把这盆小番茄送给今天的自己。", association: "按用户要求生成窗台插画", artifacts: [{ kind: "image", id: "tomato", title: imageInput.title, alt: imageInput.alt, source: { type: "media", mediaId } }],
    } : imageInput } }] } };
  }
  async connect(): Promise<never> { throw new Error("not supported in tests"); }
}
const png = await sharp({ create: { width: 1280, height: 1280, channels: 3, background: "#ff6655" } }).png().toBuffer();
let submitted = 0, downloaded = 0, failDownload = false, failPut = false;
const provider: ImageProvider = {
  async submit() { submitted++; return `task-${submitted}`; },
  async result() { downloaded++; if (failDownload) throw new AppError(502, "合成下载中断"); return png; },
};
const objects = new Map<string, Buffer>();
const store: ImageObjectStore = {
  bucket: "synthetic-private-bucket", region: "oss-cn-shenzhen",
  async put(key, bytes) { if (failPut) throw new AppError(503, "合成存储中断"); objects.set(key, bytes); },
  async get(key) { const value = objects.get(key); assert.ok(value); return value; },
  async removePrefix(prefix) { for (const key of objects.keys()) if (key.startsWith(prefix)) objects.delete(key); },
};
const allowText = async () => {};
const allowImage = async () => ({ decision: "allow" as const, version: "synthetic-review", category: "test" });
try {
  const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  await seedSyntheticAge(payload, repo.owner);
  const media = new MediaService(repo, () => store);
  const service = new GreetingService(repo, (request) => runGreeting(request, new ImageModel()), media, undefined, { moderate: allowText, imageReviewer: allowImage, imageProvider: () => provider });
  const session = await service.createSession("生图集成验收");
  const input = { sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { mediaIds: [], text: "画一盆窗台上的番茄" } };
  const progress: string[] = [];
  const saved = await service.generateGreeting(input, (message) => progress.push(message));
  assert.equal(saved.status, "completed");
  // Simulate a suspended worker whose lease expires without its timer running.
  // SQLite must reject its late write even before the old AbortSignal notices.
  const staleTurn = await repo.create("greetings", { sessionId: session.id, requestKey: randomUUID(), fingerprint: "stale-lease", status: "running", mode: "platform", input: { mediaIds: [], text: "合成过期执行验证" } });
  const oldLease = await repo.acquire(session.id);
  const lateWrite = Promise.withResolvers<void>();
  const stale = oldLease.run(async () => { await lateWrite.promise; return service.complete(staleTurn.id, { greeting: "过期执行不能发布", association: "合成测试" }); });
  let replacement: Awaited<ReturnType<InstanceType<typeof Repository>["acquire"]>> | undefined;
  try {
    const lock = (await repo.list("session-locks", { sessionKey: { equals: `${repo.owner.id}:${session.id}` } }))[0];
    await repo.update("session-locks", lock.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    replacement = await repo.acquire(session.id);
    assert.equal(oldLease.signal.aborted, false, "模拟进程暂停，不依赖定时器及时触发");
    const rejected = assert.rejects(stale, { status: 409 });
    lateWrite.resolve(); await rejected;
    await oldLease();
    await assert.rejects(() => repo.acquire(session.id), { status: 409 }, "旧执行释放不能删除替换执行的锁");
    assert.equal((await repo.get("greetings", staleTurn.id)).status, "running");
    await replacement.run(() => service.complete(staleTurn.id, { greeting: "新执行可以发布", association: "合成测试" }));
    assert.equal((await repo.get("greetings", staleTurn.id)).greeting, "新执行可以发布");
  } finally {
    lateWrite.resolve(); await Promise.allSettled([stale]);
    await oldLease(); await replacement?.();
  }
  assert.equal(submitted, 1);
  assert.equal(objects.size, 1);
  assert.ok(progress.some((message) => message.includes("审核和保存")));
  const imageRow = (await repo.all("media"))[0];
  assert.equal(imageRow.base64, null);
  assert.equal((imageRow.generation as { model: string }).model, "wan2.6-t2i");
  assert.equal((await sharp((await media.read(imageRow.id)).bytes).metadata()).format, "jpeg");
  assert.equal((await service.generateGreeting(input)).id, saved.id);
  assert.equal(submitted, 1, "重复请求不重复付费");
  assert.ok(!JSON.stringify(await service.history(session.id)).includes("task-1"), "历史不泄露供应商任务和内部提示词");
  const stranger = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  await assert.rejects(() => new GreetingService(stranger).resumeImage(saved.id), { status: 404 });
  await assert.rejects(() => new MediaService(stranger, () => store).read(imageRow.id), { status: 404 });

  failDownload = true;
  const second = { ...input, requestId: randomUUID() };
  await assert.rejects(() => service.generateGreeting(second), /合成下载中断/);
  const failed = (await repo.all("greetings")).find((row) => row.requestKey === `${repo.owner.id}:${second.requestId}`)!;
  assert.equal(failed.status, "failed");
  assert.ok(canResumeImage(failed));
  assert.equal(submitted, 2);
  failDownload = false; failPut = true;
  await assert.rejects(() => service.resumeImage(failed.id), /合成存储中断/);
  assert.equal(submitted, 2);
  failPut = false;
  assert.equal((await service.resumeImage(failed.id)).status, "completed");
  assert.equal(submitted, 2, "下载和存储重试必须复用供应商任务");
  assert.equal(objects.size, 2);
  assert.equal((await repo.all("media")).length, 2);
  assert.ok(downloaded >= 4);

  const third = await repo.create("greetings", { sessionId: session.id, requestKey: `${repo.owner.id}:${randomUUID()}`, fingerprint: "synthetic", status: "running", mode: "platform", input: { mediaIds: [], text: "test" } });
  const denied = new ImageGenerationService(repo, media, async () => { throw new ContentReviewError(422, "合成提示词审核拒绝"); }, allowImage, () => provider);
  await assert.rejects(() => denied.generate(third.id, imageInput, AbortSignal.timeout(3000)), /审核拒绝/);
  assert.equal(submitted, 2, "提示词拒绝发生在收费调用前");
  const blocked = new ImageGenerationService(repo, media, allowText, async () => ({ decision: "block", version: "synthetic-block", category: "test" }), () => provider);
  await assert.rejects(() => blocked.generate(third.id, imageInput, AbortSignal.timeout(10000)), /未通过内容审核/);
  assert.equal((await repo.all("media")).length, 2);
  assert.equal(canResumeImage(await repo.get("greetings", third.id)), false);

  const fourth = await repo.create("greetings", { sessionId: session.id, requestKey: `${repo.owner.id}:${randomUUID()}`, fingerprint: "synthetic", status: "running", mode: "platform", input: { mediaIds: [], text: "test" } });
  let uncertainCalls = 0;
  const uncertain = new ImageGenerationService(repo, media, allowText, allowImage, () => ({ ...provider, async submit() { uncertainCalls++; throw new AppError(502, "提交回执丢失"); } }));
  await assert.rejects(() => uncertain.generate(fourth.id, imageInput, AbortSignal.timeout(3000)), /回执丢失/);
  await assert.rejects(() => uncertain.generate(fourth.id, imageInput, AbortSignal.timeout(3000)), /避免重复扣费/);
  assert.equal(uncertainCalls, 1);

  const privacy = new PrivacyService(repo, media);
  await privacy.consent({ version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false });
  const exported = await privacy.exportData();
  assert.equal(exported.media.filter((entry) => "source" in entry && entry.source?.includes("AI 生成")).length, 2);
  // HTTP auth/ownership paths run against the same real database; use database storage
  // for this one route fixture because the production route constructs its own store.
  const routeMedia = await new MediaService(repo, () => undefined).save((await media.read(imageRow.id)).bytes);
  const routeTurn = await repo.create("greetings", { sessionId: session.id, requestKey: randomUUID(), fingerprint: "route", mode: "external", status: "completed", input: { mediaIds: [], text: "test" }, greeting: "测试图片", artifacts: [{ kind: "image", id: "test", title: "测试", alt: "测试", source: { type: "media", mediaId: routeMedia.id } }] });
  const credential = await mintCredential(payload, "miniapp", repo.owner.id, repo.owner.wechatKey);
  await seedSyntheticAge(payload, stranger.owner);
  const otherCredential = await mintCredential(payload, "miniapp", stranger.owner.id, stranger.owner.wechatKey);
  const segments = ["artifact-image", String(routeTurn.id), "test"];
  const url = `http://127.0.0.1:3310/api/hello/${segments.join("/")}`;
  for (const [token, status] of [[credential.token, 200], [otherCredential.token, 404], ["", 401]] as const) {
    const response = await GET(new Request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({ path: segments }) });
    assert.equal(response.status, status);
    if (status === 200) assert.equal(response.headers.get("content-type"), "image/jpeg");
  }
  const unauthorized = await POST(new Request("http://127.0.0.1:3310/api/hello/image-resume", { method: "POST", body: JSON.stringify({ turnId: saved.id, requestId: randomUUID() }), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ path: ["image-resume"] }) });
  assert.equal(unauthorized.status, 401);
  const unavailableInput = { ...input, requestId: randomUUID() };
  const unavailableService = new GreetingService(repo, (request) => runGreeting(request, new ImageModel()), media, undefined, { moderate: allowText, imageReviewer: async () => ({ decision: "unavailable", version: "synthetic-outage", category: "test" }), imageProvider: () => provider });
  await assert.rejects(() => unavailableService.generateGreeting(unavailableInput), /可稍后继续取图/);
  const waitingReview = (await repo.all("greetings")).find((row) => row.requestKey === `${repo.owner.id}:${unavailableInput.requestId}`)!;
  assert.ok(canResumeImage(waitingReview), "审核服务故障保留原任务，确定拒绝的图片仍不可恢复");
  const beforeReviewRetry = submitted;
  assert.equal((await service.resumeImage(waitingReview.id)).status, "completed");
  assert.equal(submitted, beforeReviewRetry, "审核服务恢复后不重新计费生图");
  // Simulate a media commit whose turn reference has not yet been written.
  const unlinked = await media.save((await media.read(imageRow.id)).bytes, { turnId: fourth.id, provider: "bailian", model: "wan2.6-t2i", taskId: "synthetic-unlinked" });
  for (const turn of [saved, fourth]) await payload.create({ collection: "safety-enforcements", overrideAccess: true, context: { safetyInternal: true }, data: { key: `synthetic-turn:${turn.id}`, owner: repo.owner.id, targetType: "turn", targetId: turn.id, sessionId: session.id, caseId: 1, active: true, reason: "仅合成隔离测试" } });
  await assert.rejects(() => media.read(imageRow.id), { status: 404 });
  await assert.rejects(() => media.read(unlinked.id), { status: 404 });
  assert.equal(canResumeImage(await repo.get("greetings", fourth.id)), false);
  await privacy.deleteData();
  assert.equal(objects.size, 0);
  assert.equal((await repo.all("greetings")).length, 0);
  assert.equal((await repo.all("media")).length, 0);
  console.log("✓ 实际 ADK→生图工具→审核→私有对象存储→回应作品；断线/存储恢复不重复生成，未知回执不重扣，审核拒绝、鉴权、来源导出和删除通过（供应商与 OSS 使用明确标记的合成测试实现）。");
} finally {
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
