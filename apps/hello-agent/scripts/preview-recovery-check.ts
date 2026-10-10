import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const dir = await mkdtemp(path.join(tmpdir(), "hello-preview-recovery-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "preview-recovery-test-only";
process.env.HELLO_DEPLOYED = "false";
process.env.HELLO_ORIGIN = "https://preview.example.invalid";
process.env.HELLO_AD_MODE = "disabled";
process.env.HELLO_MEMORY_RECOVERY = "preview";
process.env.DEEPSEEK_API_KEY = "fixture-not-sent-to-provider";
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { ContextService } = await import("../src/domain/context");
const payload = await cms();
try {
  const repo = new Repository(payload, { id: randomUUID(), auth: "miniapp" });
  let generations = 0;
  const service = new GreetingService(repo, async (args) => {
    generations++;
    await args.save({
      greeting: "好".repeat(1000),
      association: "隔离合成回复",
    });
  });
  const session = await service.createSession("测试版满血条恢复");
  const input = () => ({
    sessionId: session.id,
    requestId: randomUUID(),
    mode: "platform",
    input: { text: "字".repeat(4000), mediaIds: [] },
  });
  for (let i = 0; i < 3; i++) await service.generateGreeting(input());
  let summaries = 0;
  const context = new ContextService(repo, async () => {
    summaries++;
    return "用户正在记录日常。";
  });
  const full = await context.view(session.id);
  assert.equal(full.level, "empty");
  assert.equal(full.advertisement.mode, "disabled");
  assert.equal(full.recoveryMode, "preview");
  await assert.rejects(() => service.generateGreeting(input()), /空间已满/);
  await assert.rejects(() => context.startAd(session.id), /广告尚未配置/);
  // 对外业务接口必须有明确的测试版恢复通道；不伪造一条已完成广告。
  const operation = randomUUID();
  const restored = await context.compactPreview(session.id, operation, 0);
  assert.ok(restored.remainingPercent > 0);
  assert.equal(restored.rewardReady, false);
  assert.equal((await service.history(session.id)).length, 3);
  assert.equal(
    (await context.compactPreview(session.id, operation, 0)).compressions,
    1,
  );
  assert.equal(summaries, 1);
  const modelContext = await context.modelContext(session.id);
  assert.equal(modelContext.previous.length, 2);
  assert.equal(modelContext.memory, "用户正在记录日常。");
  const storedMemory = (await repo.get("sessions", session.id)).memory;
  assert.equal(storedMemory?.reward, undefined);
  assert.equal(
    storedMemory?.lastCompaction && "rewardId" in storedMemory.lastCompaction,
    false,
  );
  await assert.rejects(
    () => context.finishAd(session.id, operation, true),
    /广告/,
  );
  const stranger = new ContextService(
    new Repository(payload, { id: randomUUID(), auth: "miniapp" }),
  );
  await assert.rejects(
    () => stranger.compactPreview(session.id, operation, 0),
    /无权/,
  );
  const agent = new ContextService(
    new Repository(payload, { ...repo.owner, auth: "bearer" }),
  );
  await assert.rejects(
    () => agent.compactPreview(session.id, operation, 0),
    /用户/,
  );
  process.env.HELLO_MEMORY_RECOVERY = "disabled";
  await assert.rejects(
    () => context.compactPreview(session.id, operation, 0),
    /未开启/,
  );
  process.env.HELLO_MEMORY_RECOVERY = "preview";
  await service.generateGreeting(input());
  assert.equal(generations, 4);
  assert.equal((await service.history(session.id)).length, 4);
  const beforeFailure = await context.modelContext(session.id);
  const failed = new ContextService(repo, async () => {
    throw new Error("fixture-private-error");
  });
  const retry = randomUUID();
  await assert.rejects(
    () => failed.compactPreview(session.id, retry, 1),
    /原记录保留/,
  );
  assert.deepEqual(await context.modelContext(session.id), beforeFailure);
  assert.equal((await context.view(session.id)).compressions, 1);
  await context.compactPreview(session.id, retry, 1);
  await assert.rejects(
    () => context.compactPreview(session.id, operation, 0),
    /记忆已在别处整理/,
  );
  assert.equal(summaries, 2);
  await service.acceptExternal({
    sessionId: session.id,
    requestId: randomUUID(),
    input: { text: "恢复后外部产物" },
    output: { greeting: "祝今天顺利", association: "合成数据" },
    model: "fixture",
  });
  const byok = new GreetingService(repo, async (args) => {
    assert.equal(args.apiKey, "fixture-byok-not-a-real-key");
    await args.save({
      greeting: "恢复后自带密钥也可继续",
      association: "合成数据",
    });
  });
  await byok.generateGreeting({
    ...input(),
    mode: "byok",
    apiKey: "fixture-byok-not-a-real-key",
    input: { text: "恢复后的日常" },
  });
  assert.equal((await service.history(session.id)).length, 6);
  console.log(
    "✓ 远端禁用广告时，显式测试版入口整理满血条，历史保留且重试不重复调用摘要模型",
  );
} finally {
  await payload.destroy();
}
