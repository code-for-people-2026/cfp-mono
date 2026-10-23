import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { createRuntime } from "../src/runtime";
import { startRuntimeServer } from "../src/server";
import { bootstrapOpsAdmin } from "../src/operations/collections";
import { permissions } from "../src/contracts";
import { ChatMcpClient } from "../src/chat/mcp";
import { RecordsLegacyFixture } from "./fixtures/records";
import { WechatFixture } from "./fixtures/identity";

if (process.env.NODE_ENV !== "test") throw new Error("The isolated operations fixture requires NODE_ENV=test.");
const directory = await mkdtemp(path.join(tmpdir(), "bubu-ops-browser-"));
const port = Number(process.env.BUBU_OPS_FIXTURE_PORT || 4357);
const origin = `http://127.0.0.1:${port}`;
const password = `Fixture-${randomBytes(18).toString("hex")}`;
const legacy = new RecordsLegacyFixture();
const options = {
  directory, secret: "isolated-ops-browser-fixture-not-production-secret",
  publicOrigin: origin, opsOrigin: origin, mcpUrl: `${origin}/api/mcp`, legacy, wechat: new WechatFixture(),
  provider: { complete: async () => ({ text: "隔离测试回复，不调用外部模型。", calls: [] }) },
};
let runtime = await createRuntime(options);
const admin = await bootstrapOpsAdmin(runtime.store.payload, { email: "admin@fixture.invalid", password, babyIds: ["baby-a", "baby-b"] });
const administrator = { id: admin.id, collection: "ops-users" as const };
const operator = await runtime.store.payload.create({ collection: "ops-users", data: { email: "operator@fixture.invalid", password, role: "operator", active: true, babyIds: ["baby-a"] }, user: administrator, overrideAccess: false });
await runtime.store.payload.create({ collection: "ops-users", data: { email: "auditor@fixture.invalid", password, role: "auditor", active: true, babyIds: ["baby-a"] }, user: administrator, overrideAccess: false });
// Exercise default Payload-cache cleanup and database reopen in the exact same Node process.
const oldPayload = runtime.store.payload;
await runtime.close();
runtime = await createRuntime(options);
assert.notEqual(runtime.store.payload, oldPayload);
assert.equal((await runtime.store.payload.count({ collection: "ops-users", overrideAccess: true })).totalDocs, 3);
const running = await startRuntimeServer(runtime, { port, production: true });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void running.close().then(() => process.exit(0)); });
try {
const aliceToken = (await runtime.identity.loginLegacy("old-alice", "correct-password", "native")).token;
const alice = await runtime.identity.authenticate(aliceToken, "bearer");
const bobToken = (await runtime.identity.loginLegacy("old-bob", "correct-password", "native")).token;
const image = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#f0cab6" } }).png().toBuffer();
const attachment = await runtime.attachments.upload(alice, "baby-a", image, "image/png", "ops-fixture-image");
const client = new ChatMcpClient(`${origin}/api/mcp`, aliceToken);
await client.connect();
const receipt = await client.call("bubu_record_events", { babyId: "baby-a", requestId: "ops-fixture-pending", events: [{ facts: { type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00", milkSource: "FORMULA" }, attachmentIds: [attachment.id], sources: [{ kind: "chat", accountId: "fixture-alice", conversationId: "fixture-private", messageId: "ops-source-1", eventKey: "feeding", sentAt: "2026-10-23T08:00:00+08:00", senderId: "synthetic-caregiver" }] }] }) as { events: Array<{ id: string; version: number }> };
await client.close();
const bobClient = new ChatMcpClient(`${origin}/api/mcp`, bobToken);
await bobClient.connect();
const secondReceipt = await bobClient.call("bubu_record_events", { babyId: "baby-b", requestId: "ops-fixture-other-baby", events: [{ facts: { type: "DIAPER", startTime: "2026-10-23T08:30:00+08:00", hasPee: true, hasPoop: false } }] }) as { events: Array<{ id: string }> };
await bobClient.close();
const issued = await runtime.identity.provisionOperator(`ops:${operator.id}`, "baby-a", 15 * 60_000, { userId: String(operator.id), permissions });
const principal = await runtime.identity.authenticate(issued.token, "bearer");
await runtime.identity.bindGroup(principal, "baby-a", "wechat:fixture-account:fixture-group@chatroom", "fixture-collector", true);
const opsClient = new ChatMcpClient(`${origin}/api/mcp`, issued.token);
await opsClient.connect();
await opsClient.call("bubu_collector", { babyId: "baby-a", action: "configure", accountId: "fixture-account", chatId: "fixture-group@chatroom", agentId: "fixture-collector", enabled: false, intervalMs: 60_000 });
await opsClient.close();
await runtime.identity.logout(principal);
const filename = path.join(directory, "fixture.json");
await writeFile(filename, JSON.stringify({ origin, directory, password, users: { admin: "admin@fixture.invalid", operator: "operator@fixture.invalid", auditor: "auditor@fixture.invalid" }, eventId: receipt.events[0]!.id, eventVersion: receipt.events[0]!.version, otherEventId: secondReceipt.events[0]!.id, attachmentId: attachment.id, aliceToken, bobToken }, null, 2), { mode: 0o600 });
console.log(`Operations browser fixture ready: ${origin}/admin; private fixture file: ${filename}`);
} catch (error) { await running.close(); throw error; }
