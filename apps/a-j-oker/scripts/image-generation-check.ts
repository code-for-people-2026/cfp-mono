import originals from "./fixtures/learning-card-originals.json";
import { CREATION_REFUSAL } from "../src/domain/creation-scope";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";
import { ImageSubmissionRejected, wanProvider, type ImageProvider } from "../src/images/wan";
import type { ImageObjectStore } from "../src/storage/oss";
import { AppError, ContentReviewError } from "../src/domain/contracts";
import type { Moderator } from "../src/domain/moderation";
import { imageReview, ordinaryInteraction, syntheticTextReview } from "./synthetic-text-review";
import { seedSyntheticAge } from "./synthetic-age";
import { SERVICE_SCOPE_REFUSAL } from "../src/domain/service-scope";

const directory = await mkdtemp(path.join(tmpdir(), "aj-image-generation-"));
Object.assign(process.env, { HELLO_DATABASE_URI: `file:${directory}/test.db`, PAYLOAD_SECRET: "isolated-image-generation-test", HELLO_MEDIA_STORAGE: "database", HELLO_DEPLOYED: "false", DEEPSEEK_API_KEY: "synthetic-test-only", DASHSCOPE_API_KEY: "", HELLO_PRIVACY_DELETION_LEDGER: `${directory}/deletions.ndjson` });
Object.assign(process.env, { HELLO_IMAGE_OWNER_DAILY_LIMIT: "100", HELLO_IMAGE_GLOBAL_DAILY_LIMIT: "1000" });
Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "1000", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "10000" });
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { MediaService } = await import("../src/domain/media");
const { runGreeting } = await import("../src/agent/runtime");
const { ImageGenerationService, canResumeImage, readImageState } = await import("../src/images/service");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const { GET, POST } = await import("../src/app/api/hello/[...path]/route");
const { mintCredential } = await import("../src/server/auth");
const payload = await cms();
await (await import("../src/cms/seed")).seedAgents(payload);
const imageInput = { prompt: "一盆窗台上的红番茄，温暖的水彩插画", title: "窗台的番茄", alt: "窗台上一盆红番茄", aspectRatio: "square" as const };
class ImageModel extends BaseLlm {
  private triedPrematureSave = false;
  constructor() { super({ model: "scripted-image-test-only" }); }
  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse> {
    if (!this.triedPrematureSave) {
      this.triedPrematureSave = true;
      yield { content: { role: "model", parts: [{ functionCall: { id: randomUUID(), name: "save_greeting", args: { greeting: "卡片做好了，请休息。", association: "故意尝试用文字冒充图片", artifacts: [] } } }] } };
      return;
    }
    const saveAttempt = request.contents.flatMap(c => c.parts || []).find(p => p.functionResponse?.name === "save_greeting");
    assert.ok(saveAttempt?.functionResponse?.response?.error, "premature text-only completion must be rejected before saving");
    const decision = request.contents.flatMap(c => c.parts || []).findLast(p => p.functionResponse?.name === "decide_image_request");
    if (!decision) {
      yield { content: { role: "model", parts: [{ functionCall: { id: randomUUID(), name: "decide_image_request", args: { decision: "allow", reason: "合成正常插画需求" } } }] } };
      return;
    }
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
// Intentionally disobey the tool instructions to exercise the program gate.
class RefusalModel extends BaseLlm {
  private step = 0;
  constructor(private scenario: "missing" | "refuse" | "parallel" | "uncertain") { super({ model: "synthetic-refusal-gate" }); }
  async *generateContentAsync(): AsyncGenerator<LlmResponse> {
    const call = (name: string, args: Record<string, unknown>) => ({ functionCall: { id: randomUUID(), name, args } });
    const refuse = call("decide_image_request", { decision: this.scenario === "uncertain" ? "uncertain" : "refuse", reason: "原意不安全或不能确认，不能以反向图替代" });
    const allow = call("decide_image_request", { decision: "allow", reason: "试图用反向图绕过拒绝" });
    const generate = call("generate_image", imageInput);
    const save = call("save_greeting", { greeting: "我还是给你一张替代图。", association: "合成越权测试", artifacts: [{ kind: "image", id: "replacement", title: "反向图", alt: "替代图", source: { type: "illustration", background: "#ffffff", shapes: [{ type: "circle", x: 50, y: 50, radius: 20, fill: "#000000" }] } }] });
    const steps = this.scenario === "missing" ? [[generate], [refuse], [save]]
      : this.scenario === "parallel" ? [[allow, generate], [refuse, generate], [save]]
      : [[refuse], [allow], [generate], [save]];
    const parts = steps[this.step++];
    assert.ok(parts, "脚本应在有限步骤内结束");
    yield { content: { role: "model", parts } };
  }
  async connect(): Promise<never> { throw new Error("not supported in tests"); }
}
class TextOnlyModel extends BaseLlm {
  constructor() { super({ model: "scripted-text-only-test" }); }
  async *generateContentAsync(): AsyncGenerator<LlmResponse> {
    yield { content: { role: "model", parts: [{ functionCall: { id: randomUUID(), name: "save_greeting", args: { greeting: "先听你说，不生成图片。", association: "语义未请求图片" } } }] } };
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
const allowText: Moderator = async request => {
  if (request.purpose === "image_generation") return imageReview(true);
  if (request.interaction) return { ...(await syntheticTextReview(request)), interaction: { ...ordinaryInteraction, image_requested: true } };
  return syntheticTextReview(request);
};
const allowImage = async () => ({ decision: "allow" as const, version: "synthetic-review", category: "test" });
try {
  const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  await seedSyntheticAge(payload, repo.owner);
  const media = new MediaService(repo, () => store);
  const service = new GreetingService(repo, (request) => runGreeting(request, new ImageModel()), media, undefined, { moderate: allowText, imageReviewer: allowImage, imageProvider: () => provider });
  const session = await service.createSession("生图集成验收");
  const input = { sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { mediaIds: [], text: "制作一张自我关怀心理支持图片，用窗台番茄作为装饰，提醒温柔对待自己" } };
  const progress: string[] = [];
  const saved = await service.generateGreeting(input, (message) => progress.push(message));
  assert.equal(saved.status, "completed");
  assert.match(saved.association || "", /制图素材不代表已核实的本人状态/);
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

  const third = await repo.create("greetings", { sessionId: session.id, requestKey: `${repo.owner.id}:${randomUUID()}`, fingerprint: "synthetic", status: "running", mode: "platform", input: { mediaIds: [], text: "制作一张休息提醒卡" } });
  const denied = new ImageGenerationService(repo, media, async () => { throw new ContentReviewError(422, "合成提示词审核拒绝"); }, allowImage, () => provider);
  await assert.rejects(() => denied.generate(third.id, imageInput, AbortSignal.timeout(3000)), /审核拒绝/);
  assert.equal(submitted, 2, "提示词拒绝发生在收费调用前");
  const blocked = new ImageGenerationService(repo, media, allowText, async () => ({ decision: "block", version: "synthetic-block", category: "test" }), () => provider);
  await assert.rejects(() => blocked.generate(third.id, imageInput, AbortSignal.timeout(10000)), /未通过内容审核/);
  assert.equal((await repo.all("media")).length, 2);
  assert.equal(canResumeImage(await repo.get("greetings", third.id)), false);

  const fourth = await repo.create("greetings", { sessionId: session.id, requestKey: `${repo.owner.id}:${randomUUID()}`, fingerprint: "synthetic", status: "running", mode: "platform", input: { mediaIds: [], text: "制作一张休息提醒卡" } });
  let uncertainCalls = 0;
  const uncertain = new ImageGenerationService(repo, media, allowText, allowImage, () => ({ ...provider, async submit() { uncertainCalls++; throw new AppError(502, "提交回执丢失"); } }));
  await assert.rejects(() => uncertain.generate(fourth.id, imageInput, AbortSignal.timeout(3000)), /回执丢失/);
  await assert.rejects(() => uncertain.generate(fourth.id, imageInput, AbortSignal.timeout(3000)), /避免重复扣费/);
  assert.equal(uncertainCalls, 1);

  // Replay the real FAILED/DataInspectionFailed response through the adapter
  // and product service. It must be terminal safety blocking, not a dead task.
  for (const duringSubmit of [true, false]) {
    const row = await repo.create("greetings", { sessionId: session.id, requestKey: randomUUID(), fingerprint: "provider-block", status: "running", mode: "platform", input: { mediaIds: [], text: "制作一张休息提醒卡（合成供应商拒绝测试）" } });
    const mockFetch: typeof fetch = async (_input, init) => Response.json(init?.method === "POST"
      ? duringSubmit ? { code: "DataInspectionFailed" } : { output: { task_id: "blocked-task", task_status: "PENDING" } }
      : { output: { task_id: "blocked-task", task_status: "FAILED", code: "DataInspectionFailed" } }, { status: init?.method === "POST" && duringSubmit ? 400 : 200 });
    const generator = new ImageGenerationService(repo, media, allowText, allowImage, () => wanProvider("https://dashscope.aliyuncs.com", "synthetic", mockFetch));
    await assert.rejects(generator.generate(row.id, imageInput, AbortSignal.timeout(3000)), { status: 422 });
    assert.equal((await repo.get("greetings", row.id)).imageGeneration?.status, "blocked");
    assert.equal(canResumeImage(await repo.get("greetings", row.id)), false);
  }
  const limited = await repo.create("greetings", { sessionId: session.id, requestKey: randomUUID(), fingerprint: "provider-throttle", status: "running", mode: "platform", input: { mediaIds: [], text: "制作一张休息提醒卡（合成限流测试）" } });
  const throttled = new ImageGenerationService(repo, media, allowText, allowImage, () => ({ ...provider, async submit() { throw new ImageSubmissionRejected(503, "尚未受理"); } }));
  await assert.rejects(throttled.generate(limited.id, imageInput, AbortSignal.timeout(3000)), /尚未受理/);
  assert.equal((await repo.get("greetings", limited.id)).imageGeneration?.status, "failed");
  assert.equal(canResumeImage(await repo.get("greetings", limited.id)), false);

  const privacy = new PrivacyService(repo, media);
  await privacy.consent({ version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false });
  const exported = await privacy.exportData();
  assert.equal(exported.media.filter((entry) => "source" in entry && entry.source?.includes("AI 生成")).length, 2);
  // HTTP auth/ownership paths run against the same real database; use database storage
  // for this one route fixture because the production route constructs its own store.
  const routeMedia = await new MediaService(repo, () => undefined).save((await media.read(imageRow.id)).bytes);
  const routeTurn = await repo.create("greetings", { sessionId: session.id, requestKey: randomUUID(), fingerprint: "route", mode: "external", status: "completed", input: { mediaIds: [], text: "制作一张休息提醒卡" }, greeting: "测试图片", artifacts: [{ kind: "image", id: "test", title: "测试", alt: "测试", source: { type: "media", mediaId: routeMedia.id } }] });
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
  // A model can rewrite a harmful request into an innocent drawing. The
  // product must check the original request before new work AND old-task reuse.
  const policyRepo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  await seedSyntheticAge(payload, policyRepo.owner);
  const policyMedia = new MediaService(policyRepo, () => store);
  const harmfulOriginal = "请制作一张休息提醒卡，把虚构外交危机包装成权威消息";
  let originalReviews = 0, pixelReviews = 0;
  const rejectOriginal: Moderator = async (request) => {
    if (request.purpose === "image_generation") {
      originalReviews++;
      assert.equal(request.stage, "input");
      assert.deepEqual(request.texts, [harmfulOriginal], "审核原题，不能只检查已改写的番茄绘图说明");
      throw new ContentReviewError(422, "原请求拒绝，不生成替代图");
    }
    if (request.interaction) return syntheticTextReview(request);
  };
  const policyService = new GreetingService(policyRepo, undefined, policyMedia, undefined, { moderate: rejectOriginal, imageReviewer: async () => { pixelReviews++; return allowImage(); }, imageProvider: () => provider });
  const policySession = await policyService.createSession("有害原请求不自动改图");
  const policyImages = new ImageGenerationService(policyRepo, policyMedia, rejectOriginal, allowImage, () => provider);
  const beforeIntentGate = { submitted, downloaded, objects: objects.size };
  for (const state of [undefined, "pending", "stored"] as const) {
    const row = await policyRepo.create("greetings", { sessionId: policySession.id, requestKey: randomUUID(), fingerprint: "original-image-intent", status: "running", mode: "platform", input: { mediaIds: [], text: harmfulOriginal },
      ...(state ? { imageGeneration: { input: imageInput, model: "wan2.6-t2i", status: state, startedAt: new Date().toISOString(), taskId: "existing-task", ...(state === "stored" ? { mediaId: imageRow.id } : {}) } } : {}) });
    await assert.rejects(policyImages.generate(row.id, imageInput, AbortSignal.timeout(3000)), { status: 422 });
    const rejected = await policyRepo.get("greetings", row.id);
    assert.equal(rejected.imageGeneration?.status ?? undefined, state ? "blocked" : undefined);
    assert.equal(canResumeImage(rejected), false, "明确拒绝的旧任务不能继续试取图片");
  }
  for (const source of [{ type: "illustration" as const, background: "#ffffff", shapes: [{ type: "circle" as const, x: 50, y: 50, radius: 20, fill: "#000000" }] }, { type: "media" as const, mediaId: imageRow.id }]) {
    const row = await policyRepo.create("greetings", { sessionId: policySession.id, requestKey: randomUUID(), fingerprint: "save-image-intent", status: "running", mode: "platform", input: { mediaIds: [], text: harmfulOriginal } });
    await assert.rejects(policyService.complete(row.id, { greeting: "我改成一张公益图", association: "合成绕过验证", artifacts: [{ kind: "image", id: "replacement", title: "公益图", alt: "清楚的公益图片", source }] }), { status: 422 });
    assert.equal((await policyRepo.get("greetings", row.id)).status, "running");
    await policyService.complete(row.id, { greeting: "不能伪造权威消息，本次不生成图片。", association: "拒绝原请求", artifacts: [] });
    assert.equal((await policyRepo.get("greetings", row.id)).status, "completed", "安全文字拒绝仍可保存");
  }
  assert.equal(originalReviews, 5); assert.equal(pixelReviews, 0);
  assert.deepEqual({ submitted, downloaded, objects: objects.size }, beforeIntentGate, "拒绝前不提交、取图、审核图片或存储");
  console.log("✓ 有害原请求防改图：新任务、待取任务、已存图片、几何插画及旧图引用5条路径拒绝，零生图/取图/像素审核，纯文字拒绝可保存（合成判定，真实应用/数据库）。");
  const beforeCoordinatorGate = { submitted, downloaded, objects: objects.size };
  for (const scenario of ["missing", "refuse", "parallel", "uncertain"] as const) {
    const refusalService = new GreetingService(policyRepo, request => runGreeting(request, new RefusalModel(scenario)), policyMedia, undefined, { moderate: allowText, imageReviewer: allowImage, imageProvider: () => provider });
    const refusalSession = await refusalService.createSession(`拒绝门禁-${scenario}`);
    const result = await refusalService.generateGreeting({ sessionId: refusalSession.id, requestId: randomUUID(), mode: "platform", input: { mediaIds: [], text: harmfulOriginal } });
    assert.equal(result.status, "completed");
    assert.equal(result.greeting, "抱歉，这个图片请求不能执行，本次不会生成图片。");
    assert.deepEqual(result.artifacts, []);
    assert.deepEqual({ submitted, downloaded, objects: objects.size }, beforeCoordinatorGate, "未判定、拒绝后改口、并行调用均不能触发生图");
  }
  console.log("✓ ADK拒绝门禁：未判定、拒绝后改口、并行绕过均零生图，拒绝回复无替代作品。");
  // Simulate a media commit whose turn reference has not yet been written.
  const unlinked = await media.save((await media.read(imageRow.id)).bytes, { turnId: fourth.id, provider: "bailian", model: "wan2.6-t2i", taskId: "synthetic-unlinked" });
  for (const turn of [saved, fourth]) await payload.create({ collection: "safety-enforcements", overrideAccess: true, context: { safetyInternal: true }, data: { key: `synthetic-turn:${turn.id}`, owner: repo.owner.id, targetType: "turn", targetId: turn.id, sessionId: session.id, caseId: 1, active: true, reason: "仅合成隔离测试" } });
  await assert.rejects(() => media.read(imageRow.id), { status: 404 });
  await assert.rejects(() => media.read(unlinked.id), { status: 404 });
  assert.equal(canResumeImage(await repo.get("greetings", fourth.id)), false);
  {
    let modelCalls = 0;
    class MustNotRun extends ImageModel {
      override async *generateContentAsync(): AsyncGenerator<LlmResponse> { modelCalls++; yield { errorCode: "UNEXPECTED_MODEL_CALL", errorMessage: "超范围制作不应调用模型" }; }
    }
    const refuseScope: Moderator = async request => {
      // This synthetic reviewer semantically rejects the scripted outside-scope
      // calculation-card output without restoring a production keyword gate.
      if (request.stage === "output" && request.context === "请制作一张计算卡" && !request.texts.includes(CREATION_REFUSAL))
        return { serviceScope: "outside" };
      return {
        ...(await syntheticTextReview(request)),
        ...(request.interaction ? { serviceScope: "outside" as const } : {}),
      };
    };
    const scoped = new GreetingService(repo, request => runGreeting(request, new MustNotRun()), media, undefined, { moderate: refuseScope, imageReviewer: allowImage, imageProvider: () => provider });
    const scopedSession = await scoped.createSession("通用制作范围回归");
    const before = submitted;
    for (const item of [...originals, { id: "poster", text: "制作一张公益海报" }, { id: "mixed", text: "制作休息提醒卡并附上计算题" }]) {
      const result = await scoped.generateGreeting({ sessionId: scopedSession.id, requestId: randomUUID(), mode: "platform", input: { mediaIds: [], text: item.text } });
      assert.equal(result.greeting, SERVICE_SCOPE_REFUSAL, item.id);
      assert.deepEqual(result.artifacts, []);
    }
    assert.equal(modelCalls, 0); assert.equal(submitted, before);
    const outsideImageReview: Moderator = async request => request.purpose === "image_generation"
      ? { serviceScope: "outside" as const, interaction: { ...ordinaryInteraction, image_requested: true } }
      : syntheticTextReview(request);
    const allowedMediaId = (await repo.all("media")).find(m => m.id !== imageRow.id && m.id !== unlinked.id)!.id;
    for (const verdict of [
      { name: "outside", review: outsideImageReview, status: 422, blocked: true },
      { name: "not-requested", review: (async () => imageReview(false)) as Moderator, status: 422, blocked: true },
      { name: "missing", review: (async () => undefined) as Moderator, status: 503, blocked: false },
      { name: "unclear", review: (async () => ({ serviceScope: "unclear" as const, interaction: { ...ordinaryInteraction, image_requested: true } })) as Moderator, status: 503, blocked: false },
      { name: "support-alone", review: (async () => ({ serviceScope: "support" as const })) as Moderator, status: 503, blocked: false },
    ] as const) {
      const blockedRow = await repo.create("greetings", { sessionId: scopedSession.id, requestKey: randomUUID(), fingerprint: "scope-bypass", status: "running", mode: "platform", input: { mediaIds: [], text: "请制作一张计算卡" } });
      const newService = new ImageGenerationService(repo, media, verdict.review, allowImage, () => provider);
      await assert.rejects(newService.generate(blockedRow.id, imageInput, AbortSignal.timeout(3000)), { status: verdict.status }, `${verdict.name}/new`);
      assert.equal(readImageState(await repo.get("greetings", blockedRow.id)), undefined, `${verdict.name}/new`);
      for (const state of ["pending", "stored"] as const) {
        await repo.update("greetings", blockedRow.id, { imageGeneration: { input: imageInput, model: "wan2.6-t2i", status: state, startedAt: new Date().toISOString(), taskId: "scope-old-task", ...(state === "stored" ? { mediaId: allowedMediaId } : {}) } });
        const service = new ImageGenerationService(repo, media, verdict.review, allowImage, () => provider);
        await assert.rejects(service.generate(blockedRow.id, imageInput, AbortSignal.timeout(3000)), { status: verdict.status }, `${verdict.name}/${state}`);
        assert.equal((await repo.get("greetings", blockedRow.id)).imageGeneration?.status, verdict.blocked ? "blocked" : state, `${verdict.name}/${state}`);
      }
    }
    const unsupported = await repo.create("greetings", { sessionId: scopedSession.id, requestKey: randomUUID(), fingerprint: "scope-bypass", status: "running", mode: "platform", input: { mediaIds: [], text: "请制作一张计算卡" } });
    for (const verdict of [undefined, { serviceScope: "unclear" as const }] ) {
      const unavailableScope = new GreetingService(repo, undefined, undefined, undefined, { moderate: async () => verdict });
      await assert.rejects(unavailableScope.complete(unsupported.id, {
        greeting: "合成作品", association: "范围未确定", artifacts: [{ kind: "card", id: "card", title: "合成卡片", body: "合成内容" }],
      }), { status: verdict ? 422 : 503 });
      assert.equal((await repo.get("greetings", unsupported.id)).status, "running", "missing or unclear semantic scope must not save an artifact");
    }
    await assert.rejects(scoped.complete(unsupported.id, { greeting: "给你替代作品", association: "合成越权", artifacts: [{ kind: "card", id: "card", title: "计算卡", body: "13+5-3=15" }] }), { status: 422 });
    await scoped.complete(unsupported.id, { greeting: CREATION_REFUSAL, association: "范围拒绝", artifacts: [] });
    console.log("✓ 原11题计算卡及海报/混合请求明确拒绝，零生成模型/生图调用；新任务、旧任务恢复、文字替代均不能绕过（合成审核、真实应用路径）。");
  }
  {
    const semanticRepo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
    await seedSyntheticAge(payload, semanticRepo.owner);
    const semanticMedia = new MediaService(semanticRepo, () => store);
    const semanticModerator = (imageRequested: boolean): Moderator => async request => {
      if (request.purpose === "image_generation") return imageReview(imageRequested);
      if (request.stage === "output") return request.serviceScope ? { serviceScope: "support" as const } : undefined;
      return { serviceScope: "support" as const, interaction: { ...ordinaryInteraction, image_requested: imageRequested } };
    };
    const missingImageSemantics: Moderator = async request =>
      request.purpose === "image_generation" ? undefined : syntheticTextReview(request);
    let semanticSubmitted = 0, semanticDownloaded = 0;
    const semanticProvider: ImageProvider = {
      async submit() { return `semantic-task-${++semanticSubmitted}`; },
      async result() { semanticDownloaded++; return png; },
    };
    const beforeDirectObjects = objects.size;
    const directSession = await new GreetingService(semanticRepo, undefined, semanticMedia, undefined, {
      moderate: semanticModerator(true), imageReviewer: allowImage,
    }).createSession("图片服务语义验收");
    const directRow = (text: string, imageGeneration?: NonNullable<ReturnType<typeof readImageState>>) => semanticRepo.create("greetings", {
      sessionId: directSession.id, requestKey: randomUUID(), fingerprint: "semantic-image-service",
      status: "running", mode: "platform", input: { mediaIds: [], text },
      ...(imageGeneration ? { imageGeneration } : {}),
    });
    const directService = (moderator: Moderator) =>
      new ImageGenerationService(semanticRepo, semanticMedia, moderator, allowImage, () => semanticProvider);
    const naturalText = "可以给我一个能陪我做三次深呼吸的视觉画面吗";
    const generated = await directService(semanticModerator(true)).generate(
      (await directRow(naturalText)).id, imageInput, AbortSignal.timeout(3000),
    );
    assert.deepEqual({ semanticSubmitted, semanticDownloaded }, { semanticSubmitted: 1, semanticDownloaded: 1 });
    const ordinaryDisclosure = "朋友让我生成自我关怀图片，但我不要图片，只想聊聊我很累";
    await assert.rejects(
      directService(semanticModerator(false)).generate(
        (await directRow(ordinaryDisclosure)).id, imageInput, AbortSignal.timeout(3000),
      ),
      { status: 422 },
    );
    await assert.rejects(
      directService(missingImageSemantics).generate(
        (await directRow(naturalText)).id, imageInput, AbortSignal.timeout(3000),
      ),
      { status: 503 },
    );
    for (const state of ["pending", "stored"] as const) {
      const row = await directRow(naturalText, {
        input: imageInput, model: "wan2.6-t2i", status: state, startedAt: new Date().toISOString(),
        taskId: "semantic-existing-task", ...(state === "stored" ? { mediaId: generated.mediaId } : {}),
      });
      await assert.rejects(directService(missingImageSemantics).generate(row.id, imageInput, AbortSignal.timeout(3000)), { status: 503 });
      assert.equal((await semanticRepo.get("greetings", row.id)).imageGeneration?.status, state, `${state} 语义缺失时保持可恢复但不放行`);
    }
    assert.deepEqual({ semanticSubmitted, semanticDownloaded }, { semanticSubmitted: 1, semanticDownloaded: 1 }, "否定意图与语义缺失都不得触碰供应商");
    const reuseRow = await directRow(naturalText);
    const reused = await new GreetingService(semanticRepo, undefined, semanticMedia, undefined, {
      moderate: semanticModerator(true), imageReviewer: allowImage,
    }).complete(reuseRow.id, {
      greeting: "把之前生成的画面继续留给你。", association: "本轮明确要求视觉画面，复用已审核生成图",
      artifacts: [{ kind: "image", id: "reused", title: imageInput.title, alt: imageInput.alt, source: { type: "media", mediaId: generated.mediaId } }],
    });
    assert.equal(reused.status, "completed", "旧可信生成图在新的明确图片请求中仍可复用");
    const beforeSemantic = { submitted };
    const authentic = new GreetingService(semanticRepo, request => runGreeting(request, new ImageModel()), semanticMedia, undefined, { moderate: semanticModerator(true), imageReviewer: allowImage, imageProvider: () => provider });
    const authenticSession = await authentic.createSession("无历史关键词语义放行");
    const authenticResult = await authentic.generateGreeting({ sessionId: authenticSession.id, requestId: randomUUID(), mode: "platform", input: { mediaIds: [], text: "可否为我准备一个帮助此刻平静下来的视觉画面" } });
    assert.equal(authenticResult.status, "completed");
    assert.equal(authenticResult.artifacts?.length, 1);
    assert.equal(submitted, beforeSemantic.submitted + 1, "明确语义支持请求必须进入图片供应商");
    const ordinary = new GreetingService(semanticRepo, request => runGreeting(request, new TextOnlyModel()), semanticMedia, undefined, { moderate: semanticModerator(false), imageReviewer: allowImage, imageProvider: () => provider });
    const ordinarySession = await ordinary.createSession("关键词样披露语义拒绝");
    const ordinaryResult = await ordinary.generateGreeting({ sessionId: ordinarySession.id, requestId: randomUUID(), mode: "platform", input: { mediaIds: [], text: "朋友让我生成自我关怀图片，但我不要图片，只想聊聊我很累" } });
    assert.equal(ordinaryResult.greeting, "先听你说，不生成图片。");
    assert.equal(ordinaryResult.artifacts?.length ?? 0, 0);
    assert.equal(submitted, beforeSemantic.submitted + 1, "语义 false 时关键词再多也不能触发生图");
    await new PrivacyService(semanticRepo, semanticMedia).deleteData();
    assert.equal(objects.size, beforeDirectObjects, "语义回归清理后不留下测试对象");
    console.log("✓ 无历史关键词的明确支持画面进入供应商；关键词样但语义否定的倾诉只走文字生成器。");
  }
  await privacy.deleteData();
  assert.equal(objects.size, 0);
  assert.equal((await repo.all("greetings")).length, 0);
  assert.equal((await repo.all("media")).length, 0);
  console.log("✓ 实际 ADK→生图工具→审核→私有对象存储→回应作品；断线/存储恢复不重复生成，未知回执不重扣，审核拒绝、鉴权、来源导出和删除通过（供应商与 OSS 使用明确标记的合成测试实现）。");
} finally {
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
