import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../src/http";
import { CollectorService } from "../src/collector/service";
import { CollectorRunner } from "../src/collector/runner";
import { canonicalGroupId, type SourceMessage } from "../src/collector/types";
import { hash } from "../src/records/persistence";
import type { Attachment } from "../src/records/attachments";
import type { CareEvent, PendingQuestion, RecordReceipt } from "../src/records/types";
import { recordsFixture, type RecordsFixture } from "./fixtures/records";

describe("real MCP client over loopback HTTP uses the same durable records and binary media service", () => {
  let fixture: RecordsFixture, server: Server, origin: string, token: string, bobToken: string, client: Client, operator: Client;
  const connected: Client[] = [], called = new Set<string>();
  const tools = ["bubu_record_events", "bubu_update_event", "bubu_retract_event", "bubu_restore_event", "bubu_undo_event", "bubu_query_events", "bubu_get_summary", "bubu_get_pending", "bubu_answer_pending", "bubu_attach_images", "bubu_resolve_media", "bubu_resolve_duplicate", "bubu_confirm_overlap", "bubu_get_request", "bubu_get_revisions", "bubu_accept_legacy", "bubu_get_rules", "bubu_collector"];
  const source = { kind: "manual", accountId: "synthetic-caregiver", conversationId: "fixture-chat", messageId: "message-1", eventKey: "bottle", sentAt: "2026-10-22T08:00:43+08:00", senderId: "synthetic-caregiver" };
  const bottle = { type: "BOTTLE", startTime: "2026-10-22T08:00:00+08:00", durationMinutes: 10, milkSource: "BREAST_MILK", milkAmount: 100, burpSuccess: false };

  async function connect(credential: string) {
    const connectedClient = new Client({ name: "bubu-synthetic-mcp-test", version: "1.0.0" });
    await connectedClient.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${credential}` } } }));
    connected.push(connectedClient); return connectedClient;
  }
  async function call<T>(name: string, args: Record<string, unknown>, using = client): Promise<T> {
    const result = await using.callTool({ name, arguments: args });
    expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true); called.add(name);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe("text"); return JSON.parse(content[0]!.text!) as T;
  }

  beforeAll(async () => {
    fixture = await recordsFixture();
    token = (await fixture.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    bobToken = (await fixture.identity.loginLegacy("old-bob", "correct-password", "native")).token;
    const operatorToken = (await fixture.identity.provisionOperator("mcp-operator", "baby-a", 3_600_000)).token;
    const collector = new CollectorService(fixture.identity, (babyId, requestId, req, principal) => fixture.records.verifyCollectorReceipt(babyId, requestId, req, principal));
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const response = await handle(new Request(new URL(incoming.url || "/", origin), {
          method: incoming.method, headers, ...(!["GET", "HEAD"].includes(incoming.method || "GET") ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}),
        }));
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch { outgoing.writeHead(500); outgoing.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected loopback TCP server");
    origin = `http://127.0.0.1:${address.port}`;
    const handle = createHandler(fixture.identity, origin, { allowedOrigins: [] }, { records: fixture.records, attachments: fixture.attachments, collector });
    client = await connect(token); operator = await connect(operatorToken);
  }, 30_000);
  beforeEach(async () => { await fixture.resetRecords(); });
  afterAll(async () => {
    await Promise.all(connected.map(value => value.close()));
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    await fixture?.close();
  });

  it("lists the complete strict tool contract and runs creation, completion, revisions, removal, restoration and duplicate resolution", async () => {
    const available = await client.listTools(); expect(available.tools.map(tool => tool.name).sort()).toEqual([...tools].sort());
    expect(available.tools.find(tool => tool.name === "bubu_record_events")?.inputSchema.additionalProperties).toBe(false);
    const rules = await call<{ types: string[]; rule: { missing: string[] } }>("bubu_get_rules", { babyId: "baby-a", type: "BOTTLE", milkSource: "FORMULA" });
    expect(rules.types).toHaveLength(15); expect(rules.rule.missing).toContain("preparedMilkAmount");
    const incomplete = { ...bottle, milkAmount: null };
    const input = { babyId: "baby-a", requestId: "mcp-original-source", events: [{ facts: incomplete, sources: [source] }] };
    const initial = await call<RecordReceipt>("bubu_record_events", input);
    expect(initial.status).toBe("needs_information"); expect(initial.events).toHaveLength(1);
    expect(await call<RecordReceipt>("bubu_record_events", input)).toEqual(initial);
    const pending = await call<PendingQuestion[]>("bubu_get_pending", { babyId: "baby-a" });
    const question = pending[0]!; expect(question.fields).toContain("milkAmount");
    let receipt = await call<RecordReceipt>("bubu_answer_pending", { babyId: "baby-a", requestId: "mcp-answer-original", questionId: question.id, questionVersion: question.version, eventVersion: question.eventVersion, patch: { facts: { milkAmount: 100 } } });
    expect(receipt.status).toBe("saved"); let event = receipt.events[0]!;
    expect((await call<RecordReceipt>("bubu_get_request", { babyId: "baby-a", requestId: "mcp-answer-original" })).events[0]?.id).toBe(event.id);
    expect((await call<{ events: CareEvent[] }>("bubu_query_events", { babyId: "baby-a" })).events).toHaveLength(1);
    expect((await call<{ metrics: { totalMilkAmount: number } }>("bubu_get_summary", { babyId: "baby-a", date: "2026-10-22" })).metrics.totalMilkAmount).toBe(100);
    receipt = await call<RecordReceipt>("bubu_update_event", { babyId: "baby-a", requestId: "mcp-correct-amount", eventId: event.id, expectedVersion: event.version, patch: { facts: { milkAmount: 110 } } }); event = receipt.events[0]!;
    const revisions = await call<Array<{ id: string; version: number }>>("bubu_get_revisions", { babyId: "baby-a", eventId: event.id });
    receipt = await call<RecordReceipt>("bubu_undo_event", { babyId: "baby-a", requestId: "mcp-undo-correction", eventId: event.id, expectedVersion: event.version, revisionId: revisions.find(value => value.version === event.version)!.id }); event = receipt.events[0]!;
    expect(event.facts.milkAmount).toBe(100);
    receipt = await call<RecordReceipt>("bubu_retract_event", { babyId: "baby-a", requestId: "mcp-retract-original", eventId: event.id, expectedVersion: event.version }); event = receipt.events[0]!;
    expect(event.lifecycle).toBe("retracted"); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    const replay = await call<RecordReceipt>("bubu_record_events", { ...input, requestId: "mcp-late-replay" });
    expect(replay.events[0]?.lifecycle).toBe("retracted"); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    receipt = await call<RecordReceipt>("bubu_restore_event", { babyId: "baby-a", requestId: "mcp-explicit-restore", eventId: event.id, expectedVersion: event.version }); event = receipt.events[0]!;
    const old = fixture.legacy.activities.get(event.legacyId)!;
    fixture.legacy.activities.set(old.id, { ...old, milkAmount: 130, updatedAt: "2026-10-23T12:01:00Z" });
    receipt = await call<RecordReceipt>("bubu_update_event", { babyId: "baby-a", requestId: "mcp-remote-conflict", eventId: event.id, expectedVersion: event.version, patch: { facts: { milkAmount: 120 } } }); event = receipt.events[0]!;
    expect(receipt.status).toBe("conflict");
    receipt = await call<RecordReceipt>("bubu_accept_legacy", { babyId: "baby-a", requestId: "mcp-accept-remote", eventId: event.id, expectedVersion: event.version }); event = receipt.events[0]!;
    expect(event.facts.milkAmount).toBe(130);
    const duplicate = await call<RecordReceipt>("bubu_record_events", { babyId: "baby-a", requestId: "mcp-second-entry", events: [{ facts: { ...bottle, milkAmount: 130 }, sources: [{ ...source, messageId: "message-2" }] }] });
    const candidate = duplicate.events[0]!; expect(candidate.duplicateCandidates).toContain(event.id);
    const resolved = await call<RecordReceipt>("bubu_resolve_duplicate", { babyId: "baby-a", requestId: "mcp-resolve-same", eventId: candidate.id, expectedVersion: candidate.version, resolution: "same", targetEventId: event.id, targetVersion: event.version });
    expect(resolved.events.find(value => value.id === candidate.id)?.lifecycle).toBe("merged");
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1);
    expect(await call("bubu_collector", { action: "status", babyId: "baby-a" }, operator)).toEqual({ jobs: [] });
    const sleep = (await call<RecordReceipt>("bubu_record_events", { babyId: "baby-a", requestId: "mcp-overlap-sleep", events: [{ facts: { type: "SLEEP", startTime: "2026-10-22T14:00:00+08:00", durationMinutes: 60 } }] })).events[0]!;
    const head = (await call<RecordReceipt>("bubu_record_events", { babyId: "baby-a", requestId: "mcp-overlap-head", events: [{ facts: { type: "HEAD_LIFT", startTime: "2026-10-22T14:15:00+08:00", durationMinutes: 10 } }] })).events[0]!;
    expect(head.projection).toBe("candidate"); expect(head.conflicts.some(issue => issue.code === "TIME_OVERLAP")).toBe(true);
    const confirmed = await call<RecordReceipt>("bubu_confirm_overlap", { babyId: "baby-a", requestId: "mcp-overlap-confirm", eventId: head.id, expectedVersion: head.version, conflictingEventIds: [sleep.id], reason: "照护者确认起床前确实进行过短时抬头" });
    expect(confirmed.status).toBe("saved"); expect(confirmed.events[0]?.projection).toBe("synced");
  });

  it("uploads original binary data over 16 KiB and associates and reads it through authorized routes", async () => {
    const bytes = await sharp(randomBytes(128 * 128 * 3), { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer();
    expect(bytes.length).toBeGreaterThan(16_384);
    const uploaded = await fetch(`${origin}/api/app/attachments?babyId=baby-a`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png", "X-Bubu-Request-Id": "mcp-binary-original" }, body: new Uint8Array(bytes) });
    expect(uploaded.status).toBe(200); const attachment = (await uploaded.json() as { data: Attachment }).data;
    expect(JSON.stringify(attachment)).not.toContain(fixture.directory);
    const recorded = await call<RecordReceipt>("bubu_record_events", { babyId: "baby-a", requestId: "mcp-photo-event", events: [{ facts: { type: "DIAPER", startTime: "2026-10-22T09:00:00+08:00", hasPoop: true, hasPee: false, poopColor: "YELLOW" } }] });
    const event = recorded.events[0]!;
    const attached = await call<RecordReceipt>("bubu_attach_images", { babyId: "baby-a", requestId: "mcp-attach-photo", eventId: event.id, expectedVersion: event.version, attachmentIds: [attachment.id] });
    expect(attached.events[0]?.attachmentIds).toEqual([attachment.id]);
    const downloaded = await fetch(new URL(attachment.url, origin), { headers: { Authorization: `Bearer ${token}` } });
    expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect((await fetch(new URL(attachment.url, origin), { headers: { Authorization: `Bearer ${bobToken}` } })).status).toBe(403);
    expect((await fetch(`${origin}/api/app/attachments?babyId=baby-a`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: "https://untrusted.example", "Content-Type": "image/png", "X-Bubu-Request-Id": "untrusted-binary" }, body: new Uint8Array(bytes) })).status).toBe(403);
    const browser = await fixture.identity.loginLegacy("old-alice", "correct-password", "browser");
    const browserUpload = await fetch(`${origin}/api/app/attachments?babyId=baby-a`, { method: "POST", headers: { Cookie: `bubu_session=${browser.token}`, Origin: origin, "X-Bubu-Client": "browser", "Content-Type": "image/png", "X-Bubu-Request-Id": "browser-binary" }, body: new Uint8Array(bytes) });
    expect(browserUpload.status).toBe(200);
    const accountId = "mcp-synthetic-account", chatId = "mcp-synthetic-group@chatroom", databaseId = "message/message_0.db";
    const tableName = `Msg_${createHash("md5").update(chatId).digest("hex")}`, groupId = canonicalGroupId(accountId, chatId);
    const sourceId = `wechat:${hash(["wechat", accountId, databaseId, tableName, 1])}`;
    await fixture.identity.bindGroup(fixture.operator, "baby-a", groupId, "mcp-media-collector", true);
    const collectorClient = await connect((await fixture.identity.issueAgent(fixture.operator, "baby-a", "collector", { groupId, agentId: "mcp-media-collector" })).token);
    const configured = await call<{ job: { id: string } }>("bubu_collector", { action: "configure", babyId: "baby-a", accountId, chatId, agentId: "mcp-media-collector", enabled: true }, operator);
    const message: SourceMessage = { sourceId, accountId, chatId, databaseId, tableName, groupId, localId: 1, sentAt: "2026-10-22T11:00:00+08:00", senderId: "synthetic-caregiver", kind: "image", text: "换了有尿尿布，原图片暂不可读", media: [{ sourceId, kind: "image", state: "unresolved", reason: "EXACT_PATH_REQUIRED" }] };
    const runner = new CollectorRunner({ call: (name, args) => call(name, args, collectorClient), tools: async () => (await collectorClient.listTools()).tools },
      { read: async () => ({ messages: [message], nextCursor: { [`${databaseId}:${tableName}`]: 1 }, hasMore: false }) },
      { execute: async () => ({ plans: [{ key: "diaper-photo", sourceIds: [sourceId], tool: "bubu_record_events", arguments: { events: [{ facts: { type: "DIAPER", startTime: message.sentAt, hasPoop: false, hasPee: true, peeAmount: "SMALL" } }] } }], ignored: [] }) });
    expect(await runner.once("baby-a", configured.job.id)).toMatchObject({ completed: true });
    const pending = await call<Array<{ kind?: string; id: string; eventIds?: string[] }>>("bubu_get_pending", { babyId: "baby-a" });
    const mediaQuestion = pending.find(question => question.kind === "media")!; expect(mediaQuestion.id).toBe(`media:${sourceId}`);
    const recordedPhoto = (await call<{ events: CareEvent[] }>("bubu_query_events", { babyId: "baby-a", eventId: mediaQuestion.eventIds![0] })).events[0]!;
    const repaired = await call<RecordReceipt>("bubu_attach_images", { babyId: "baby-a", requestId: "mcp-human-photo-repair", eventId: recordedPhoto.id, expectedVersion: recordedPhoto.version, attachmentIds: [attachment.id] });
    expect(await call("bubu_resolve_media", { babyId: "baby-a", requestId: "mcp-human-photo-confirm", pendingId: mediaQuestion.id, eventId: recordedPhoto.id, expectedVersion: repaired.events[0]!.version, attachmentId: attachment.id })).toMatchObject({ state: "resolved", resolution: "provided" });
    expect(await call("bubu_get_pending", { babyId: "baby-a" })).toEqual([]);
    expect(new Set(called)).toEqual(new Set(tools));
  });

  it("enforces strict arguments, stale versions, baby scope and authentication on each real MCP request", async () => {
    const invalid = await client.callTool({ name: "bubu_record_events", arguments: { babyId: "baby-a", requestId: "mcp-actor-injection", events: [{ facts: bottle }], actor: { kind: "operator" } } });
    expect(invalid.isError).toBe(true); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    const extraFact = await client.callTool({ name: "bubu_record_events", arguments: { babyId: "baby-a", requestId: "mcp-url-injection", events: [{ facts: { ...bottle, poopPhotoUrl: "https://public.example/image.png" } }] } });
    expect(extraFact.isError).toBe(true);
    const initial = await call<RecordReceipt>("bubu_record_events", { babyId: "baby-a", requestId: "mcp-zero-known", events: [{ facts: { ...bottle, milkAmount: 0 } }] });
    expect(initial.events[0]?.facts.milkAmount).toBe(0);
    const event = initial.events[0]!;
    await call("bubu_update_event", { babyId: "baby-a", requestId: "mcp-current-version", eventId: event.id, expectedVersion: event.version, patch: { facts: { milkAmount: 10 } } });
    const stale = await client.callTool({ name: "bubu_update_event", arguments: { babyId: "baby-a", requestId: "mcp-stale-version", eventId: event.id, expectedVersion: event.version, patch: { facts: { milkAmount: 20 } } } });
    expect(stale.isError).toBe(true); expect(JSON.stringify(stale.content)).toContain("VERSION_CONFLICT");
    const wrongBaby = await client.callTool({ name: "bubu_query_events", arguments: { babyId: "baby-b" } });
    expect(wrongBaby.isError).toBe(true); expect(JSON.stringify(wrongBaby.content)).toContain("BABY_FORBIDDEN");
    const parentToken = (await fixture.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    const parent = await fixture.identity.authenticate(parentToken, "bearer");
    const delegated = await connect((await fixture.identity.issueAgent(parent, "baby-a", "chat-agent")).token);
    await fixture.identity.logout(parent);
    const revoked = await delegated.callTool({ name: "bubu_get_pending", arguments: { babyId: "baby-a" } });
    expect(revoked.isError).toBe(true); expect(JSON.stringify(revoked.content)).toContain("UNAUTHORIZED");
  });

  it("filters snapshot activity dates and protects nested original photo URLs in HTTP, MCP receipts and revisions", async () => {
    const legacyUrl = "https://legacy-private.example/original-photo.png?old-token=fixture";
    fixture.legacy.activities.set("legacy-photo", { id: "legacy-photo", babyId: "baby-a", type: "DIAPER", startTime: "2026-10-22T08:00:00+08:00", endTime: "2026-10-22T08:00:00+08:00", hasPoop: true, hasPee: false, poopColor: "YELLOW", poopPhotoUrl: legacyUrl });
    fixture.legacy.activities.set("other-day-photo", { id: "other-day-photo", babyId: "baby-a", type: "DIAPER", startTime: "2026-10-21T08:00:00+08:00", endTime: "2026-10-21T08:00:00+08:00", hasPoop: true, hasPee: false, poopColor: "YELLOW", poopPhotoUrl: legacyUrl });
    const response = await fetch(`${origin}/api/app/records/snapshot?babyId=baby-a&date=2026-10-22`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const snapshot = await response.json() as { events: CareEvent[]; activities: Array<{ id: string; poopPhotoUrl?: string }> };
    expect(snapshot.events.map(value => value.id)).toEqual(["legacy-photo"]);
    expect(snapshot.activities.map(value => value.id)).toEqual(["legacy-photo"]);
    expect(snapshot.activities[0]?.poopPhotoUrl).toBe("/api/app/media/activities/legacy-photo?babyId=baby-a");
    expect(JSON.stringify(snapshot)).not.toContain("legacy-private.example");
    const query = await call<{ events: CareEvent[]; activities: Array<{ id: string }> }>("bubu_query_events", { babyId: "baby-a", date: "2026-10-22" });
    expect(query.activities.map(value => value.id)).toEqual(["legacy-photo"]); expect(JSON.stringify(query)).not.toContain("legacy-private.example");
    const updated = await call<RecordReceipt>("bubu_update_event", { babyId: "baby-a", requestId: "mcp-nested-photo-update", eventId: "legacy-photo", expectedVersion: 1, patch: { facts: { notes: "文字核对完成" } } });
    expect(updated.status).toBe("saved"); expect(JSON.stringify(updated)).not.toContain("legacy-private.example");
    const revisions = await call("bubu_get_revisions", { babyId: "baby-a", eventId: "legacy-photo" });
    expect(JSON.stringify(revisions)).not.toContain("legacy-private.example"); expect(JSON.stringify(revisions)).toContain("/api/app/media/activities/legacy-photo");
    const httpRevisions = await fetch(`${origin}/api/app/records/revisions?babyId=baby-a&eventId=legacy-photo`, { headers: { Authorization: `Bearer ${token}` } });
    expect(JSON.stringify(await httpRevisions.json())).not.toContain("legacy-private.example");
    expect(fixture.legacy.activities.get("legacy-photo")?.poopPhotoUrl).toBe(legacyUrl);
  });

  it("shows ongoing sleep on the next day in HTTP and MCP, then splits completed sleep at midnight", async () => {
    type Snapshot = Awaited<ReturnType<RecordsFixture["records"]["query"]>>;
    const previousNow = fixture.identity.now();
    const readHttp = async <T>(path: string): Promise<T> => {
      const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200); return await response.json() as T;
    };
    try {
      fixture.advance(Date.parse("2026-10-23T23:30:00+08:00") - previousNow);
      const created = await call<RecordReceipt>("bubu_record_events", { babyId: "baby-a", requestId: "mcp-overnight-sleep", events: [{ facts: { type: "SLEEP", startTime: "2026-10-23T23:30:00+08:00" }, progress: "ongoing" }] });
      const event = created.events[0]!;
      fixture.legacy.activities.set("old-sleep-missing-end", { id: "old-sleep-missing-end", babyId: "baby-a", type: "SLEEP", startTime: "2026-10-23T21:00:00+08:00" });
      fixture.advance(3_600_000);
      const http = await readHttp<Snapshot>("/api/app/records/snapshot?babyId=baby-a&date=2026-10-24");
      const mcp = await call<Snapshot>("bubu_query_events", { babyId: "baby-a", date: "2026-10-24" });
      for (const snapshot of [http, mcp]) {
        expect(snapshot.events.map(value => value.id)).toEqual([event.id]);
        expect(snapshot.activities.map(value => value.id)).toEqual([event.legacyId]);
        expect(snapshot.summary?.coverage).toMatchObject({ recordedEvents: 1, ongoingEvents: 1 });
        expect(snapshot.summary?.byType.SLEEP).toMatchObject({ events: 1, ongoingEvents: 1, knownMinutes: 0, unknownDurations: 0 });
        expect(snapshot.summary?.metrics).toMatchObject({ sleepCount: 0, totalSleepMinutes: 0 });
      }
      const rows = await readHttp<Array<{ id: string }>>("/api/app/activities?babyId=baby-a&date=2026-10-24");
      expect(rows.map(value => value.id)).toEqual([event.legacyId]);
      const daily = await readHttp<{ totalSleepMinutes: number; coverage: { ongoingEvents: number } }>("/api/app/daily-stats/2026-10-24?babyId=baby-a");
      expect(daily.totalSleepMinutes).toBe(0); expect(daily.coverage.ongoingEvents).toBe(1);
      fixture.advance(1_800_000);
      const completed = await call<RecordReceipt>("bubu_update_event", { babyId: "baby-a", requestId: "mcp-overnight-woke", eventId: event.id, expectedVersion: event.version, patch: { facts: { endTime: "2026-10-24T01:00:00+08:00" }, progress: "ended" } });
      expect(completed.status).toBe("saved"); expect(completed.events[0]?.id).toBe(event.id);
      for (const [date, minutes] of [["2026-10-23", 30], ["2026-10-24", 60]] as const) {
        const snapshot = await readHttp<Snapshot>(`/api/app/records/snapshot?babyId=baby-a&date=${date}`);
        const query = await call<Snapshot>("bubu_query_events", { babyId: "baby-a", date });
        for (const result of [snapshot, query]) {
          expect(result.activities.map(value => value.id)).toContain(event.legacyId);
          expect(result.summary?.metrics).toMatchObject({ sleepCount: 1, totalSleepMinutes: minutes });
          expect(result.summary?.coverage.ongoingEvents).toBe(0);
        }
      }
    } finally { fixture.advance(previousNow - fixture.identity.now()); }
  });

  it("stops extending sleep when the legacy application saves an end while ongoing metadata is stale", async () => {
    type Snapshot = Awaited<ReturnType<RecordsFixture["records"]["query"]>>;
    const previousNow = fixture.identity.now();
    try {
      fixture.advance(Date.parse("2026-10-23T23:30:00+08:00") - previousNow);
      const created = await call<RecordReceipt>("bubu_record_events", { babyId: "baby-a", requestId: "mcp-legacy-ended-sleep", events: [{ facts: { type: "SLEEP", startTime: "2026-10-23T23:30:00+08:00" }, progress: "ongoing" }] });
      const event = created.events[0]!, original = fixture.legacy.activities.get(event.legacyId)!;
      fixture.legacy.activities.set(event.legacyId, { ...original, endTime: "2026-10-23T23:50:00+08:00", updatedAt: "2026-10-23T15:50:00Z" });
      fixture.advance(3_600_000);
      const query = await call<Snapshot>("bubu_query_events", { babyId: "baby-a", date: "2026-10-24" });
      expect(query.events).toHaveLength(0); expect(query.activities).toHaveLength(0);
      expect(query.summary?.coverage).toMatchObject({ recordedEvents: 0, ongoingEvents: 0 });
      const response = await fetch(`${origin}/api/app/records/snapshot?babyId=baby-a&date=2026-10-24`, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200); const snapshot = await response.json() as Snapshot;
      expect(snapshot.events).toHaveLength(0); expect(snapshot.activities).toHaveLength(0);
      const chart = await fetch(`${origin}/api/app/activities?babyId=baby-a&date=2026-10-24`, { headers: { Authorization: `Bearer ${token}` } });
      expect(chart.status).toBe(200); expect(await chart.json()).toEqual([]);
      const actualDay = await call<Snapshot>("bubu_query_events", { babyId: "baby-a", date: "2026-10-23" });
      expect(actualDay.events[0]?.currentActivity?.endTime).toBe("2026-10-23T23:50:00+08:00");
      expect(actualDay.summary?.metrics).toMatchObject({ sleepCount: 1, totalSleepMinutes: 20 });
      expect(actualDay.summary?.coverage.ongoingEvents).toBe(0);
    } finally { fixture.advance(previousNow - fixture.identity.now()); }
  });
});
