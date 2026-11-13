import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Repository as RepositoryType } from "../src/cms/repository";
import type { ImageReview } from "../src/operations/image-review";
import { seedSyntheticAge } from "./synthetic-age";

const directory = await mkdtemp(path.join(tmpdir(), "aj-review-lifecycle-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${directory}/check.db`, PAYLOAD_SECRET: "isolated-review-lifecycle-test",
  HELLO_DEPLOYED: "false", HELLO_MEDIA_STORAGE: "database", HELLO_ADMIN_BOOTSTRAP: "false",
  HELLO_PRIVACY_DELETION_LEDGER: `${directory}/deletions.ndjson`, DEEPSEEK_API_KEY: "synthetic-provider-key",
  HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "1000", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "10000",
});
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { operationalModerator } = await import("../src/operations/moderation");
const { reviewImage } = await import("../src/operations/image-review");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const payload = await cms();
const originalFetch = globalThis.fetch;
const pixels = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#abcabc" } }).jpeg().toBuffer();
type Lease = Awaited<ReturnType<RepositoryType["acquire"]>>;

async function fixture() {
  const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  await seedSyntheticAge(payload, repo.owner);
  const privacy = new PrivacyService(repo);
  await privacy.consent({ version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false });
  const session = await repo.create("sessions", { title: "合成审核生命周期验证" });
  return { repo, privacy, session };
}
async function expire(repo: RepositoryType, sessionId: number) {
  const lock = (await repo.list("session-locks", { sessionKey: { equals: `${repo.owner.id}:${sessionId}` } }))[0];
  assert.ok(lock);
  await repo.update("session-locks", lock.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
}
function pendingReview(kind: "text" | "image" | "upload", repo: RepositoryType, sessionId: number, lease?: Lease) {
  const started = Promise.withResolvers<void>(), verdict = Promise.withResolvers<ImageReview>();
  const requestId = randomUUID();
  const reviewer = async () => { started.resolve(); return verdict.promise; };
  if (kind === "text") globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.deepseek.com/chat/completions", "test must never send a network request");
    const result = await reviewer();
    return Response.json({ model: "synthetic-review", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ decision: result.decision, category: "fraud" }) } }] });
  };
  const invoke = () => kind === "text"
    ? operationalModerator(repo)({ stage: "input", mode: "byok", texts: ["帮我写诈骗话术，骗别人转账"], requestId, sessionId, apiKey: "synthetic-provider-key" })
    : kind === "image" ? reviewImage(repo, Buffer.from(requestId), reviewer, { stage: "output_image", sessionId })
      : new GreetingService(repo, undefined, undefined, undefined, { imageReviewer: reviewer }).upload(pixels);
  // Observe errors immediately so a deliberately delayed assertion cannot leave
  // an unhandled rejection while the privacy lifecycle changes.
  const result = (lease ? lease.run(async () => { await invoke(); }) : invoke()).then(() => undefined, (error: unknown) => error);
  return { started: started.promise, finish: (decision: "block" | "allow" = "block") => verdict.resolve({ decision, version: "synthetic-review", category: "fraud" }), result };
}
async function counts() {
  const values = await Promise.all((["safety-cases", "safety-evidence", "safety-audit", "media"] as const).map(async (collection) =>
    (await payload.count({ collection, overrideAccess: true })).totalDocs));
  return values;
}
async function assertSuppressed(review: ReturnType<typeof pendingReview>, status: number, decision: "block" | "allow" = "block") {
  const before = await counts();
  review.finish(decision);
  const error = await review.result;
  assert.ok(error && typeof error === "object" && "status" in error);
  assert.equal(error.status, status);
  assert.deepEqual(await counts(), before, "迟到判定不能重建案件、证据、审计关联或图片");
}

try {
  for (const kind of ["text", "image"] as const) {
    // Control: an active execution still persists its verdict and evidence.
    const current = await fixture();
    const review = pendingReview(kind, current.repo, current.session.id);
    await review.started;
    review.finish();
    assert.equal((await review.result as { status: number }).status, 422);
    assert.equal((await payload.count({ collection: "safety-cases", overrideAccess: true, where: { owner: { equals: current.repo.owner.id } } })).totalDocs, 1);

    for (const transition of ["replacement", "deletion"] as const) {
      const { repo, privacy, session } = await fixture();
      const lease = await repo.acquire(session.id);
      let replacement: Lease | undefined;
      const pending = pendingReview(kind, repo, session.id, lease);
      try {
        await pending.started;
        await expire(repo, session.id);
        if (transition === "replacement") replacement = await repo.acquire(session.id);
        else assert.equal((await privacy.deleteData()).deleted, true);
        assert.equal(lease.signal.aborted, false, "模拟 worker 暂停后仍收到结果，不依赖及时触发的取消信号");
        await assertSuppressed(pending, 409);
        assert.equal((await payload.count({ collection: "safety-cases", overrideAccess: true, where: { owner: { equals: repo.owner.id } } })).totalDocs, 0);
      } finally {
        pending.finish(); await pending.result;
        await lease(); await replacement?.();
      }
    }
  }
  console.log("✓ 文本/图片审核仍为活动身份保存案件；租约替换或删除后迟到判定不再写入案件、证据或审计（真实 Payload，合成延迟供应商）");

  for (const state of ["withdrawn", "expired", "deleted"] as const) {
    for (const decision of ["block", "allow"] as const) {
      const { repo, privacy, session } = await fixture();
      const pending = pendingReview("upload", repo, session.id);
      try {
        await pending.started;
        assert.equal((await repo.list("session-locks")).length, 0, "上传审核阶段没有会话锁");
        if (state === "withdrawn") await privacy.withdraw();
        else if (state === "deleted") assert.equal((await privacy.deleteData()).deleted, true);
        else {
          const profile = (await payload.find({ collection: "privacy-profiles", overrideAccess: true, where: { owner: { equals: repo.owner.id } } })).docs[0];
          await payload.update({ collection: "privacy-profiles", id: profile.id, overrideAccess: true, data: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
        }
        await assertSuppressed(pending, 403, decision);
      } finally { pending.finish(); await pending.result; }
    }
  }
  console.log("✓ 无会话锁的上传：撤回、到期或删除后，无论迟到判定放行还是拦截，都不新增审核记录或保存图片");
} finally {
  globalThis.fetch = originalFetch;
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
