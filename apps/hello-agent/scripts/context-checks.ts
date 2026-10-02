import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Repository, type Row } from "../src/cms/repository";
import { ContextService } from "../src/domain/context";
import { GreetingService } from "../src/domain/greetings";

export async function verifyContext(repo: Repository) {
  const session = await repo.create("sessions", { title: "记忆血条测试" });
  const rows: Row[] = [];
  for (let i = 0; i < 8; i++)
    rows.push(
      await repo.create("greetings", {
        sessionId: session.id,
        requestKey: randomUUID(),
        fingerprint: "test",
        mode: "platform",
        status: "completed",
        input: {
          text: `第${i}轮：用户明确说过喜欢小番茄。${"阳台种植日记。".repeat(230)}`,
          mediaIds: [],
        },
        greeting: "这是用于验证压缩逻辑的固定测试回复，不代表真实模型。",
      }),
    );
  let now = Date.now();
  let calls = 0;
  const context = new ContextService(
    repo,
    async (request) => {
      calls++;
      assert.equal(request.turns.length, 6);
      assert.equal(request.turns.at(-1)?.id, rows[5].id);
      return "用户喜欢小番茄，在阳台记录种植日记。";
    },
    () => now,
  );
  assert.equal((await context.view(session.id)).level, "empty");
  await assert.rejects(() => context.ensureRoom(session.id), /空间已满/);
  await assert.rejects(
    () =>
      new GreetingService(repo).acceptExternal({
        sessionId: session.id,
        requestId: randomUUID(),
        input: { text: "外部不能绕过" },
        output: { greeting: "固定回复", association: "测试" },
        model: "test",
      }),
    /空间已满/,
  );
  await assert.rejects(() => context.compact(session.id, randomUUID()), /广告/);
  const ad = await context.startAd(session.id);
  await assert.rejects(
    () => context.finishAd(session.id, ad.rewardId, true),
    /尚未播放/,
  );
  await assert.rejects(
    () => context.finishAd(session.id, ad.rewardId, false),
    /未完整/,
  );
  await assert.rejects(
    () => context.compact(session.id, ad.rewardId),
    /未完整/,
  );
  assert.equal(calls, 0);
  now += 5000;
  await context.finishAd(session.id, ad.rewardId, true);
  const failing = new ContextService(
    repo,
    async () => {
      throw new Error("secret-do-not-save");
    },
    () => now,
  );
  await assert.rejects(
    () => failing.compact(session.id, ad.rewardId),
    /原记录和观看资格/,
  );
  assert.equal((await context.startAd(session.id)).rewardId, ad.rewardId);
  const next = await context.compact(session.id, ad.rewardId);
  assert.ok(next.remainingPercent > 50);
  assert.equal(next.compressions, 1);
  assert.equal(next.rewardReady, false);
  assert.equal(
    (await context.compact(session.id, ad.rewardId)).compressions,
    1,
  );
  assert.equal(calls, 1);
  assert.equal((await new GreetingService(repo).history(session.id)).length, 8);
  const restored = new ContextService(new Repository(repo.payload, repo.owner));
  const model = await restored.modelContext(session.id);
  assert.equal(model.memory, next.summary);
  assert.equal(model.previous.length, 2);
  assert.equal(
    model.previous[0].input.text,
    (rows[6].input as { text: string }).text,
  );
  await context.ensureRoom(session.id);
  await assert.rejects(
    () => context.finishAd(session.id, ad.rewardId, true),
    /广告/,
  );
  const outsider = new ContextService(
    new Repository(repo.payload, { id: randomUUID(), auth: "cookie" }),
  );
  await assert.rejects(() => outsider.view(session.id), /无权/);
  await assert.rejects(() => outsider.compact(session.id, ad.rewardId), /无权/);
  const agent = new ContextService(
    new Repository(repo.payload, { ...repo.owner, auth: "bearer" }),
  );
  await assert.rejects(() => agent.startAd(session.id), /用户/);
  await assert.rejects(
    () => agent.finishAd(session.id, ad.rewardId, true),
    /Agent/,
  );
  const release = await repo.acquire(session.id);
  await assert.rejects(() => context.compact(session.id, ad.rewardId), {
    status: 409,
  });
  await release();
  assert.ok(
    !JSON.stringify(await repo.get("sessions", session.id)).includes(
      "secret-do-not-save",
    ),
  );

  // 不能再沿用旧的前 100 条查询，否则长对话会反复读取早期内容。
  const archive = await repo.create("sessions", { title: "分页测试" });
  for (let i = 0; i < 102; i++)
    await repo.create("greetings", {
      sessionId: archive.id,
      requestKey: randomUUID(),
      fingerprint: "test",
      mode: "external",
      status: "completed",
      input: { text: `记录${i}`, mediaIds: [] },
      greeting: "测试",
    });
  assert.equal((await restored.modelContext(archive.id)).previous.length, 102);
  assert.equal(
    (await new GreetingService(repo).history(archive.id)).length,
    102,
  );
  const fresh = new ContextService(
    repo,
    async () => "精简记忆",
    () => now,
  );
  const ticket = await fresh.startAd(archive.id);
  now += 16 * 60_000;
  await assert.rejects(
    () => fresh.finishAd(archive.id, ticket.rewardId, true),
    /过期/,
  );
}
