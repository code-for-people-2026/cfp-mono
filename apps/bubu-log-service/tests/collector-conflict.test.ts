import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/contracts";
import { IdentityService } from "../src/identity";
import { openStore } from "../src/store";
import { hash, recordCollections } from "../src/records/persistence";
import { RecordsService } from "../src/records/service";
import { recordSchema, updateSchema } from "../src/records/schemas";
import { AttachmentService } from "../src/records/attachments";
import type { LegacyActivity, LegacyRecordsBackend } from "../src/records/types";
import { CollectorService, type AgentPlan, type CollectorBatch, type CollectorJob } from "../src/collector/service";
import { CollectorRunner, McpToolError, preparePlanCall, type AgentTask } from "../src/collector/runner";
import { canonicalGroupId, type SourceMessage } from "../src/collector/types";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";

const cleaners: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleaners.splice(0).reverse()) await close(); });
class RecordsFixture implements LegacyRecordsBackend {
  activities = new Map<string, LegacyActivity>(); writes = 0; failWrites = false;
  async listActivities(babyId: string) { return [...this.activities.values()].filter(row => row.babyId === babyId); }
  async getActivity(babyId: string, id: string) { const row = this.activities.get(id); return row?.babyId === babyId ? row : null; }
  async writeActivity(_baby: string, id: string, desired: LegacyActivity | null) { this.writes++; if (this.failWrites) throw new Error("PROJECTION_UNAVAILABLE"); if (desired) this.activities.set(id, structuredClone(desired)); else this.activities.delete(id); return desired; }
  async saveDailyStats() {}
}
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-conflict-test-"));
  const previousPush = process.env.PAYLOAD_FORCE_DRIZZLE_PUSH;
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = "true";
  let store: Awaited<ReturnType<typeof openStore>>;
  try { store = await openStore({ directory, extensions: recordCollections }); }
  finally { if (previousPush === undefined) delete process.env.PAYLOAD_FORCE_DRIZZLE_PUSH; else process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = previousPush; }
  cleaners.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const legacy = new LegacyFixture(); const backend = new RecordsFixture(); let clock = Date.parse("2026-10-23T03:00:00Z");
  let identity = new IdentityService(store, legacy, new WechatFixture(), () => clock);
  let attachments = new AttachmentService(identity, { directory });
  let records = new RecordsService(identity, backend, (...args) => attachments.validateAttachment(...args));
  let collector = new CollectorService(identity, (...args) => records.verifyCollectorReceipt(...args));
  const operatorToken = (await identity.provisionOperator("operator", "baby-a", 3600_000)).token;
  const groupId = canonicalGroupId("synthetic-account", "synthetic-group@chatroom");
  await identity.bindGroup(await identity.authenticate(operatorToken, "bearer"), "baby-a", groupId, "collector-agent", true);
  let token = (await identity.issueAgent(await identity.authenticate(operatorToken, "bearer"), "baby-a", "collector", { groupId, agentId: "collector-agent" })).token;
  const operator = async () => identity.authenticate(operatorToken, "bearer");
  const configure = async (enabled = false) => (await collector.dispatch(await operator(), { action: "configure", babyId: "baby-a", accountId: "synthetic-account", chatId: "synthetic-group@chatroom", agentId: "collector-agent", enabled, intervalMs: 10_000 }) as { job: CollectorJob }).job;
  const job = await configure();
  const renew = async () => { token = (await identity.issueAgent(await operator(), "baby-a", "collector", { groupId, agentId: "collector-agent" })).token; };
  return {
    backend, job, groupId, configure, renew, operator, directory,
    get records() { return records; }, get collector() { return collector; },
    principal: () => identity.authenticate(token, "bearer"),
    human: async () => identity.authenticate((await identity.loginLegacy("old-alice", "correct-password", "native")).token),
    advance(ms: number) { clock += ms; },
    async restart() { await store.close(); store = await openStore({ directory, extensions: recordCollections }); identity = new IdentityService(store, legacy, new WechatFixture(), () => clock); attachments = new AttachmentService(identity, { directory }); records = new RecordsService(identity, backend, (...args) => attachments.validateAttachment(...args)); collector = new CollectorService(identity, (...args) => records.verifyCollectorReceipt(...args)); },
    async call(input: Record<string, unknown>) { return collector.dispatch(await identity.authenticate(token, "bearer"), { babyId: "baby-a", jobId: job.id, ...input }) as Promise<{ job: CollectorJob; batch: CollectorBatch; skipped?: boolean }>; },
    async activeBatch() { const status = await collector.dispatch(await identity.authenticate(token, "bearer"), { action: "status", babyId: "baby-a", jobId: job.id }) as { job: CollectorJob }; return identity.store.transaction(req => records.repo.get<CollectorBatch>("care-batches", "baby-a", status.job.activeBatchId!, req)); },
    async gateway() {
      const call = async (name: string, args: Record<string, unknown>) => {
        const principal = await identity.authenticate(token, "bearer");
        try {
          if (name === "bubu_collector") return await collector.dispatch(principal, args);
          if (name === "bubu_query_events") return await records.query(principal, args as never);
          if (name === "bubu_get_pending") return [...await records.pending(principal, String(args.babyId)), ...await collector.pendingMedia(principal, String(args.babyId))];
          if (name === "bubu_get_rules") return {};
          if (name === "bubu_record_events") return await records.record(principal, recordSchema.parse(args));
          if (name === "bubu_update_event") return await records.update(principal, updateSchema.parse(args));
          throw new Error("MCP_TOOL_UNSUPPORTED");
        } catch (error) {
          if (error instanceof AppError && /^[A-Z0-9_]{1,100}$/.test(error.code)) throw new McpToolError(name, error.code);
          throw error;
        }
      };
      return { call, tools: async () => ["bubu_record_events", "bubu_update_event", "bubu_answer_pending", "bubu_attach_images"].map(name => ({ name })) };
    },
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function source(): SourceMessage {
  const accountId = "synthetic-account"; const chatId = "synthetic-group@chatroom"; const databaseId = "message/message_0.db";
  const tableName = `Msg_${createHash("md5").update(chatId).digest("hex")}`;
  return { sourceId: `wechat:${hash(["wechat", accountId, databaseId, tableName, 1])}`, accountId, chatId, databaseId, tableName, localId: 1,
    groupId: canonicalGroupId(accountId, chatId), sentAt: "2026-10-23T00:00:01Z", senderId: "synthetic-sender", kind: "text", text: "奶粉泡好120ml，还不知道喝了多少", media: [] };
}
function page() { const message = source(); return { messages: [message], nextCursor: { [`${message.databaseId}:${message.tableName}`]: message.localId }, hasMore: false }; }
function plan(): AgentPlan { return { plans: [{ key: "feeding", sourceIds: [source().sourceId], tool: "bubu_record_events", arguments: { events: [{ facts: { type: "BOTTLE", startTime: source().sentAt, preparedMilkAmount: 120, milkSource: "FORMULA" }, progress: "unknown" }] } }], ignored: [] }; }
function updatePlan(eventId: string, expectedVersion: number, key = "edit"): AgentPlan["plans"][number] {
  return { key, sourceIds: [source().sourceId], tool: "bubu_update_event", arguments: { eventId, expectedVersion, patch: { facts: { milkAmount: expectedVersion === 1 ? 90 : 100 } } } };
}
async function stagedUpdate(f: Fixture, runId = "run-a") {
  await f.configure(true); const started = await f.call({ action: "begin", runId });
  const leased = { batchId: started.batch.id, runId };
  const staged = await f.call({ action: "stage", ...leased, page: page() });
  const created = await f.records.record(await f.principal(), recordSchema.parse(preparePlanCall(staged.batch, plan().plans[0]!).arguments));
  const event = created.events[0]!; const planned = updatePlan(event.id, event.version);
  const withPlan = await f.call({ action: "plan", ...leased, plan: { plans: [planned], ignored: [] } });
  return { leased, batch: withPlan.batch, event, planned };
}

describe("collector version-conflict recovery", () => {
  it("operator-authorizes one explicit replan after a human edit, then preserves human facts and advances", async () => {
    const f = await setup(); const { batch, event, planned } = await stagedUpdate(f);
    await f.records.update(await f.human(), { babyId: "baby-a", requestId: "human-edit", eventId: event.id, expectedVersion: event.version, patch: { facts: { preparedMilkAmount: 130, notes: "Caregiver corrected preparation" } } });
    f.advance(120_001); // the run-a lease must expire before the runner re-acquires the batch
    await expect(new CollectorRunner(await f.gateway(), { read: async () => page() }, { execute: vi.fn() }).once("baby-a", f.job.id)).rejects.toMatchObject({ mcpCode: "VERSION_CONFLICT" });
    const failed = await f.activeBatch();
    expect(failed?.failure?.code).toBe("VERSION_CONFLICT"); expect(failed?.recovery).toEqual({ edit: { detectedAt: expect.any(String) } });
    await f.restart(); await f.renew();
    // A server-verified conflict authorizes the operator replan immediately; restart preserves it.
    await f.collector.dispatch(await f.operator(), { action: "retry", babyId: "baby-a", jobId: f.job.id, replan: true });
    const agent = vi.fn(async (task: AgentTask) => {
      const existing = task.existingEvents as { events?: Array<{ version?: number; facts?: { notes?: string } }> };
      expect(task.recovery?.plans).toEqual([planned]); expect(task.messages).toEqual([source()]);
      expect(existing.events?.find(item => item.version === 2)?.facts?.notes).toBe("Caregiver corrected preparation");
      return { plans: [updatePlan(event.id, 2, "edit-after-human")], ignored: [] };
    });
    expect(await new CollectorRunner(await f.gateway(), { read: async () => page() }, { execute: agent }).once("baby-a", f.job.id)).toMatchObject({ completed: true, batchId: batch.id });
    const latest = (await f.records.query(await f.principal(), { babyId: "baby-a", eventId: event.id })).events[0]!;
    expect(latest).toMatchObject({ version: 3, facts: { preparedMilkAmount: 130, notes: "Caregiver corrected preparation", milkAmount: 100 } });
    const status = await f.call({ action: "status" });
    expect(status.job).toMatchObject({ cursor: page().nextCursor, processedThrough: source().sentAt });
    expect(status.job.activeBatchId).toBeUndefined();
  }, 30_000);

  it("rejects duplicate keys across authorized replan replacements while preserving the original plans", async () => {
    const f = await setup(); await f.configure(true);
    const started = await f.call({ action: "begin", runId: "run-a" });
    const leased = { batchId: started.batch.id, runId: "run-a" };
    const staged = await f.call({ action: "stage", ...leased, page: page() });
    const created = await f.records.record(await f.principal(), recordSchema.parse(preparePlanCall(staged.batch, plan().plans[0]!).arguments));
    const event = created.events[0]!;
    const editA = updatePlan(event.id, event.version, "edit-a");
    const editB = updatePlan(event.id, event.version, "edit-b");
    await f.call({ action: "plan", ...leased, plan: { plans: [editA, editB], ignored: [] } });
    await f.records.update(await f.human(), { babyId: "baby-a", requestId: "human-edit", eventId: event.id, expectedVersion: event.version, patch: { facts: { notes: "Caregiver edit" } } });
    await f.call({ action: "fail", ...leased, code: "VERSION_CONFLICT", conflictPlanKey: editA.key });
    await f.collector.dispatch(await f.operator(), { action: "retry", babyId: "baby-a", jobId: f.job.id });
    const resumed = await f.call({ action: "begin", runId: "run-b" });
    const retryLeased = { batchId: resumed.batch.id, runId: "run-b" };
    await f.call({ action: "fail", ...retryLeased, code: "VERSION_CONFLICT", conflictPlanKey: editB.key });
    await f.collector.dispatch(await f.operator(), { action: "retry", babyId: "baby-a", jobId: f.job.id, replan: true });
    const authorized = await f.call({ action: "begin", runId: "run-c" });
    const replanLeased = { batchId: authorized.batch.id, runId: "run-c" };
    const duplicate = updatePlan(event.id, event.version + 1, "duplicate");
    await expect(f.call({ action: "replan", ...replanLeased, replacements: [
      { oldPlanKey: editA.key, plan: duplicate },
      { oldPlanKey: editB.key, plan: structuredClone(duplicate) },
    ] })).rejects.toMatchObject({ code: "COLLECTOR_REPLPLAN_MISMATCH" });
    let active = await f.activeBatch();
    expect(active?.plan?.plans.map(item => item.key)).toEqual([editA.key, editB.key]);
    expect(active?.usedPlanKeys).toEqual([editA.key, editB.key]);
    expect(active?.recovery?.[editA.key]).toMatchObject({ authorizedAt: expect.any(String) });
    expect(active?.recovery?.[editB.key]).toMatchObject({ authorizedAt: expect.any(String) });

    await f.call({ action: "replan", ...replanLeased, replacements: [
      { oldPlanKey: editA.key, plan: updatePlan(event.id, event.version + 1, "edit-a-after-human") },
      { oldPlanKey: editB.key, plan: updatePlan(event.id, event.version + 1, "edit-b-after-human") },
    ] });
    active = await f.activeBatch();
    expect(active?.plan?.plans.map(item => item.key)).toEqual(["edit-a-after-human", "edit-b-after-human"]);
    expect(active?.usedPlanKeys).toEqual([editA.key, editB.key, "edit-a-after-human", "edit-b-after-human"]);
  }, 30_000);

  it("keeps committed operations out of recovery and resumes a lost receipt without another write", async () => {
    const f = await setup(); const { leased, batch, planned } = await stagedUpdate(f);
    const call = preparePlanCall(batch, planned);
    // The sibling write committed, but its receipt response was lost before the server saw it.
    await f.records.update(await f.principal(), updateSchema.parse(call.arguments));
    const writes = f.backend.writes;
    const failed = (await f.call({ action: "fail", ...leased, code: "VERSION_CONFLICT", conflictPlanKey: planned.key })).batch;
    expect(failed.failure?.code).toBe("COLLECTOR_CONFLICT_UNVERIFIED"); expect(failed.recovery).toBeUndefined();
    await f.restart(); f.advance(120_001); await f.renew();
    await f.records.update(await f.principal(), updateSchema.parse(call.arguments));
    expect(f.backend.writes).toBe(writes);
    await f.call({ action: "begin", runId: "run-b" });
    await f.call({ action: "receipt", batchId: batch.id, runId: "run-b", planKey: planned.key, requestId: call.arguments.requestId });
    await f.call({ action: "finish", batchId: batch.id, runId: "run-b" });
    expect((await f.call({ action: "status" })).job.lastSuccessAt).toBeTruthy();
    expect((await f.records.query(await f.principal(), { babyId: "baby-a" })).events).toHaveLength(1);
  });

  it("rejects a durable pending operation, an unauthorized or active-lease retry, and malicious mapping targets or keys", async () => {
    const f = await setup(); const { leased, batch, planned } = await stagedUpdate(f);
    const call = preparePlanCall(batch, planned);
    // A genuinely durable pending operation: the projection failed before writing the legacy fact.
    f.backend.failWrites = true;
    const stalled = await f.records.update(await f.principal(), updateSchema.parse(call.arguments));
    f.backend.failWrites = false;
    expect(stalled.status).toBe("pending_projection");
    const failed = (await f.call({ action: "fail", ...leased, code: "VERSION_CONFLICT", conflictPlanKey: planned.key })).batch;
    expect(failed.failure?.code).toBe("COLLECTOR_CONFLICT_UNVERIFIED"); expect(failed.recovery).toBeUndefined();
    await expect(f.collector.dispatch(await f.principal(), { action: "retry", babyId: "baby-a", jobId: f.job.id, replan: true })).rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
    f.advance(1); await expect(f.collector.dispatch(await f.operator(), { action: "retry", babyId: "baby-a", jobId: f.job.id, replan: true })).rejects.toMatchObject({ code: "COLLECTOR_RECOVERY_NOT_AUTHORIZED" });

    const active = await setup(); await active.configure(true);
    await active.call({ action: "begin", runId: "active" });
    await expect(active.collector.dispatch(await active.operator(), { action: "retry", babyId: "baby-a", jobId: active.job.id, replan: true })).rejects.toMatchObject({ code: "COLLECTOR_LEASE_ACTIVE" });

    const malicious = await setup(); const conflict = await stagedUpdate(malicious, "run-map");
    await malicious.records.update(await malicious.human(), { babyId: "baby-a", requestId: "human-map-edit", eventId: conflict.event.id, expectedVersion: conflict.event.version, patch: { facts: { notes: "Human target edit" } } });
    await malicious.call({ action: "fail", ...conflict.leased, code: "VERSION_CONFLICT", conflictPlanKey: conflict.planned.key });
    await malicious.collector.dispatch(await malicious.operator(), { action: "retry", babyId: "baby-a", jobId: malicious.job.id, replan: true });
    const resumed = await malicious.call({ action: "begin", runId: "run-map-2" }); const mapLeased = { batchId: resumed.batch.id, runId: "run-map-2" };
    await expect(malicious.call({ action: "replan", ...mapLeased, replacements: [{ oldPlanKey: "edit", plan: updatePlan(conflict.event.id, 2, "edit") }] })).rejects.toMatchObject({ code: "COLLECTOR_REPLPLAN_MISMATCH" });
    const other = await malicious.records.record(await malicious.human(), { babyId: "baby-a", requestId: "human-other-event", events: [{ facts: { type: "DIAPER", startTime: source().sentAt, hasPoop: true } }] });
    await expect(malicious.call({ action: "replan", ...mapLeased, replacements: [{ oldPlanKey: "edit", plan: updatePlan(other.events[0]!.id, 2, "edit-other-target") }] })).rejects.toMatchObject({ code: "COLLECTOR_REPLPLAN_MISMATCH" });
  }, 30_000);
});
