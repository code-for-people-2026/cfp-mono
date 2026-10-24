import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { IdentityService } from "../src/identity";
import { openStore } from "../src/store";
import { recordCollections, hash } from "../src/records/persistence";
import { RecordsService } from "../src/records/service";
import { recordSchema } from "../src/records/schemas";
import { createHandler } from "../src/http";
import { AttachmentService } from "../src/records/attachments";
import type { LegacyActivity, LegacyRecordsBackend } from "../src/records/types";
import { CollectorService, collectorRequestId, type CollectorJob, type CollectorBatch, type AgentPlan } from "../src/collector/service";
import { CollectorMcpClient, CollectorRunner, preparePlanCall, scheduleCollector, CommandAgentExecutor } from "../src/collector/runner";
import { canonicalGroupId, type SourceMessage } from "../src/collector/types";
import { ExactLocalMediaResolver } from "../src/collector/media";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";

const cleaners: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleaners.splice(0).reverse()) await close(); });
class RecordsFixture implements LegacyRecordsBackend {
  activities = new Map<string, LegacyActivity>();
  writes = 0;
  async listActivities(babyId: string) { return [...this.activities.values()].filter(row => row.babyId === babyId); }
  async getActivity(babyId: string, id: string) { const row = this.activities.get(id); return row?.babyId === babyId ? row : null; }
  async writeActivity(_baby: string, id: string, desired: LegacyActivity | null) { this.writes++; if (desired) this.activities.set(id, structuredClone(desired)); else this.activities.delete(id); return desired; }
  async saveDailyStats() {}
}
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-collector-test-"));
  // Payload's development push cache is process-global, even across different
  // databases. Every isolated fixture needs its own schema, not a cached claim.
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
  const operator = await identity.authenticate(operatorToken, "bearer");
  const groupId = canonicalGroupId("synthetic-account", "synthetic-group@chatroom");
  await identity.bindGroup(operator, "baby-a", groupId, "collector-agent", true);
  let token = (await identity.issueAgent(operator, "baby-a", "collector", { groupId, agentId: "collector-agent" })).token;
  const configure = async (enabled = false) => (await collector.dispatch(operator, { action: "configure", babyId: "baby-a", accountId: "synthetic-account", chatId: "synthetic-group@chatroom", agentId: "collector-agent", enabled, intervalMs: 10_000 }) as { job: CollectorJob }).job;
  const job = await configure();
  return {
    get store() { return store; }, get identity() { return identity; }, get records() { return records; }, get collector() { return collector; }, get attachments() { return attachments; },
    backend, operator, operatorToken, job, groupId, configure, directory,
    get token() { return token; }, set token(value: string) { token = value; },
    principal: () => identity.authenticate(token, "bearer"),
    advance(ms: number) { clock += ms; },
    async restart() { await store.close(); store = await openStore({ directory, extensions: recordCollections }); identity = new IdentityService(store, legacy, new WechatFixture(), () => clock); attachments = new AttachmentService(identity, { directory }); records = new RecordsService(identity, backend, (...args) => attachments.validateAttachment(...args)); collector = new CollectorService(identity, (...args) => records.verifyCollectorReceipt(...args)); },
    async call(input: Record<string, unknown>) { return collector.dispatch(await identity.authenticate(token, "bearer"), { babyId: "baby-a", jobId: job.id, ...input }) as Promise<{ job: CollectorJob; batch: CollectorBatch; skipped?: boolean }> },
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function source(localId = 1): SourceMessage {
  const accountId = "synthetic-account"; const chatId = "synthetic-group@chatroom"; const databaseId = "message/message_0.db";
  const tableName = `Msg_${createHash("md5").update(chatId).digest("hex")}`;
  return { sourceId: `wechat:${hash(["wechat", accountId, databaseId, tableName, localId])}`, accountId, chatId, databaseId, tableName, localId,
    groupId: canonicalGroupId(accountId, chatId), sentAt: `2026-10-23T00:00:0${localId}Z`, senderId: "synthetic-sender", kind: "text", text: "奶粉泡好120ml，还不知道喝了多少", media: [] };
}
function page(message = source()) { return { messages: [message], nextCursor: { [`${message.databaseId}:${message.tableName}`]: message.localId }, hasMore: false }; }
function plan(message = source()): AgentPlan { return { plans: [{ key: "feeding", sourceIds: [message.sourceId], tool: "bubu_record_events", arguments: { events: [{ facts: { type: "BOTTLE", startTime: message.sentAt, preparedMilkAmount: 120, milkSource: "FORMULA" }, progress: "unknown" }] } }], ignored: [] }; }
async function staged(f: Fixture, runId = "run-a") {
  await f.configure(true);
  const started = await f.call({ action: "begin", runId });
  const leased = { batchId: started.batch.id, runId };
  const staged = await f.call({ action: "stage", ...leased, page: page() });
  return { ...staged, leased };
}

describe("durable controlled collection", () => {
  it("defaults disabled and enforces the same baby's active group and Agent", async () => {
    const f = await setup();
    expect(await f.call({ action: "begin", runId: "run-a" })).toMatchObject({ skipped: true, reason: "disabled" });
    const caregiverToken = (await f.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    await expect(f.collector.dispatch(await f.identity.authenticate(caregiverToken), { action: "status", babyId: "baby-a" })).rejects.toMatchObject({ status: 403 });
    await f.configure(true);
    await expect(f.collector.dispatch(await f.principal(), { action: "status", babyId: "baby-b" })).rejects.toMatchObject({ status: 403 });
    await f.identity.bindGroup(f.operator, "baby-a", f.groupId, "collector-agent", false);
    await expect(f.call({ action: "begin", runId: "run-a" })).rejects.toMatchObject({ status: 403 });
  });

  it("persists source identity/media and never advances the cursor before a real record receipt", async () => {
    const f = await setup(); const { leased, batch } = await staged(f);
    await f.call({ action: "plan", ...leased, plan: plan() });
    const requestId = collectorRequestId(batch.id, "feeding");
    await expect(f.call({ action: "receipt", ...leased, planKey: "feeding", requestId })).rejects.toMatchObject({ code: "COLLECTOR_WRITE_NOT_COMMITTED" });
    await expect(f.call({ action: "finish", ...leased })).rejects.toMatchObject({ code: "COLLECTOR_UNPROCESSED_MESSAGES" });
    expect((await f.call({ action: "status" })).job.cursor).toEqual({});
    const call = preparePlanCall(batch, plan().plans[0]!);
    await f.records.record(await f.principal(), recordSchema.parse(call.arguments));
    await f.call({ action: "receipt", ...leased, planKey: "feeding", requestId });
    await f.call({ action: "finish", ...leased });
    expect((await f.call({ action: "status" })).job).toMatchObject({ cursor: page().nextCursor, processedThrough: source().sentAt });
    const pending = await f.records.pending(await f.principal(), "baby-a");
    expect(pending.some(question => question.fields.includes("milkAmount"))).toBe(true);
    expect([...f.backend.activities.values()][0]?.milkAmount).toBeUndefined();
  });

  it("recovers committed writes after restart/response loss with the same operation and a renewed credential", async () => {
    const f = await setup(); const { leased, batch } = await staged(f);
    await f.call({ action: "plan", ...leased, plan: plan() });
    const call = preparePlanCall(batch, plan().plans[0]!);
    await f.records.record(await f.principal(), recordSchema.parse(call.arguments));
    const writes = f.backend.writes;
    await f.restart(); f.advance(120_001);
    f.token = (await f.identity.issueAgent(f.operator, "baby-a", "collector", { groupId: f.groupId, agentId: "collector-agent" })).token;
    const resumed = await f.call({ action: "begin", runId: "run-resumed" });
    expect(resumed.batch.id).toBe(batch.id); expect(resumed.batch.plan).toEqual(plan());
    await f.records.record(await f.principal(), recordSchema.parse(preparePlanCall(resumed.batch, resumed.batch.plan!.plans[0]!).arguments));
    expect(f.backend.writes).toBe(writes);
    await f.call({ action: "receipt", batchId: batch.id, runId: "run-resumed", planKey: "feeding", requestId: call.arguments.requestId });
    await f.call({ action: "finish", batchId: batch.id, runId: "run-resumed" });
    expect((await f.call({ action: "status" })).job.lastSuccessAt).toBeTruthy();
  });

  it("rejects simultaneous leases, forged messages, changing plans and incomplete coverage", async () => {
    const f = await setup(); const { leased } = await staged(f);
    await expect(f.call({ action: "begin", runId: "other-run" })).rejects.toMatchObject({ code: "COLLECTOR_BUSY" });
    await expect(f.call({ action: "plan", ...leased, plan: { plans: [], ignored: [] } })).rejects.toMatchObject({ code: "COLLECTOR_UNPROCESSED_MESSAGES" });
    await f.call({ action: "plan", ...leased, plan: plan() });
    await expect(f.call({ action: "plan", ...leased, plan: { plans: [], ignored: [{ sourceId: source().sourceId, reason: "changed mind" }] } })).rejects.toMatchObject({ code: "COLLECTOR_PLAN_IMMUTABLE" });
    f.advance(120_001);
    await expect(f.call({ action: "heartbeat", ...leased })).rejects.toMatchObject({ code: "COLLECTOR_LEASE_LOST" });
  });

  it("keeps failure/backfill cursors durable and skips already processed messages on replay", async () => {
    const f = await setup(); const { leased, batch } = await staged(f);
    await f.call({ action: "plan", ...leased, plan: { plans: [], ignored: [{ sourceId: source().sourceId, reason: "Synthetic non-care fixture" }] } });
    await f.call({ action: "fail", ...leased, code: "SOURCE_READ_FAILED" });
    await f.restart();
    expect((await f.call({ action: "status" })).job.failure).toMatchObject({ code: "SOURCE_READ_FAILED", attempts: 1 });
    expect(await f.call({ action: "begin", runId: "retry" })).toMatchObject({ skipped: true, reason: "not_due" });
    await f.collector.dispatch(f.operator, { action: "retry", babyId: "baby-a", jobId: f.job.id });
    await f.call({ action: "begin", runId: "retry" });
    await f.call({ action: "finish", batchId: batch.id, runId: "retry" });
    const committedCursor = (await f.call({ action: "status" })).job.cursor;
    await f.collector.dispatch(f.operator, { action: "backfill", babyId: "baby-a", jobId: f.job.id, requestId: "range-one", range: { from: "2026-10-22T00:00:00Z", to: "2026-10-23T01:00:00Z" } });
    const backfill = await f.call({ action: "begin", runId: "backfill" });
    expect(backfill.batch.cursor).toEqual({});
    const stagedBackfill = await f.call({ action: "stage", batchId: backfill.batch.id, runId: "backfill", page: page() });
    expect(stagedBackfill.batch.messages).toEqual([]); expect(stagedBackfill.batch.skippedSourceIds).toEqual([source().sourceId]);
    await f.call({ action: "plan", batchId: backfill.batch.id, runId: "backfill", plan: { plans: [], ignored: [] } });
    await f.call({ action: "finish", batchId: backfill.batch.id, runId: "backfill" });
    const status = await f.call({ action: "status" });
    expect(status.job.cursor).toEqual(committedCursor); expect(status.job.backfills[0]?.state).toBe("completed");
  });
});

async function startMcp(f: Fixture) {
  const server: Server = createServer((req, res) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const origin = `http://${req.headers.host}`;
    const request = new Request(new URL(req.url || "/", origin), { method: req.method, headers, ...(!["GET", "HEAD"].includes(req.method || "GET") ? { body: Buffer.concat(chunks) } : {}) });
    const response = await createHandler(f.identity, origin, { allowedOrigins: [] }, { records: f.records, attachments: f.attachments, collector: f.collector })(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries())); res.end(Buffer.from(await response.arrayBuffer()));
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleaners.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
  const client = new CollectorMcpClient(new URL(`http://127.0.0.1:${address.port}/api/mcp`), async () => f.token);
  await client.connect(); cleaners.push(() => client.close());
  return client;
}

describe("executable external Agent and real MCP runner", () => {
  it("uploads an exactly mapped image through protected HTTP and attaches its durable ID through actual MCP", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const message = { ...source(), kind: "image" as const, text: "换了便便尿布", media: [{ sourceId: source().sourceId, kind: "image" as const, state: "unresolved" as const, reason: "EXACT_PATH_REQUIRED" }] };
    const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#aaccee" } }).png({ compressionLevel: 9 }).toBuffer();
    const file = path.join(f.directory, "exact-image.png"); await writeFile(file, bytes);
    const resolver = new ExactLocalMediaResolver({ roots: [f.directory], mappings: [{ sourceId: message.sourceId, index: 0, path: file, sha256: createHash("sha256").update(bytes).digest("hex") }] });
    const agent = { execute: vi.fn(async (task: Parameters<CommandAgentExecutor["execute"]>[0]) => {
      const id = task.media[0]?.attachmentId; expect(id).toMatch(/^att_/);
      const protectedPhoto = await f.attachments.read(await f.principal(), "baby-a", id!); expect(protectedPhoto.bytes).toEqual(bytes);
      return { plans: [{ key: "diaper", sourceIds: [message.sourceId], tool: "bubu_record_events" as const, arguments: { events: [{ facts: { type: "DIAPER", startTime: message.sentAt, hasPoop: true }, attachmentIds: [id] }] } }], ignored: [] };
    }) };
    expect(await new CollectorRunner(client, { read: async () => page(message) }, agent, { resolver, uploader: client }).once("baby-a", f.job.id)).toMatchObject({ completed: true });
    const { events } = await f.records.query(await f.principal(), { babyId: "baby-a" }); expect(events[0]?.attachmentIds).toHaveLength(1);
    expect((await f.call({ action: "status" })).job.pendingMedia).toBe(0);
    const url = new URL(`/api/app/attachments/${events[0]!.attachmentIds[0]}?babyId=baby-a`, client.url);
    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${f.token}`, "X-Bubu-Client": "native" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  }, 30_000);

  it("persists an unavailable-image follow-up and retries it during backfill without another fact", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const message = { ...source(), media: [{ sourceId: source().sourceId, kind: "image" as const, state: "unresolved" as const, reason: "EXACT_PATH_REQUIRED" }] };
    const agent = { execute: vi.fn(async () => plan(message)) };
    await new CollectorRunner(client, { read: async () => page(message) }, agent).once("baby-a", f.job.id);
    expect((await f.call({ action: "status" })).job.pendingMedia).toBe(1);
    const pendingPhoto = await f.collector.pendingMedia(await f.principal(), "baby-a");
    expect(pendingPhoto).toHaveLength(1); expect(pendingPhoto[0]).toMatchObject({ kind: "media", sourceId: message.sourceId, media: [{ index: 0, state: "unavailable", reason: "MEDIA_RESOLVER_NOT_CONFIGURED" }] });
    expect(await client.call("bubu_get_pending", { babyId: "baby-a" })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "media", sourceId: message.sourceId })]));
    expect(JSON.stringify(pendingPhoto)).not.toContain(message.text);
    const caregiverToken = (await f.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    expect(await f.collector.pendingMedia(await f.identity.authenticate(caregiverToken), "baby-a")).toEqual(pendingPhoto);
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#f0eedd" } }).png({ compressionLevel: 9 }).toBuffer(); const file = path.join(f.directory, "later.png"); await writeFile(file, bytes);
    const resolver = new ExactLocalMediaResolver({ roots: [f.directory], mappings: [{ sourceId: message.sourceId, index: 0, path: file, sha256: createHash("sha256").update(bytes).digest("hex") }] });
    await f.collector.dispatch(f.operator, { action: "backfill", babyId: "baby-a", jobId: f.job.id, requestId: "media-backfill", range: { from: "2026-10-23T00:00:00Z", to: "2026-10-23T01:00:00Z" } });
    const attachmentAgent = { execute: vi.fn(async (task: Parameters<CommandAgentExecutor["execute"]>[0]): Promise<AgentPlan> => {
      const { events } = task.existingEvents as { events: { id: string; version: number }[] };
      return { plans: [{ key: "photo", sourceIds: [message.sourceId], tool: "bubu_attach_images", arguments: { eventId: events[0]!.id, expectedVersion: events[0]!.version, attachmentIds: [task.media[0]!.attachmentId] } }], ignored: [] };
    }) };
    await new CollectorRunner(client, { read: async () => page(message) }, attachmentAgent, { resolver, uploader: client }).once("baby-a", f.job.id);
    expect(f.backend.activities.size).toBe(1); expect((await f.call({ action: "status" })).job.pendingMedia).toBe(0); expect(attachmentAgent.execute).toHaveBeenCalledTimes(1);
    expect(await f.collector.pendingMedia(await f.principal(), "baby-a")).toEqual([]);
  }, 30_000);

  it("does not resurrect expired raw text through a media-only backfill", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const message = { ...source(), media: [{ sourceId: source().sourceId, kind: "image" as const, state: "unresolved" as const, reason: "EXACT_PATH_REQUIRED" }] };
    await new CollectorRunner(client, { read: async () => page(message) }, { execute: async () => plan(message) }).once("baby-a", f.job.id);
    const row = (await f.store.payload.find({ collection: "care-messages", where: { babyId: { equals: "baby-a" } }, overrideAccess: true })).docs[0]!;
    const original = row.value as { source: SourceMessage };
    await f.identity.exclusive(() => f.store.payload.update({ collection: "care-messages", id: row.id, data: { value: { ...original, privacyExpired: true, source: { ...original.source, text: "" } } }, req: f.store.currentRequest(), overrideAccess: true }));
    await f.collector.dispatch(f.operator, { action: "backfill", babyId: "baby-a", jobId: f.job.id, requestId: "expired-source-backfill", range: { from: "2026-10-23T00:00:00Z", to: "2026-10-23T01:00:00Z" } });
    const started = await f.call({ action: "begin", runId: "expired-backfill" });
    const result = await f.call({ action: "stage", batchId: started.batch.id, runId: "expired-backfill", page: page(message) });
    expect(result.batch.messages).toHaveLength(1); expect(result.batch.messages?.[0]?.text).toBe("");
    const persisted = await f.store.payload.findByID({ collection: "care-batches", id: result.batch.id, overrideAccess: true });
    expect(JSON.stringify(persisted)).not.toContain(message.text);
  }, 30000);

  it("never revives withdrawn facts when media backfill proposes a new event key", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const message = { ...source(), media: [{ sourceId: source().sourceId, kind: "image" as const, state: "unresolved" as const, reason: "EXACT_PATH_REQUIRED" }] };
    await new CollectorRunner(client, { read: async () => page(message) }, { execute: async () => plan(message) }).once("baby-a", f.job.id);
    const event = (await f.records.query(await f.principal(), { babyId: "baby-a" })).events[0]!;
    await f.records.retract(await f.principal(), { babyId: "baby-a", requestId: "withdraw-before-media", eventId: event.id, expectedVersion: event.version });
    expect(await f.collector.pendingMedia(await f.principal(), "baby-a")).toEqual([]);
    await f.collector.dispatch(f.operator, { action: "backfill", babyId: "baby-a", jobId: f.job.id, requestId: "retired-photo-backfill", range: { from: "2026-10-23T00:00:00Z", to: "2026-10-23T01:00:00Z" } });
    const started = await f.call({ action: "begin", runId: "retired-run" }), leased = { batchId: started.batch.id, runId: "retired-run" };
    const staged = await f.call({ action: "stage", ...leased, page: page(message) });
    expect(staged.batch.mediaOnly).toEqual({ [message.sourceId]: [event.id] });
    await f.call({ action: "media", ...leased, resolutions: [{ sourceId: message.sourceId, index: 0, state: "unavailable", reason: "MEDIA_EXACT_FILE_MISSING" }] });
    const replay = plan(message); replay.plans[0]!.key = "brand-new-event-key";
    await expect(f.call({ action: "plan", ...leased, plan: replay })).rejects.toMatchObject({ code: "COLLECTOR_MEDIA_ONLY_SOURCE" });
    const revive: AgentPlan = { plans: [{ key: "revive", sourceIds: [message.sourceId], tool: "bubu_restore_event", arguments: { eventId: event.id, expectedVersion: event.version + 1 } }], ignored: [] };
    await expect(f.call({ action: "plan", ...leased, plan: revive })).rejects.toMatchObject({ code: "COLLECTOR_MEDIA_ONLY_SOURCE" });
    await f.call({ action: "plan", ...leased, plan: { plans: [], ignored: [] } }); await f.call({ action: "finish", ...leased });
    const result = await f.records.query(await f.principal(), { babyId: "baby-a", includeRetracted: true });
    expect(result.events).toHaveLength(1); expect(result.events[0]!.lifecycle).toBe("retracted"); expect(f.backend.activities.size).toBe(0);
    expect((await f.call({ action: "status" })).job.pendingMedia).toBe(0);
  }, 30_000);

  it("lets a human close a photo follow-up only after a real private upload and versioned association", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const message = { ...source(), media: [{ sourceId: source().sourceId, kind: "image" as const, state: "unresolved" as const, reason: "EXACT_PATH_REQUIRED" }] };
    await new CollectorRunner(client, { read: async () => page(message) }, { execute: async () => plan(message) }).once("baby-a", f.job.id);
    const token = (await f.identity.loginLegacy("old-alice", "correct-password", "native")).token, human = await f.identity.authenticate(token);
    const event = (await f.records.query(human, { babyId: "baby-a" })).events[0]!;
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } }).png({ compressionLevel: 9 }).toBuffer();
    const attachment = await f.attachments.upload(human, "baby-a", bytes, "image/png", "human-photo-upload");
    const request = { babyId: "baby-a", requestId: "human-photo-confirm", pendingId: `media:${message.sourceId}`, eventId: event.id, expectedVersion: event.version, attachmentId: attachment.id };
    await expect(f.collector.resolveMedia(await f.principal(), request)).rejects.toMatchObject({ code: "MEDIA_HUMAN_CONFIRMATION_REQUIRED" });
    await expect(f.collector.resolveMedia(human, request)).rejects.toMatchObject({ code: "MEDIA_ATTACHMENT_NOT_LINKED" });
    const receipt = await f.records.attach(human, { babyId: "baby-a", requestId: "human-photo-attach", eventId: event.id, expectedVersion: event.version, attachmentIds: [attachment.id] });
    await expect(f.collector.resolveMedia(human, request)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const confirmed = { ...request, expectedVersion: receipt.events[0]!.version };
    f.token = token;
    expect(await client.call("bubu_resolve_media", confirmed)).toMatchObject({ state: "resolved", resolution: "provided" });
    expect(await client.call("bubu_resolve_media", confirmed)).toMatchObject({ state: "resolved" });
    expect(await f.collector.pendingMedia(human, "baby-a")).toEqual([]);
    await expect(f.collector.resolveMedia(human, { ...confirmed, attachmentId: "another-id" })).rejects.toMatchObject({ code: "COLLECTOR_REQUEST_REUSED" });
  }, 30_000);

  it("persists an explicit human unknown without claiming an available image or asking again", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const message = { ...source(), media: [{ sourceId: source().sourceId, kind: "image" as const, state: "unresolved" as const, reason: "EXACT_PATH_REQUIRED" }] };
    await new CollectorRunner(client, { read: async () => page(message) }, { execute: async () => plan(message) }).once("baby-a", f.job.id);
    const token = (await f.identity.loginLegacy("old-alice", "correct-password", "native")).token, human = await f.identity.authenticate(token);
    const event = (await f.records.query(human, { babyId: "baby-a" })).events[0]!;
    expect(await f.collector.resolveMedia(human, { babyId: "baby-a", requestId: "human-photo-unknown", pendingId: `media:${message.sourceId}`, eventId: event.id, expectedVersion: event.version, resolution: "unknown" })).toMatchObject({ state: "resolved", resolution: "unknown" });
    expect(await f.collector.pendingMedia(human, "baby-a")).toEqual([]);
    const after = (await f.records.query(human, { babyId: "baby-a" })).events[0]!;
    expect(after.attachmentIds).toEqual([]); expect(after.version).toBe(event.version); expect(after.facts).toEqual(event.facts);
    await f.collector.dispatch(f.operator, { action: "backfill", babyId: "baby-a", jobId: f.job.id, requestId: "unknown-photo-backfill", range: { from: "2026-10-23T00:00:00Z", to: "2026-10-23T01:00:00Z" } });
    const agent = { execute: vi.fn(async () => plan(message)) };
    await new CollectorRunner(client, { read: async () => page(message) }, agent).once("baby-a", f.job.id);
    expect(agent.execute).not.toHaveBeenCalled(); expect(f.backend.activities.size).toBe(1);
  }, 30_000);

  it("hides mixed-group merged media targets from the original collector while keeping human follow-up", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const message = { ...source(), media: [{ sourceId: source().sourceId, kind: "image" as const, state: "unresolved" as const, reason: "EXACT_PATH_REQUIRED" }] };
    await new CollectorRunner(client, { read: async () => page(message) }, { execute: async () => plan(message) }).once("baby-a", f.job.id);
    const eventA = (await f.records.query(await f.principal(), { babyId: "baby-a" })).events[0]!;
    const groupB = canonicalGroupId("another-account", "another-group@chatroom");
    await f.identity.bindGroup(f.operator, "baby-a", groupB, "agent-b", true);
    const other = await f.identity.authenticate((await f.identity.issueAgent(f.operator, "baby-a", "collector", { groupId: groupB, agentId: "agent-b" })).token);
    const saved = await f.records.record(other, { babyId: "baby-a", requestId: "group-b-record", events: [{ facts: { type: "BOTTLE", startTime: message.sentAt }, sources: [{ kind: "wechat", accountId: "another-account", conversationId: "another-group@chatroom", groupId: groupB, messageId: "message/message_0.db/Msg_other/1", eventKey: "feeding:0", sentAt: message.sentAt, senderId: "other-sender" }] }] });
    const eventB = saved.events[0]!;
    const token = (await f.identity.loginLegacy("old-alice", "correct-password", "native")).token, human = await f.identity.authenticate(token);
    await f.records.resolveDuplicate(human, { babyId: "baby-a", requestId: "human-merge-groups", eventId: eventB.id, expectedVersion: eventB.version, resolution: "same", targetEventId: eventA.id, targetVersion: eventA.version });
    expect(await f.collector.pendingMedia(await f.principal(), "baby-a")).toEqual([]);
    expect((await f.collector.pendingMedia(human, "baby-a"))[0]?.eventIds).toEqual([eventA.id]);
    await f.collector.dispatch(f.operator, { action: "backfill", babyId: "baby-a", jobId: f.job.id, requestId: "mixed-photo-backfill", range: { from: "2026-10-23T00:00:00Z", to: "2026-10-23T01:00:00Z" } });
    const agent = { execute: vi.fn(async () => plan(message)) };
    await new CollectorRunner(client, { read: async () => page(message) }, agent).once("baby-a", f.job.id);
    expect(agent.execute).not.toHaveBeenCalled(); expect((await f.collector.pendingMedia(human, "baby-a"))[0]?.eventIds).toEqual([eventA.id]);
  }, 30_000);

  it("writes through the actual MCP Client and record rules before completing its scheduled batch", async () => {
    const f = await setup(); await f.configure(true); const client = await startMcp(f);
    const agent = new CommandAgentExecutor({ executable: process.execPath, args: ["-e", `let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const task=JSON.parse(raw);if(task.protocol!=='bubu-collector-agent/v1'||!task.tools.some(t=>t.name==='bubu_record_events'))process.exit(2);process.stdout.write(JSON.stringify(${JSON.stringify(plan())}));});`] });
    const reader = { read: vi.fn(async () => page()) };
    const runner = new CollectorRunner(client, reader, agent);
    expect(await runner.once("baby-a", f.job.id)).toMatchObject({ completed: true });
    expect(f.backend.activities.size).toBe(1);
    expect((await f.records.pending(await f.principal(), "baby-a")).length).toBeGreaterThan(0);
    expect(await runner.once("baby-a", f.job.id)).toMatchObject({ skipped: "not_due" });
    expect(reader.read).toHaveBeenCalledTimes(1);
    await f.identity.bindGroup(f.operator, "baby-a", f.groupId, "collector-agent", false);
    await expect(client.call("bubu_get_pending", { babyId: "baby-a" })).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN", retryable: false });
  }, 30_000);

  it("exposes a real timer entry that stops on abort without enabling a job", async () => {
    const controller = new AbortController(); const once = vi.fn(async () => { controller.abort(); return { skipped: "disabled" }; });
    await scheduleCollector({ once } as unknown as CollectorRunner, { babyId: "baby-a", jobId: "disabled", signal: controller.signal });
    expect(once).toHaveBeenCalledTimes(1);
  });
});
