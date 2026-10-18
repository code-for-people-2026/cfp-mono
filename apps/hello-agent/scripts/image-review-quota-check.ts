import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { AppError } from "../src/domain/contracts";
import type { ImageReview } from "../src/operations/image-review";

const dir = await mkdtemp(path.join(tmpdir(), "hello-image-review-quota-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`, PAYLOAD_SECRET: "image-review-quota-isolated-test-only",
  HELLO_DEPLOYED: "true", HELLO_MEDIA_STORAGE: "database", DASHSCOPE_API_KEY: "", NODE_ENV: "test",
  HELLO_IMAGE_OWNER_DAILY_LIMIT: "100", HELLO_IMAGE_GLOBAL_DAILY_LIMIT: "1000",
  HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "2", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "3",
});
const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { Repository } = await import("../src/cms/repository");
const { MediaService } = await import("../src/domain/media");
const { GreetingService } = await import("../src/domain/greetings");
const { ImageGenerationService, readImageState } = await import("../src/images/service");
const { reviewImage } = await import("../src/operations/image-review");
const { reserveImageReview } = await import("../src/operations/image-review-quota");
const payload = await cms();
const clearReviews = () => payload.db.drizzle.run(sql`DELETE FROM platform_model_quotas WHERE day LIKE 'image-review:%'`);
const ledger = () => payload.db.drizzle.all<{ day: string; reserved_calls: number }>(sql`SELECT day, reserved_calls FROM platform_model_quotas WHERE day LIKE 'image-review:%' ORDER BY day`);
const counts = () => Promise.all((["safety-cases", "safety-evidence", "safety-audit", "media"] as const).map(async (collection) => (await payload.count({ collection, overrideAccess: true })).totalDocs));
try {
  await payload.db.migrate({ migrations: migrations.map((migration) => ({ name: migration.name, up: (args: unknown) => migration.up(args as MigrateUpArgs), down: (args: unknown) => migration.down(args as MigrateDownArgs) })) });
  const pixels = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#559977" } }).jpeg().toBuffer();
  Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "1", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "1" });
  for (const key of ["HELLO_IMAGE_REVIEW_MODE", "HELLO_IMAGE_REVIEW_URL", "HELLO_IMAGE_REVIEW_TOKEN", "HELLO_GREEN_ACCESS_KEY_ID", "HELLO_GREEN_ACCESS_KEY_SECRET"]) delete process.env[key];
  const configuredRepo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  const configuredService = new GreetingService(configuredRepo, undefined, new MediaService(configuredRepo, () => undefined));
  const beforeConfigurationFailure = await counts();
  let proxyCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://review.example.invalid/check", "no real service may receive a test request");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-review-token");
    proxyCalls++;
    return Response.json({ decision: "allow", version: "synthetic-config-recovery", category: "test" });
  };
  try {
    const invalidConfigurations: { mode?: string; url?: string; token?: string }[] = [
      {}, {}, { mode: "aliyun-green" },
      { url: "http://review.example.invalid/check", token: "synthetic-review-token" },
      { url: "https://user:password@review.example.invalid/check", token: "synthetic-review-token" },
      { url: "not-a-valid-url", token: "synthetic-review-token" },
    ];
    for (const config of invalidConfigurations) {
      for (const [key, value] of [["HELLO_IMAGE_REVIEW_MODE", config.mode], ["HELLO_IMAGE_REVIEW_URL", config.url], ["HELLO_IMAGE_REVIEW_TOKEN", config.token]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await assert.rejects(configuredService.upload(pixels), { status: 503 });
      assert.deepEqual(await ledger(), [], "known missing/invalid reviewer configuration must not consume quota");
      assert.deepEqual(await counts(), beforeConfigurationFailure, "configuration errors must not create content cases or save pixels");
      assert.equal(proxyCalls, 0);
    }
    delete process.env.HELLO_IMAGE_REVIEW_MODE;
    Object.assign(process.env, { HELLO_IMAGE_REVIEW_URL: "https://review.example.invalid/check", HELLO_IMAGE_REVIEW_TOKEN: "synthetic-review-token" });
    const configuredUpload = await configuredService.upload(pixels);
    assert.equal(proxyCalls, 1, "fixing configuration still permits the first budgeted call");
    assert.deepEqual((await ledger()).map((row) => row.reserved_calls), [1, 1]);
    assert.equal((await configuredRepo.get("media", configuredUpload.id)).safetyReview?.decision, "allow");
  } finally { globalThis.fetch = originalFetch; }
  await clearReviews();
  Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "2", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "3" });
  console.log("✓ missing or invalid reviewer configuration charges nothing and creates no cases; a restored synthetic proxy call charges once and saves the upload");

  let calls = 0, throwReview = false;
  let decision: ImageReview["decision"] = "allow";
  const reviewer = async (): Promise<ImageReview> => {
    calls++;
    if (throwReview) throw new Error("synthetic lost review response");
    return { decision, version: "synthetic-budget-review", category: "test" };
  };
  const allowText = async () => {};
  const fixture = async () => {
    const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
    const media = new MediaService(repo, () => undefined);
    const service = new GreetingService(repo, undefined, media, undefined, { moderate: allowText, imageReviewer: reviewer });
    const session = await repo.create("sessions", { title: "合成图片审核预算验证" });
    const turn = () => repo.create("greetings", { sessionId: session.id, requestKey: randomUUID(), fingerprint: "synthetic", status: "running", mode: "byok", input: { text: "合成图片审核", mediaIds: [] } });
    return { repo, media, service, turn };
  };
  const illustration = { kind: "image" as const, id: "synthetic", title: "合成插画", alt: "绿色圆形", source: { type: "illustration" as const, background: "#ffffff", shapes: [{ type: "circle" as const, x: 100, y: 100, radius: 50, fill: "#559977" }] } };
  const output = { greeting: "一张测试插画", association: "合成验证" };
  const a = await fixture(), b = await fixture(), c = await fixture();
  await a.service.upload(pixels);
  const legacy = await a.media.save(pixels);
  const legacyTurn = await a.turn();
  await a.service.complete(legacyTurn.id, { ...output, artifacts: [{ ...illustration, source: { type: "media", mediaId: legacy.id } }] });
  assert.equal(calls, 2, "upload and legacy output review share one owner budget");
  const beforeOwnerRejection = await counts();
  const blockedIllustration = await a.turn();
  await assert.rejects(a.service.complete(blockedIllustration.id, { ...output, artifacts: [illustration] }), { status: 429 });
  await assert.rejects(a.service.upload(pixels), { status: 429 });
  assert.equal(calls, 2);
  assert.deepEqual(await counts(), beforeOwnerRejection, "quota refusal creates no fake case, evidence, audit or media");
  assert.equal((await a.repo.get("greetings", blockedIllustration.id)).greeting, null);
  const allowedIllustration = await b.turn();
  await b.service.complete(allowedIllustration.id, { ...output, artifacts: [illustration] });
  assert.equal(calls, 3, "another owner may spend the remaining global budget");
  const beforeGlobalRejection = await counts(), beforeGlobalLedger = await ledger();
  await assert.rejects(c.service.upload(pixels), { status: 429 });
  assert.equal(calls, 3);
  assert.deepEqual(await counts(), beforeGlobalRejection);
  assert.deepEqual(await ledger(), beforeGlobalLedger, "global refusal rolls back the new owner counter");
  console.log("✓ upload, legacy media and illustration share owner/global review limits; refusal calls no provider and creates no false safety records");

  await clearReviews();
  Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "1", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "2" });
  throwReview = true;
  await assert.rejects(reviewImage(c.repo, pixels, reviewer), { status: 503 });
  assert.deepEqual((await ledger()).map((row) => row.reserved_calls), [1, 1]);
  const afterUnknown = await counts(), afterUnknownLedger = await ledger(), afterUnknownCalls = calls;
  throwReview = false;
  await assert.rejects(reviewImage(c.repo, pixels, reviewer), { status: 429 });
  assert.equal(calls, afterUnknownCalls);
  assert.deepEqual(await counts(), afterUnknown);
  assert.deepEqual(await ledger(), afterUnknownLedger, "an unknown review response is not refunded");
  console.log("✓ lost review responses retain the charge; subsequent quota refusal adds no unavailable-content case");

  await clearReviews();
  Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "1", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "1" });
  const pending = await fixture(), imageTurn = await pending.turn();
  let submissions = 0;
  const generator = new ImageGenerationService(pending.repo, pending.media, allowText, reviewer, () => ({
    async submit() { submissions++; return "synthetic-review-quota-task"; },
    async result() { return pixels; },
  }));
  const request = { prompt: "合成绿色小树", title: "小树", alt: "绿色小树", aspectRatio: "square" as const };
  const generate = () => generator.generate(imageTurn.id, request, AbortSignal.timeout(15_000));
  decision = "unavailable";
  await assert.rejects(generate(), { status: 503 });
  assert.equal(readImageState(await pending.repo.get("greetings", imageTurn.id))?.status, "pending");
  const taskLedger = await payload.db.drizzle.all(sql`SELECT day, reserved_calls FROM platform_model_quotas WHERE day LIKE 'image:%' ORDER BY day`);
  const beforePendingRejection = await counts(), beforePendingCalls = calls;
  decision = "allow";
  await assert.rejects(generate(), { status: 429 });
  assert.equal(readImageState(await pending.repo.get("greetings", imageTurn.id))?.status, "pending", "quota exhaustion must not permanently block the paid task");
  assert.equal(calls, beforePendingCalls);
  assert.equal(submissions, 1);
  assert.deepEqual(await counts(), beforePendingRejection);
  Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "2", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "2" });
  const saved = await generate();
  assert.equal(submissions, 1, "review quota recovery reuses the original provider task");
  assert.equal(calls, beforePendingCalls + 1);
  assert.deepEqual((await ledger()).map((row) => row.reserved_calls), [2, 2]);
  const beforeStored = await ledger(), beforeStoredCalls = calls;
  Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "0", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "0" });
  assert.equal((await generate()).mediaId, saved.mediaId);
  assert.equal(calls, beforeStoredCalls, "stored reads perform no additional review");
  assert.deepEqual(await ledger(), beforeStored);
  assert.deepEqual(await payload.db.drizzle.all(sql`SELECT day, reserved_calls FROM platform_model_quotas WHERE day LIKE 'image:%' ORDER BY day`), taskLedger, "review retries do not charge the generation-task budget");
  console.log("✓ pending tasks survive review exhaustion and resume without resubmitting; stored reads bypass review quota");

  await clearReviews();
  Object.assign(process.env, { HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "100", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "1000" });
  await payload.db.drizzle.run(sql`INSERT INTO platform_model_quotas (day, reserved_calls) VALUES ('image-review:2000-01-01:owner:expired', 1), ('image:2000-01-01:global', 7), ('admission:2000-01-01:safety:global', 3), ('2000-01-01', 77)`);
  await reserveImageReview(payload, "synthetic-cleanup");
  assert.ok((await ledger()).every((row) => !row.day.startsWith("image-review:2000")));
  assert.deepEqual(await payload.db.drizzle.all<{ reserved_calls: number }>(sql`SELECT reserved_calls FROM platform_model_quotas WHERE day IN ('2000-01-01', 'admission:2000-01-01:safety:global', 'image:2000-01-01:global') ORDER BY day`), [{ reserved_calls: 77 }, { reserved_calls: 3 }, { reserved_calls: 7 }]);
  const beforeOutage = await counts(), beforeOutageCalls = calls;
  await payload.db.drizzle.run(sql`ALTER TABLE platform_model_quotas RENAME TO unavailable_quota`);
  await assert.rejects(reviewImage(a.repo, pixels, reviewer), (error) => error instanceof AppError && error.status === 503);
  assert.equal(calls, beforeOutageCalls);
  assert.deepEqual(await counts(), beforeOutage);
  await payload.db.drizzle.run(sql`ALTER TABLE unavailable_quota RENAME TO platform_model_quotas`);
  console.log("✓ review cleanup preserves other budgets; unavailable quota storage fails before provider and safety writes");
} finally {
  await payload.destroy();
  await rm(dir, { recursive: true, force: true });
}
