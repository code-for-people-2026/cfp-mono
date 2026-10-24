import { PrivacyOperations } from "../src/privacy/operations";
import { testPrivacyConfig, grantFixturePrivacy } from "./fixtures/privacy";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { createRuntime, type BubuRuntime } from "../src/runtime";
import { createNodeServer } from "../src/node-server";
import { bootstrapOpsAdmin } from "../src/operations/collections";
import { readOpsUser, type OpsUser } from "../src/operations/access";
import { OperationsService } from "../src/operations/service";
import { OperationsHealth } from "../src/operations/health";
import type { OpsAction } from "../src/operations/contracts";
import { RecordsLegacyFixture } from "./fixtures/records";
import { WechatFixture } from "./fixtures/identity";
import { RecordsRepository, hash } from "../src/records/persistence";
import { ChatMcpClient } from "../src/chat/mcp";

describe("运营使用真实 Payload、HTTP MCP 和原有业务规则", () => {
  let directory: string, runtime: BubuRuntime, operations: OperationsService, admin: OpsUser, operator: OpsUser, auditor: OpsUser;
  const legacy = new RecordsLegacyFixture();
  const server = createNodeServer(request => runtime.handler(request), "http://127.0.0.1");
  let eventId = "", version = 0, identityId = "";
  const input = (command: OpsAction["command"], requestId: string, babyId = "baby-a"): OpsAction => ({ babyId, requestId, reason: "隔离合成运营验收", command });
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-ops-integration-"));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    runtime = await createRuntime({ privacy: testPrivacyConfig, directory, secret: "isolated-ops-integration-secret", publicOrigin: origin, opsOrigin: origin, mcpUrl: `${origin}/api/mcp`, legacy, wechat: new WechatFixture() });
    await grantFixturePrivacy(runtime);
    const first = await bootstrapOpsAdmin(runtime.store.payload, { email: "admin@synthetic.invalid", password: "Synthetic-Password-Only-2026", babyIds: ["baby-a", "baby-b"] });
    admin = await readOpsUser(runtime.store.payload, { ...first, collection: "ops-users" });
    const create = async (email: string, role: string) => {
      const doc = await runtime.store.payload.create({ collection: "ops-users", overrideAccess: false, user: admin, data: { email, password: "Synthetic-Password-Only-2026", role, active: true, babyIds: ["baby-a"] } });
      return readOpsUser(runtime.store.payload, { ...doc, collection: "ops-users" });
    };
    operator = await create("operator@synthetic.invalid", "operator"); auditor = await create("auditor@synthetic.invalid", "auditor");
    const login = await runtime.identity.loginLegacy("old-alice", "correct-password", "native"); identityId = login.context.identityId;
    operations = new OperationsService(runtime);
  }, 60_000);
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await runtime?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it("ordinary caregiver or collector cannot use the operations bridge", async () => {
    const login = await runtime.identity.loginLegacy("old-alice", "correct-password", "native");
    const response = await runtime.handler(new Request(`${runtime.opsOrigin}/api/ops/context`, { headers: { Authorization: `Bearer ${login.token}` } }));
    expect(response.status).toBe(401);
    const cookie = await runtime.handler(new Request(`${runtime.opsOrigin}/api/ops/context`, { headers: { Cookie: `bubu_session=${login.token}` } }));
    expect(cookie.status).toBe(401);
  });
  it("scopes private complaints, rejects stale replies, and returns the reply only to its owner", async () => {
    const principal = await runtime.identity.authenticate((await runtime.identity.loginLegacy("old-alice", "correct-password", "native")).token);
    const other = await runtime.identity.authenticate((await runtime.identity.loginLegacy("old-bob", "correct-password", "native")).token);
    const created = await runtime.privacy.request(principal, { kind: "complaint", message: "synthetic private complaint", babyId: "baby-a" });
    await runtime.privacy.request(principal, { kind: "privacy", message: "synthetic private account request" });
    const bridge = new PrivacyOperations(runtime.privacy, runtime.deletion), reason = "合成隐私请求核验";
    await expect(bridge.execute(auditor, { action: "read", babyId: "baby-a", reason })).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await expect(bridge.execute(operator, { action: "read", babyId: "baby-b", reason })).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await expect(bridge.execute(operator, { action: "read", reason })).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    const queue = await bridge.execute(operator, { action: "read", babyId: "baby-a", reason });
    expect(queue.requests).toHaveLength(1); expect(queue.requests[0]?.identityId).toBeUndefined();
    const reply = { action: "reply", babyId: "baby-a", reason, id: created.id, expectedUpdatedAt: queue.requests[0]!.updatedAt, reply: "合成处理答复" };
    await bridge.execute(operator, reply);
    await expect(bridge.execute(operator, reply)).rejects.toMatchObject({ code: "PRIVACY_REQUEST_CHANGED" });
    expect((await runtime.privacy.requests(principal)).find(row => row.id === created.id)?.reply).toBe(reply.reply);
    expect(await runtime.privacy.requests(other)).toEqual([]);
    expect((await bridge.execute(admin, { action: "read", reason })).requests).toHaveLength(1);
    expect(JSON.stringify(await runtime.store.list("audit"))).not.toContain("synthetic private complaint");
  });
  it("explicit scopes and auditor permissions apply even to service callers", async () => {
    expect((await operations.context(operator)).babies.map(baby => baby?.id)).toEqual(["baby-a"]);
    await expect(operations.overview(operator, "baby-b")).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await expect(operations.execute(auditor, input({ type: "invite", access: "read" }, "auditor-denied"))).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await expect(operations.read(auditor, { babyId: "baby-a", reason: "不能读取敏感原文", kind: "event", id: "any" })).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
  });
  it("global health requires a fresh administrator and contains no family or account identifiers", async () => {
    await expect(operations.health(operator)).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await expect(operations.health(auditor)).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    const report = await operations.health(admin);
    expect(report.checks.find(check => check.id === "backup")?.level).toBe("unconfigured");
    expect(report.checks.find(check => check.id === "maintenance")?.level).toBe("warning");
    expect(JSON.stringify(report)).not.toMatch(/baby-a|baby-b|synthetic.invalid|old-alice/);
    await runtime.store.payload.update({ collection: "ops-users", id: operator.id, data: { active: false }, overrideAccess: false, user: admin });
    await expect(operations.health({ ...operator, role: "administrator" })).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await runtime.store.payload.update({ collection: "ops-users", id: operator.id, data: { active: true }, overrideAccess: false, user: admin });
  });
  it("marks failed/stale host evidence and deferred cleanup honestly", async () => {
    const file = path.join(directory, "host-status.json"), health = new OperationsHealth(runtime.privacy, directory, file);
    const stamp = new Date(runtime.identity.now()).toISOString(), old = new Date(runtime.identity.now() - 31 * 3600_000).toISOString();
    await writeFile(file, JSON.stringify({ version: 1, backup: { state: "verified", at: stamp, lastVerifiedAt: stamp }, certificate: { state: "verified", at: stamp, expiresAt: new Date(runtime.identity.now() + 30 * 86400_000).toISOString() } }), { mode: 0o644 });
    let report = await health.read();
    expect(report.checks.find(check => check.id === "backup")?.level).toBe("ok");
    expect(report.checks.find(check => check.id === "certificate")?.level).toBe("ok");
    await writeFile(file, JSON.stringify({ version: 1, backup: { state: "verified", at: old, lastVerifiedAt: old }, certificate: { state: "verified", at: old, expiresAt: new Date(runtime.identity.now() + 30 * 86400_000).toISOString() } }));
    report = await health.read();
    expect(report.checks.find(check => check.id === "backup")?.level).toBe("warning");
    expect(report.checks.find(check => check.id === "certificate")?.level).toBe("critical");
    await runtime.privacy.repository.put("privacy-state", "maintenance:last", { at: stamp, report: { deferredTasks: 3 } }, {});
    expect((await health.read()).checks.find(check => check.id === "maintenance")?.message).toContain("3 项");
    await runtime.privacy.repository.put("privacy-state", "maintenance:last", { at: stamp, failed: true }, {});
    expect((await health.read()).checks.find(check => check.id === "maintenance")?.level).toBe("critical");
    await writeFile(file, JSON.stringify({ version: 1, backup: { state: "failed", at: stamp, lastVerifiedAt: old } }));
    expect((await health.read()).checks.find(check => check.id === "backup")?.level).toBe("critical");
    await writeFile(file, JSON.stringify({ version: 1, secret: "MUST-NOT-LEAK" }));
    report = await health.read();
    expect(report.checks.find(check => check.id === "host-report")?.level).toBe("critical");
    expect(JSON.stringify(report)).not.toContain("MUST-NOT-LEAK");
  });
  it("inherited BabyUser grants are visible without inventing persisted grants", async () => {
    const before = (await runtime.store.list("grants")).length;
    const overview = await operations.overview(operator, "baby-a");
    expect(overview.grants).toContainEqual(expect.objectContaining({ subjectId: identityId, source: "legacy", state: "active" }));
    expect((await runtime.store.list("grants")).length).toBe(before);
    expect(JSON.stringify(overview)).not.toMatch(/sessionId|issuerSessionId|token|contentHash/);
  });
  it("invite is issued once, stored without plaintext and survives its issuing request", async () => {
    const command = input({ type: "invite", access: "read" }, "invite-once-request");
    const issued = await operations.execute(operator, command) as { code: string };
    expect(issued.code).toHaveLength(43);
    expect(await operations.execute(operator, command)).toMatchObject({ alreadyIssued: true });
    const bob = await runtime.identity.loginLegacy("old-bob", "correct-password", "native");
    const accepted = await runtime.identity.acceptInvite(await runtime.identity.authenticate(bob.token), issued.code);
    expect(accepted.context.babies.map(baby => baby.id)).toContain("baby-a");
    const stored = await runtime.store.payload.find({ collection: "ops-requests", overrideAccess: true, limit: 100 });
    expect(JSON.stringify(stored)).not.toContain(issued.code);
  });
  it("grant mutations use existing identity service and request content cannot change", async () => {
    const command = input({ type: "grant", subjectId: identityId, state: "active", permissions: ["records:read", "media:read"] }, "scoped-grant-request");
    await operations.execute(operator, command);
    await expect(operations.execute(operator, { ...command, reason: "改变同请求号的操作" })).rejects.toMatchObject({ code: "OPS_REQUEST_REUSED" });
    expect((await runtime.store.get("grants", `${identityId}:baby-a`))?.value.permissions).toEqual(["records:read", "media:read"]);
  });
  it("binding, configure, bounded backfill and pause call real collector state transitions", async () => {
    await operations.execute(operator, input({ type: "binding", groupId: "wechat:synthetic:group@chatroom", agentId: "synthetic-collector", active: true }, "bind-group-request"));
    const configured = await operations.execute(operator, input({ type: "collector", input: { action: "configure", accountId: "synthetic", chatId: "group@chatroom", agentId: "synthetic-collector", enabled: true, intervalMs: 60000 } }, "configure-request")) as { job: { id: string } };
    await operations.execute(operator, input({ type: "collector", input: { action: "backfill", jobId: configured.job.id, range: { from: "2026-10-20T00:00:00+08:00", to: "2026-10-21T00:00:00+08:00" } } }, "backfill-request"));
    await operations.execute(operator, input({ type: "collector", input: { action: "retry", jobId: configured.job.id } }, "retry-job-request"));
    await operations.execute(operator, input({ type: "collector", input: { action: "configure", accountId: "synthetic", chatId: "group@chatroom", agentId: "synthetic-collector", enabled: false, intervalMs: 60000 } }, "pause-job-request"));
    const job = (await operations.overview(operator, "baby-a")).jobs[0]!;
    expect(job.enabled).toBe(false); expect(job.backfills).toHaveLength(1); expect(job.backfills[0]?.id).toBe("backfill-request");
  });
  it("collector credential is returned once and never grants an operator identity", async () => {
    const command = input({ type: "credential", groupId: "wechat:synthetic:group@chatroom", agentId: "synthetic-collector" }, "collector-token-once");
    const result = await operations.execute(operator, command) as { token: string };
    expect((await runtime.identity.authenticate(result.token)).kind).toBe("collector");
    expect(await operations.execute(operator, command)).not.toHaveProperty("token");
    expect(JSON.stringify(await operations.overview(operator, "baby-a"))).not.toContain(result.token);
  });
  it("record creation passes through HTTP MCP, retains unknowns and returns no session hash", async () => {
    const result = await operations.execute(operator, input({ type: "record", tool: "bubu_record_events", arguments: { events: [{ facts: { type: "DIAPER", startTime: "2026-10-22T08:00:00+08:00", hasPee: true, hasPoop: false } }] } }, "ops-create-record")) as { status: string; events: { id: string; version: number }[] };
    expect(result.status).toBe("needs_information"); eventId = result.events[0]!.id; version = result.events[0]!.version;
    expect(legacy.committedWrites).toBe(1); expect(JSON.stringify(result)).not.toMatch(/sessionId|hash|secret/);
    const overview = await operations.overview(operator, "baby-a");
    expect(overview.pending).toHaveLength(1); expect(overview.events[0]?.missing).toContain("peeAmount");
  });
  it("sensitive record and revision read is audited, correction checks versions and same-id retries do not duplicate", async () => {
    const read = await operations.read(operator, { babyId: "baby-a", reason: "照护者要求核对原始字段", kind: "event", id: eventId });
    expect(JSON.stringify(read)).toContain("hasPee"); expect(JSON.stringify(read)).not.toContain("sessionId");
    const command = input({ type: "record", tool: "bubu_update_event", arguments: { eventId, expectedVersion: version, patch: { facts: { peeAmount: "MEDIUM" } } } }, "ops-update-record");
    const result = await operations.execute(operator, command) as { events: { version: number }[] }; version = result.events[0]!.version;
    expect(await operations.execute(operator, command)).toEqual(result); expect(legacy.committedWrites).toBe(2);
    await expect(operations.execute(operator, input({ type: "record", tool: "bubu_update_event", arguments: { eventId, expectedVersion: 1, patch: { facts: { peeAmount: "LARGE" } } } }, "stale-version-request"))).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const revisions = await operations.read(operator, { babyId: "baby-a", reason: "核对原始记录修订来源", kind: "revisions", id: eventId });
    expect(Array.isArray(revisions)).toBe(true);
    expect((await runtime.store.list("audit")).some(row => row.value.action === "ops.read.event")).toBe(true);
  });
  it("attachment upload/read is private, association and retract execute MCP and refresh facts", async () => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#84b8a1" } }).png({ compressionLevel: 9 }).toBuffer();
    const uploaded = await operations.upload(operator, "baby-a", "合成图片关联验收", "ops-upload-picture", bytes, "image/png");
    expect(uploaded).not.toHaveProperty("sha256");
    const result = await operations.execute(operator, input({ type: "record", tool: "bubu_attach_images", arguments: { eventId, expectedVersion: version, attachmentIds: [uploaded.id] } }, "ops-associate-image")) as { events: { version: number }[] }; version = result.events[0]!.version;
    const image = await operations.read(operator, { babyId: "baby-a", reason: "核对合成照片原始内容", kind: "attachment", id: uploaded.id }) as { bytes: Buffer };
    expect(image.bytes.equals(bytes)).toBe(true);
    await expect(operations.read(admin, { babyId: "baby-b", reason: "验证跨宝宝图片拒绝", kind: "attachment", id: uploaded.id })).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    await operations.execute(operator, input({ type: "record", tool: "bubu_retract_event", arguments: { eventId, expectedVersion: version } }, "ops-retract-record"));
    expect(await legacy.getActivity("baby-a", eventId)).toBeNull(); expect((await operations.overview(operator, "baby-a")).pending).toHaveLength(0);
  });
  it.each(["provided", "unknown"] as const)("CMS human can resolve media as %s through MCP, while CLI cannot", async resolution => {
    const sourceId = `synthetic-media-${resolution}`, sentAt = "2026-10-22T12:00:00+08:00";
    const source = { sourceId, accountId: "synthetic", chatId: "group@chatroom", groupId: "wechat:synthetic:group@chatroom", databaseId: "synthetic.db", tableName: "messages", localId: resolution === "provided" ? 1 : 2, sentAt, senderId: "synthetic-sender", kind: "image", text: "合成待补照片", media: [{ sourceId, kind: "image", state: "unresolved" }] };
    const credential = await operations.execute(operator, input({ type: "credential", groupId: source.groupId, agentId: "synthetic-collector" }, `media-collector-${resolution}`)) as { token: string };
    const client = new ChatMcpClient(runtime.mcpUrl, credential.token);
    let created: { events: { id: string; version: number }[] };
    try {
      await client.connect();
      created = await client.call("bubu_record_events", { babyId: "baby-a", requestId: `create-media-${resolution}`, events: [{ facts: { type: "DIAPER", startTime: sentAt, hasPee: false, hasPoop: true }, sources: [{ kind: "wechat", accountId: source.accountId, groupId: source.groupId, conversationId: source.chatId, messageId: `${source.databaseId}/${source.tableName}/${source.localId}`, eventKey: resolution, sentAt, senderId: source.senderId }] }] }) as typeof created;
    } finally { await client.close(); }
    const event = created.events[0]!;
    // Seed only the collector's already-persisted unresolved source, not an alternate facts store.
    await runtime.store.transaction(req => new RecordsRepository(runtime.store.payload).put("care-messages", "baby-a", sourceId, { source, contentHash: hash(source), state: "processed", batchId: "synthetic-batch", mediaPending: true }, req));
    const args = { pendingId: `media:${sourceId}`, eventId: event.id, mediaIndex: 0, expectedVersion: event.version, resolution, attachmentId: undefined as string | undefined };
    expect((await operations.overview(operator, "baby-a")).pending).toContainEqual(expect.objectContaining({ id: args.pendingId }));
    const cli = await runtime.identity.provisionOperator("synthetic-cli", "baby-a", 60_000);
    await expect(runtime.collector.resolveMedia(await runtime.identity.authenticate(cli.token), { ...args, babyId: "baby-a", requestId: "cli-cannot-confirm", resolution: "unknown" })).rejects.toMatchObject({ code: "MEDIA_HUMAN_CONFIRMATION_REQUIRED" });
    if (resolution === "provided") {
      const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#84b8a1" } }).png({ compressionLevel: 9 }).toBuffer();
      args.attachmentId = (await operations.upload(operator, "baby-a", "合成待补照片核对", "pending-media-upload", bytes, "image/png")).id;
      await expect(operations.execute(operator, input({ type: "record", tool: "bubu_resolve_media", arguments: args }, "unlinked-media-denied"))).rejects.toMatchObject({ code: "MEDIA_ATTACHMENT_NOT_LINKED" });
      const attached = await operations.execute(operator, input({ type: "record", tool: "bubu_attach_images", arguments: { eventId: event.id, expectedVersion: event.version, attachmentIds: [args.attachmentId] } }, "attach-pending-media")) as { events: { version: number }[] };
      args.expectedVersion = attached.events[0]!.version;
    }
    const command = input({ type: "record", tool: "bubu_resolve_media", arguments: args }, `resolve-media-${resolution}`);
    expect(await operations.execute(operator, command)).toMatchObject({ state: "resolved", resolution });
    expect(await operations.execute(operator, command)).toMatchObject({ state: "resolved", resolution });
    expect((await operations.overview(operator, "baby-a")).pending).not.toContainEqual(expect.objectContaining({ id: args.pendingId }));
  });
  it("scope changes immediately invalidate retained operator delegates and stale user objects", async () => {
    const issued = await runtime.identity.provisionOperator(`ops:${operator.id}`, "baby-a", 60000, { userId: String(operator.id), permissions: ["records:read"] });
    const principal = await runtime.identity.authenticate(issued.token);
    await runtime.store.payload.update({ collection: "ops-users", id: operator.id, data: { babyIds: [] }, user: admin, overrideAccess: false });
    await expect(runtime.identity.authorize(principal, "baby-a", "records:read")).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await expect(operations.overview(operator, "baby-a")).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await runtime.store.payload.update({ collection: "ops-users", id: operator.id, data: { babyIds: ["baby-a"] }, user: admin, overrideAccess: false });
  });
  it("history report is scoped, does not rewrite facts or claim real migration", async () => {
    const report = await operations.read(operator, { babyId: "baby-a", reason: "核对合成历史导出文件", kind: "history", before: { activities: [] }, after: { activities: [] } }) as { preserved: boolean; notes: string[] };
    expect(report.preserved).toBe(true); expect(report.notes[0]).toContain("不证明");
    await expect(operations.read(operator, { babyId: "baby-a", reason: "验证不接受其他宝宝历史", kind: "history", before: { activities: [{ id: "x", babyId: "baby-b", type: "DIAPER", startTime: "2026-10-20T01:00:00Z" }] } })).rejects.toMatchObject({ code: "OPS_HISTORY_SCOPE" });
  });
  it("membership is an explicit unconfigured seam, never invents expiry or pricing", async () => {
    expect((await operations.context(operator)).membership).toEqual({ configured: false });
    await expect(operations.execute(operator, input({ type: "membership", input: {} }, "membership-no-policy"))).rejects.toMatchObject({ code: "MEMBERSHIP_NOT_CONFIGURED" });
  });
  it("untouched legacy Activity appears in the shared overview and can be corrected through MCP", async () => {
    legacy.activities.set("legacy-only", { id: "legacy-only", babyId: "baby-a", type: "PUMP", startTime: "2026-10-01T10:00:00+08:00", endTime: "2026-10-01T10:15:00+08:00", milkAmount: 0 });
    const overview = await operations.overview(operator, "baby-a");
    const old = overview.events.find(event => event.id === "legacy-only")!;
    expect(old).toMatchObject({ id: "legacy-only", type: "PUMP" });
    expect((await runtime.store.payload.find({ collection: "care-events", where: { id: { equals: "legacy-only" } }, overrideAccess: true })).totalDocs).toBe(0);
    await operations.execute(operator, input({ type: "record", tool: "bubu_update_event", arguments: { eventId: old.id, expectedVersion: old.version, patch: { facts: { milkAmount: 30 } } } }, "legacy-correction"));
    expect(await legacy.getActivity("baby-a", "legacy-only")).toMatchObject({ milkAmount: 30 });
  });
  it("only administrators can inspect account-level audit metadata", async () => {
    expect((await operations.context(admin)).accountAudit).toContainEqual(expect.objectContaining({ action: "ops.account.update" }));
    expect((await operations.context(operator)).accountAudit).toBeUndefined();
    expect((await operations.context(auditor)).accountAudit).toBeUndefined();
  });
  it("pending projection resumes the original MCP request after its temporary delegate expires", async () => {
    legacy.failStatisticsOnce = true;
    const before = legacy.committedWrites;
    const command = input({ type: "record", tool: "bubu_record_events", arguments: { events: [{ facts: { type: "PUMP", startTime: "2026-10-02T10:00:00+08:00", endTime: "2026-10-02T10:15:00+08:00", milkAmount: 35 } }] } }, "ops-projection-retry");
    const pending = await operations.execute(operator, command) as { status: string; events: { id: string }[] };
    expect(pending.status).toBe("pending_projection");
    // withPrincipal already revoked its first transport token; the stable operator identity owns recovery.
    const recovered = await operations.execute(operator, command) as typeof pending;
    expect(recovered.status).toBe("saved"); expect(recovered.events[0]!.id).toBe(pending.events[0]!.id);
    expect(legacy.committedWrites).toBe(before + 1);
    expect(await operations.execute(operator, command)).toEqual(recovered);
  });
});
