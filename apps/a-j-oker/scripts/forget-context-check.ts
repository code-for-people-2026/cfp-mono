import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { seedSyntheticAge } from "./synthetic-age";

const folder = await mkdtemp(path.join(tmpdir(), "aj-forget-check-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${folder}/test.db`,
  PAYLOAD_SECRET: randomUUID(),
  HELLO_DEPLOYED: "false",
  DEEPSEEK_API_KEY: "synthetic-test-only",
  HELLO_PRIVACY_DELETION_LEDGER: `${folder}/deletions.jsonl`,
});
globalThis.fetch = async () => { throw new Error("No live service allowed"); };

const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { ContextService } = await import("../src/domain/context");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const { ContentReviewError } = await import("../src/domain/contracts");
const payload = await cms();

try {
  const owner = { id: randomUUID(), auth: "cookie" as const, wechatKey: "" };
  await seedSyntheticAge(payload, owner);
  const repo = new Repository(payload, owner);
  await new PrivacyService(repo).consent({ version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false });
  const ordinary = { minor: false, crisis: false, dependency: false, overuse: false, exit: false, forget_context: false, image_requested: false };
  let generated = 0;
  const service = new GreetingService(repo, async r => {
    generated++;
    if (generated > 2) assert.ok(!JSON.stringify(await new ContextService(repo).modelContext(r.sessionId)).includes("飞机"), "forgotten history and compressed summary must not reach the next generator");
    await r.save({ greeting: generated <= 2 ? "你说过怕坐飞机。" : "你可以自行决定是否重新提供信息。", association: "合成回归", artifacts: [] });
  }, undefined, undefined, {
    moderate: async request => {
      if (request.stage === "output") return;
      const text = request.texts[0] ?? "";
      assert.equal(request.interaction, true);
      assert.equal(request.serviceScope, true);
      return {
        serviceScope: "support" as const,
        interaction: text === "请不要再把之前的对话用于后续聊天。" ? { ...ordinary, forget_context: true } : ordinary,
      };
    },
  });
  const session = await service.createSession();
  const send = (text: string) => service.generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text, mediaIds: [] } });
  const first = await send("请记住我怕坐飞机。");
  await repo.update("sessions", session.id, { memory: { revision: 1, throughId: first.id, summary: "用户怕坐飞机", compressions: 1 } });

  const emotional = await send("我想忘记痛苦，但我还想继续聊。");
  assert.equal(generated, 2, "emotional forgetting is not a memory mutation request");
  assert.match(emotional.greeting!, /怕坐飞机/);
  assert.equal((await repo.get("sessions", session.id)).memory?.revision, 1);

  const beforeRows = (await repo.all("greetings")).length;
  const invalid = new GreetingService(repo, async () => { throw new Error("missing semantic verdict must not generate"); }, undefined, undefined, { moderate: async () => undefined });
  await assert.rejects(invalid.generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "请不要再把之前的对话用于后续聊天。", mediaIds: [] } }), ContentReviewError);
  assert.equal((await repo.all("greetings")).length, beforeRows, "invalid semantic verdict must not mutate memory");

  const forgotten = await send("请不要再把之前的对话用于后续聊天。");
  assert.equal(generated, 2, "explicit forget request must be handled by product logic, not a model promise");
  assert.match(forgotten.greeting!, /原聊天记录仍保留/);
  assert.equal((await repo.get("sessions", session.id)).memory?.revision, 2);
  await send("你还记得我害怕什么吗？");
  assert.equal(generated, 3);
  assert.equal((await repo.get("greetings", first.id)).greeting, "你说过怕坐飞机。", "original historical evidence must not be altered");
  assert.ok(!JSON.stringify(await new ContextService(repo).modelContext(session.id)).includes("飞机"));
  console.log("PASS: semantic forget distinguishes emotional pain, fails closed on invalid verdict, clears future context, and retains records");
} finally {
  await payload.destroy();
  await rm(folder, { recursive: true, force: true });
}
