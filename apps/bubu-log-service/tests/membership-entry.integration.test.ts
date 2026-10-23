import { createHash } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, permissions } from "../src/contracts";
import { createHandler } from "../src/http";
import { ChatRepository, chatCollections } from "../src/chat/persistence";
import { ChatService } from "../src/chat/service";
import type { ChatInput, ChatProvider } from "../src/chat/contracts";
import { ChatMcpClient } from "../src/chat/mcp";
import { CollectorMcpClient, CollectorRunner, type McpGateway } from "../src/collector/runner";
import type { CollectorBatch, CollectorJob, AgentPlan } from "../src/collector/service";
import { canonicalGroupId, type SourceMessage } from "../src/collector/types";
import { hash } from "../src/records/persistence";
import { MembershipService } from "../src/membership/service";
import { membershipCollections } from "../src/membership/persistence";
import type { MembershipCommand } from "../src/membership/contracts";
import { operationsCollections, bootstrapOpsAdmin } from "../src/operations/collections";
import { readOpsUser, requireBaby } from "../src/operations/access";
import { chatFixture } from "./fixtures/chat";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const babyId = "baby-a";
const facts = { type: "ROLL_OVER" as const, startTime: "2026-10-23T03:00:00Z", count: 2 };
const message = (requestId: string): ChatInput => ({ babyId, requestId, text: "宝宝刚翻身两次", attachmentIds: [], context: { viewedDate: "2026-10-23" } });

/** Real entitlement persistence, operator account, HTTP and MCP; only old business/model boundaries are synthetic. */
async function setup(provider: ChatProvider = { complete: async () => ({ text: "已了解。", calls: [] }) }, requestFetch?: typeof fetch) {
  const f = await chatFixture([...chatCollections, ...membershipCollections, ...operationsCollections]);
  cleanups.push(() => f.close());
  const admin = await bootstrapOpsAdmin(f.store.payload, { email: "entry-tests@synthetic.invalid", password: "Synthetic-Password-Only-2026", babyIds: [babyId] });
  let membership: MembershipService, chat: ChatService;
  const install = async () => {
    membership = new MembershipService(f.identity);
    f.identity.setServiceGuard((...args) => membership.requireAvailable(...args));
    f.identity.setOperatorGuard(async (id, baby, permission) => requireBaby(await readOpsUser(f.store.payload, { id, collection: "ops-users" }), baby, !permission.endsWith(":read")));
    await f.listen();
    chat = new ChatService(f.identity, f.attachments, { mcpUrl: `${f.origin}/api/mcp`, provider, fetch: requestFetch });
    f.setHandler(createHandler(f.identity, f.origin, { allowedOrigins: [] }, { records: f.records, collector: f.collector, attachments: f.attachments, chat }));
  };
  await install();
  const authority = await f.identity.provisionOperator("membership-entry-tests", babyId, 3_600_000, { userId: String(admin.id), permissions });
  const operator = await f.identity.authenticate(authority.token, "bearer");
  let sequence = 0;
  const configure = async (input: Omit<MembershipCommand, "expectedVersion"> & Partial<MembershipCommand>) => {
    const previous = await membership.status(f.alice, babyId);
    return membership.execute(operator, babyId, `membership-entry-${++sequence}`, { ...input, expectedVersion: previous.version }, "隔离示例服务权益操作");
  };
  return { f, operator, configure, get membership() { return membership; }, get chat() { return chat; },
    async restart() { await chat.close(); await f.restart(); await install(); },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function collector(s: Setup) {
  const accountId = "synthetic-account", chatId = "entry-group@chatroom", agentId = "entry-collector";
  const groupId = canonicalGroupId(accountId, chatId);
  await s.f.identity.bindGroup(s.f.operator, babyId, groupId, agentId, true);
  const token = (await s.f.identity.issueAgent(s.f.operator, babyId, "collector", { groupId, agentId })).token;
  const job = (await s.f.collector.dispatch(s.f.operator, { action: "configure", babyId, accountId, chatId, agentId, enabled: true, intervalMs: 10_000 }) as { job: CollectorJob }).job;
  const databaseId = "message/message_0.db", tableName = `Msg_${createHash("md5").update(chatId).digest("hex")}`;
  const source: SourceMessage = { accountId, chatId, groupId, databaseId, tableName, sourceId: `wechat:${hash(["wechat", accountId, databaseId, tableName, 1])}`, localId: 1, sentAt: facts.startTime, senderId: "example-caregiver", kind: "text", text: "宝宝刚翻身两次", media: [] };
  const page = { messages: [source], nextCursor: { [`${databaseId}:${tableName}`]: 1 }, hasMore: false };
  const plan: AgentPlan = { plans: [{ key: "roll", sourceIds: [source.sourceId], tool: "bubu_record_events", arguments: { events: [{ facts }] } }], ignored: [] };
  const connect = async () => { const client = new CollectorMcpClient(new URL(`${s.f.origin}/api/mcp`), async () => token); await client.connect(); return client; };
  return { token, job, page, plan, connect };
}

describe("one entitlement policy protects every service entry and preserves recovery", () => {
  it("returns recoverable HTTP/MCP 423 while authorized history and existing photos stay readable", async () => {
    const s = await setup();
    const recorded = await s.f.records.record(s.f.alice, { babyId, requestId: "before-pause", events: [{ facts }] });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const attachment = await s.f.attachments.upload(s.f.alice, babyId, bytes, "image/png", "before-pause-photo");
    await s.configure({ action: "pause" });
    const response = await fetch(`${s.f.origin}/api/app/chat`, { method: "POST", headers: { Authorization: `Bearer ${s.f.aliceToken}`, "Content-Type": "application/json" }, body: JSON.stringify(message("during-pause")) });
    expect(response.status).toBe(423); expect(await response.json()).toMatchObject({ code: "SERVICE_PAUSED", retryable: true });
    await expect(s.f.attachments.upload(s.f.alice, babyId, bytes, "image/png", "during-pause-photo")).rejects.toMatchObject({ status: 423, retryable: true });
    expect((await s.f.attachments.read(s.f.alice, babyId, attachment.id)).bytes).toEqual(bytes);
    expect((await s.f.records.query(s.f.alice, { babyId })).events[0]?.id).toBe(recorded.events[0]?.id);
    expect((await s.chat.history(s.f.alice, babyId)).turns).toEqual([]);
    const mcp = new ChatMcpClient(`${s.f.origin}/api/mcp`, s.f.aliceToken); await mcp.connect();
    try { await expect(mcp.call("bubu_record_events", { babyId, requestId: "paused-mcp", events: [{ facts }] })).rejects.toMatchObject({ status: 423, code: "SERVICE_PAUSED", retryable: true }); }
    finally { await mcp.close(); }
    await expect(s.f.collector.resolveMedia(s.f.alice, { babyId, requestId: "paused-human-photo", pendingId: "media:missing", eventId: recorded.events[0]!.id, expectedVersion: 1, resolution: "unknown" })).rejects.toMatchObject({ status: 423 });
    await s.configure({ action: "resume" });
    expect((await s.chat.send(s.f.alice, message("during-pause"))).status).toBe("completed");
  }, 30_000);

  it("fails closed when reading service state fails without blocking stored history", async () => {
    const s = await setup();
    vi.spyOn(s.membership.repo, "state").mockRejectedValue(new Error("isolated read fault"));
    await expect(s.chat.submit(s.f.alice, message("state-read-failed"))).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_UNAVAILABLE", retryable: true });
    expect((await s.f.records.query(s.f.alice, { babyId })).events).toEqual([]);
    expect((await s.chat.history(s.f.alice, babyId)).turns).toEqual([]);
  }, 30_000);

  it("commits a projected checkpoint at explicit expiry and resumes the same request after database reopen", async () => {
    const s = await setup();
    await s.configure({ action: "configure", startsAt: null, endsAt: "2026-10-23T12:00:00.001Z", expiryPolicy: { chat: "pause", collection: "pause" } });
    const write = s.f.legacy.writeActivity.bind(s.f.legacy);
    vi.spyOn(s.f.legacy, "writeActivity").mockImplementation(async (...args) => { const result = await write(...args); s.f.advance(2); return result; });
    const input = { babyId, requestId: "expires-between-facts", events: [{ facts }, { facts: { ...facts, startTime: "2026-10-23T06:00:00Z" } }] };
    await expect(s.f.records.record(s.f.alice, input)).rejects.toMatchObject({ status: 423, code: "SERVICE_EXPIRED", retryable: true });
    expect(s.f.legacy.committedWrites).toBe(1);
    const pending = await s.f.records.getRequest(s.f.alice, { babyId, requestId: input.requestId });
    expect(pending.status).toBe("pending_projection"); expect(pending.events.map(event => event.projection)).toEqual(["synced", "pending"]);
    await s.restart();
    await s.configure({ action: "extend", endsAt: "2026-10-24T12:00:00Z" });
    const resumed = await s.f.records.getRequest(s.f.alice, { babyId, requestId: input.requestId, retry: true });
    expect(resumed.status).toBe("saved"); expect(s.f.legacy.committedWrites).toBe(2); expect(s.f.legacy.writes).toHaveLength(2);
  }, 30_000);

  it("rechecks every collector advance boundary while retaining its batch, plan, and committed facts", async () => {
    const s = await setup(), c = await collector(s), principal = await s.f.identity.authenticate(c.token);
    const started = await s.f.collector.dispatch(principal, { action: "begin", babyId, jobId: c.job.id, runId: "run-before-pause" }) as { batch: CollectorBatch };
    const leased = { babyId, jobId: c.job.id, batchId: started.batch.id, runId: "run-before-pause" };
    await s.configure({ action: "pause" });
    for (const command of [
      { action: "stage", page: c.page }, { action: "media", resolutions: [] }, { action: "plan", plan: c.plan },
      { action: "receipt", planKey: "roll", requestId: "uncommitted" }, { action: "finish" }, { action: "heartbeat" },
    ]) await expect(s.f.collector.dispatch(principal, { ...leased, ...command })).rejects.toMatchObject({ status: 423, code: "SERVICE_PAUSED", retryable: true });
    await s.f.collector.dispatch(principal, { action: "fail", ...leased, code: "SERVICE_PAUSED" });
    const status = await s.f.collector.dispatch(principal, { action: "status", babyId, jobId: c.job.id }) as { job: CollectorJob };
    expect(status.job.cursor).toEqual({}); expect(status.job.activeBatchId).toBe(started.batch.id); expect(status.job.failure?.code).toBe("SERVICE_PAUSED");
  }, 30_000);

  it("collector resumes after the record commit but before its receipt without re-reading sources or writing another fact", async () => {
    const s = await setup(), c = await collector(s);
    let client = await c.connect(), paused = false, reads = 0, plans = 0;
    const gateway: McpGateway = { tools: () => client.tools(), call: async (name, args) => {
      const result = await client.call(name, args);
      if (name === "bubu_record_events" && !paused) { paused = true; await s.configure({ action: "pause" }); }
      return result;
    } };
    const runner = () => new CollectorRunner(gateway, { read: async () => { reads++; return c.page; } }, { execute: async () => { plans++; return c.plan; } });
    try {
      await expect(runner().once(babyId, c.job.id)).rejects.toMatchObject({ status: 423, code: "SERVICE_PAUSED", retryable: true });
      expect(s.f.legacy.committedWrites).toBe(1);
      await client.close(); await s.restart(); client = await c.connect();
      await s.configure({ action: "resume" });
      await s.f.collector.dispatch(s.f.operator, { action: "retry", babyId, jobId: c.job.id });
      expect(await runner().once(babyId, c.job.id)).toMatchObject({ completed: true });
      expect(reads).toBe(1); expect(plans).toBe(1); expect(s.f.legacy.committedWrites).toBe(1);
      const status = await client.call("bubu_collector", { action: "status", babyId, jobId: c.job.id }) as { job: CollectorJob };
      expect(status.job.cursor).toEqual(c.page.nextCursor);
    } finally { await client.close(); }
  }, 30_000);

  it("keeps a chat turn recoverable when service pauses after MCP commits and resumes it after reopen", async () => {
    let paused = false, modelCalls = 0;
    const provider: ChatProvider = { complete: async () => ++modelCalls === 1 ? { text: "", calls: [{ id: "record-before-pause", name: "bubu_record_events", arguments: { events: [{ facts }] } }] } : { text: "完成", calls: [] } };
    const intercepted: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (!paused && typeof init?.body === "string" && init.body.includes('"name":"bubu_record_events"')) { paused = true; await s.configure({ action: "pause" }); }
      return response;
    };
    const s = await setup(provider, intercepted);
    const input = message("chat-commit-before-pause"), stopped = await s.chat.send(s.f.alice, input);
    expect(stopped).toMatchObject({ status: "needs_recovery", error: { code: "SERVICE_PAUSED", retryable: true } });
    expect(s.f.legacy.committedWrites).toBe(1); expect((await s.chat.history(s.f.alice, babyId)).turns[0]?.id).toBe(stopped.id);
    await s.restart(); await s.configure({ action: "resume" });
    const completed = await s.chat.send(s.f.alice, input);
    expect(completed.status).toBe("completed"); expect(completed.id).toBe(stopped.id); expect(s.f.legacy.committedWrites).toBe(1);
    expect(s.f.mcpRequests.some(request => request.name === "bubu_get_request")).toBe(true);
  }, 30_000);

  it.each(["reply", "image-ambiguity", "conflict"] as const)("does not publish %s when an operator pause commits before the completion transaction", async kind => {
    let modelCalls = 0, pendingReads = 0, pauseAfterCheck = false, completedWrites = 0;
    const provider: ChatProvider = { complete: async () => {
      modelCalls++;
      return kind === "conflict" && modelCalls === 1
        ? { text: "", calls: [{ id: "conflicting-record", name: "bubu_record_events", arguments: { events: [{ facts }] } }] }
        : { text: "这是一条等待发布的示例回复。", calls: [] };
    } };
    const requestFetch: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (typeof init?.body === "string" && init.body.includes('"name":"bubu_get_pending"') && ++pendingReads === 2) pauseAfterCheck = true;
      return response;
    };
    const s = await setup(provider, requestFetch);
    if (kind === "conflict") vi.spyOn(s.f.legacy, "writeActivity").mockRejectedValueOnce(new AppError(409, "LEGACY_VERSION_CONFLICT", "隔离示例旧库冲突"));
    // A separate operator request must queue behind the current transaction, not
    // re-enter its AsyncLocalStorage context. This fixes the ordering without timers.
    const operatorRequest = new AsyncResource("membership-publication-test");
    cleanups.push(async () => { operatorRequest.emitDestroy(); });
    let paused: Promise<unknown> | undefined;
    const enqueuePause = () => {
      paused ??= operatorRequest.runInAsyncScope(() => s.membership.execute(s.operator, babyId, `pause-before-${kind}`, { action: "pause", expectedVersion: 0 }, "隔离示例发布前暂停"));
      void paused.catch(() => undefined);
    };
    const check = s.membership.requireAvailable.bind(s.membership);
    vi.spyOn(s.membership, "requireAvailable").mockImplementation(async (...args) => {
      await check(...args);
      if (kind !== "image-ambiguity" && pauseAfterCheck) { pauseAfterCheck = false; enqueuePause(); }
    });
    const put = ChatRepository.prototype.put;
    vi.spyOn(ChatRepository.prototype, "put").mockImplementation(async function (this: ChatRepository, turn, req) {
      await put.call(this, turn, req);
      if (turn.status === "completed") completedWrites++;
      if (kind === "image-ambiguity" && turn.status === "processing" && turn.modelContext?.imageAmbiguity) enqueuePause();
    });
    const input = { ...message(`publication-before-${kind}`), ...(kind === "image-ambiguity" ? { text: "上一张图片是什么颜色" } : {}) };
    const stopped = await s.chat.send(s.f.alice, input);
    await paused;
    expect((await s.membership.status(s.f.alice, babyId)).status).toBe("paused");
    expect(stopped).toMatchObject({ status: "needs_recovery", error: { code: "SERVICE_PAUSED", retryable: true } });
    expect(completedWrites).toBe(0);
    expect((await s.chat.request(s.f.alice, babyId, input.requestId))?.status).toBe("needs_recovery");
    await s.configure({ action: "resume" });
    const completed = await s.chat.send(s.f.alice, input);
    expect(completed.status).toBe("completed"); expect(completed.id).toBe(stopped.id); expect(completedWrites).toBe(1);
    expect(modelCalls).toBe(kind === "image-ambiguity" ? 0 : 2);
  }, 30_000);

  it("keeps a committed completion as history when a queued operator pause runs immediately afterward", async () => {
    let modelCalls = 0;
    const s = await setup({ complete: async () => ++modelCalls === 1
      ? { text: "", calls: [{ id: "record-before-completion", name: "bubu_record_events", arguments: { events: [{ facts }] } }] }
      : { text: "照护结果已确认。", calls: [] } });
    const operatorRequest = new AsyncResource("membership-after-publication-test");
    cleanups.push(async () => { operatorRequest.emitDestroy(); });
    let paused: Promise<unknown> | undefined;
    const put = ChatRepository.prototype.put;
    vi.spyOn(ChatRepository.prototype, "put").mockImplementation(async function (this: ChatRepository, turn, req) {
      await put.call(this, turn, req);
      if (turn.status === "completed" && !paused) {
        paused = operatorRequest.runInAsyncScope(() => s.membership.execute(s.operator, babyId, "pause-after-completion", { action: "pause", expectedVersion: 0 }, "隔离示例发布后暂停"));
        void paused.catch(() => undefined);
      }
    });
    const input = message("publication-completed-before-pause"), completed = await s.chat.send(s.f.alice, input);
    await paused;
    expect((await s.membership.status(s.f.alice, babyId)).status).toBe("paused");
    expect(completed.status).toBe("completed"); expect(completed.error).toBeUndefined();
    expect((await s.chat.history(s.f.alice, babyId)).turns[0]).toMatchObject({ id: completed.id, status: "completed" });
    expect(await s.chat.send(s.f.alice, input)).toMatchObject({ id: completed.id, status: "completed" });
    expect(modelCalls).toBe(2); expect(s.f.legacy.committedWrites).toBe(1);
    expect(s.f.mcpRequests.filter(request => request.name === "bubu_record_events")).toHaveLength(1);
  }, 30_000);
});
