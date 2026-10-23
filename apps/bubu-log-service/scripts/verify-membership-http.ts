import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ChatMcpClient } from "../src/chat/mcp";
import { CollectorMcpClient, CollectorRunner } from "../src/collector/runner";
import { canonicalGroupId, type SourceMessage } from "../src/collector/types";
import { hash } from "../src/records/persistence";
import type { ChatInput, ChatTurn } from "../src/chat/contracts";
import type { MembershipStatus, MembershipPolicy } from "../src/membership/contracts";
import type { CollectorJob } from "../src/collector/service";

const filename = process.argv[2];
if (!filename) throw new Error("Pass the private fixture.json from test:fullstack-server.");
const mode = (await stat(filename)).mode & 0o777;
if (mode !== 0o600) throw new Error("The full-stack fixture metadata must be mode 0600.");
const fixture = JSON.parse(await readFile(filename, "utf8")) as { fixture: string; synthetic: boolean; origin: string; password: string; users: Record<"operator" | "auditor", string>; verification: { babyId: string; token: string } };
if (fixture.fixture !== "bubu-fullstack-fixture/v1" || fixture.synthetic !== true || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin) || !Object.values(fixture.users).every(email => email.endsWith("@fixture.invalid")) || fixture.verification.babyId !== "baby-verify") throw new Error("Only the isolated full-stack fixture is supported.");
const ready = await fetch(`${fixture.origin}/__fixture/ready`);
assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { fixture: fixture.fixture, ready: true, synthetic: true });
const { babyId, token } = fixture.verification, run = randomUUID(), scope = `babyId=${encodeURIComponent(babyId)}`;
const auth = { Authorization: `Bearer ${token}` }, origin = { Origin: fixture.origin, "Content-Type": "application/json" };
let checks = 1;
const request = (pathname: string, init?: RequestInit) => fetch(`${fixture.origin}${pathname}`, { ...init, headers: { "Sec-Fetch-Site": "same-origin", ...init?.headers } });
async function login(role: "operator" | "auditor") {
  const response = await request("/api/cms/ops-users/login", { method: "POST", headers: origin, body: JSON.stringify({ email: fixture.users[role], password: fixture.password }) });
  assert.equal(response.status, 200, `native ${role} login`); assert.ok(!("token" in await response.json())); checks++;
  return response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; ");
}
const operator = await login("operator"), auditor = await login("auditor");
const post = (command: unknown, cookie = operator, requestId = `verify-${run}-${randomUUID()}`) => request("/api/ops/action", { method: "POST", headers: { ...origin, Cookie: cookie }, body: JSON.stringify({ babyId, requestId, reason: "隔离示例端到端权益验收", command }) });
async function status(): Promise<MembershipStatus> {
  const response = await request(`/api/app/membership?${scope}`, { headers: auth });
  assert.equal(response.status, 200); return await response.json() as MembershipStatus;
}
async function membership(input: Record<string, unknown>) {
  const current = await status();
  const response = await post({ type: "membership", input: { ...input, expectedVersion: current.version } });
  assert.equal(response.status, 200, await response.clone().text()); checks++;
  return (await response.json() as { receipt: MembershipStatus }).receipt;
}
async function submit(input: ChatInput): Promise<Response> {
  return request("/api/app/chat", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(input) });
}
async function complete(input: ChatInput): Promise<ChatTurn> {
  const response = await submit(input); assert.equal(response.status, 200, await response.clone().text());
  for (let index = 0; index < 100; index++) {
    const found = await request(`/api/app/chat/request?${scope}&requestId=${encodeURIComponent(input.requestId)}`, { headers: auth });
    assert.equal(found.status, 200);
    const turn = (await found.json() as { turn: ChatTurn }).turn;
    if (turn.status === "completed") { checks++; return turn; }
    if (turn.status === "failed" || turn.status === "needs_recovery") throw new Error(`Fixture turn stopped: ${turn.error?.code || turn.status}`);
    await delay(50);
  }
  throw new Error("Fixture chat did not finish in five seconds.");
}
const message = (requestId: string, text: string): ChatInput => ({ babyId, requestId, text, attachmentIds: [], context: { viewedDate: "2026-10-23" } });
const originalResponse = await request(`/api/ops/overview?${scope}`, { headers: { Cookie: operator } });
assert.equal(originalResponse.status, 200);
const original = (await originalResponse.json() as { membership: { policy: MembershipPolicy } }).membership.policy;
const mcp = new ChatMcpClient(`${fixture.origin}/api/mcp`, token);
await mcp.connect();
let collector: CollectorMcpClient | undefined, collectorConfigured = false;
const group = { accountId: "fixture-verification", chatId: "verify-membership@chatroom", agentId: "fixture-membership-verifier" };
const groupId = canonicalGroupId(group.accountId, group.chatId);
try {
  const free = await status();
  assert.equal(free.label, "限时免费"); assert.equal(free.endsAt, null); assert.equal(free.entitlements.chat, true); assert.equal(free.entitlements.collection, true); assert.equal(free.payment.enabled, false); checks++;
  const forbidden = await post({ type: "membership", input: { action: "pause", expectedVersion: free.version } }, auditor);
  assert.equal(forbidden.status, 403); checks++;
  await membership({ action: "pause" });
  const held = message(`verify-paused-${run}`, "喝奶了");
  const denied = await submit(held); assert.equal(denied.status, 423); assert.equal((await denied.json()).retryable, true); checks++;
  await assert.rejects(mcp.call("bubu_record_events", { babyId, requestId: `verify-mcp-paused-${run}`, events: [{ facts: { type: "ROLL_OVER", startTime: "2026-10-23T06:00:00Z", count: 2 } }] }), { status: 423, code: "SERVICE_PAUSED", retryable: true }); checks++;
  for (const pathname of [`/api/app/chat?${scope}`, `/api/app/records/snapshot?${scope}&date=2026-10-23`, `/api/app/activities?${scope}`]) { assert.equal((await request(pathname, { headers: auth })).status, 200); checks++; }
  await membership({ action: "resume" });
  let turn = await complete(held);
  for (const [index, text] of ["奶瓶喂的奶粉", "泡了120，剩下20，是同一瓶", "喂了10分钟，拍出嗝"].entries()) {
    const question = turn.pending.find(value => value.kind === "fields" && "eventId" in value);
    assert.ok(question && question.kind === "fields");
    turn = await complete({ ...message(`verify-feed-${run}-${index}`, text), question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion } });
  }
  const calendar = await request(`/api/app/records/snapshot?${scope}&date=2026-10-23`, { headers: auth });
  const snapshot = await calendar.json() as { events: Array<{ facts: { milkAmount?: number } }>; summary: { metrics: { totalMilkAmount: number } } };
  assert.equal(calendar.status, 200); assert.ok(snapshot.events.some(event => event.facts.milkAmount === 100)); assert.ok(snapshot.summary.metrics.totalMilkAmount >= 100); checks++;
  const past = new Date(Date.now() - 60_000).toISOString();
  await membership({ action: "configure", startsAt: null, endsAt: past, expiryPolicy: null });
  assert.equal((await status()).entitlements.chat, true); checks++;
  await membership({ action: "configure", startsAt: null, endsAt: past, expiryPolicy: { chat: "pause", collection: "pause" } });
  const expired = await submit(message(`verify-expired-${run}`, "示例状态检查"));
  assert.equal(expired.status, 423); assert.equal((await expired.json()).code, "SERVICE_EXPIRED"); checks++;
  await membership({ action: "extend", endsAt: new Date(Date.now() + 86400_000).toISOString() });
  assert.equal((await status()).entitlements.chat, true); checks++;
  assert.equal((await post({ type: "binding", groupId, agentId: group.agentId, active: true })).status, 200);
  const configured = await post({ type: "collector", input: { action: "configure", ...group, enabled: true, intervalMs: 10_000 } });
  assert.equal(configured.status, 200); collectorConfigured = true;
  const jobId = (await configured.json() as { receipt: { job: CollectorJob } }).receipt.job.id;
  const credential = await post({ type: "credential", groupId, agentId: group.agentId }); assert.equal(credential.status, 200);
  const collectorToken = (await credential.json() as { receipt: { token: string } }).receipt.token;
  collector = new CollectorMcpClient(new URL(`${fixture.origin}/api/mcp`), async () => collectorToken); await collector.connect();
  await membership({ action: "pause" });
  await assert.rejects(collector.call("bubu_collector", { action: "begin", babyId, jobId, runId: run }), { status: 423, code: "SERVICE_PAUSED", retryable: true }); checks++;
  await membership({ action: "resume" });
  const databaseId = "message/message_0.db", tableName = `Msg_${createHash("md5").update(group.chatId).digest("hex")}`;
  const source: SourceMessage = { sourceId: `wechat:${hash(["wechat", group.accountId, databaseId, tableName, 1])}`, accountId: group.accountId, chatId: group.chatId, groupId, databaseId, tableName, localId: 1, sentAt: "2026-10-23T06:00:00Z", senderId: "example-collector-caregiver", kind: "text", text: "宝宝翻身两次（示例）", media: [] };
  const runner = new CollectorRunner(collector, { read: async input => ({ messages: input.cursor[`${databaseId}:${tableName}`] ? [] : [source], nextCursor: { [`${databaseId}:${tableName}`]: 1 }, hasMore: false }) }, { execute: async task => ({ plans: (task.messages || []).map(item => ({ key: "fixture-roll", sourceIds: [item.sourceId], tool: "bubu_record_events" as const, arguments: { events: [{ facts: { type: "ROLL_OVER", startTime: item.sentAt, count: 2 } }] } })), ignored: [] }) });
  assert.equal((await post({ type: "collector", input: { action: "retry", jobId } })).status, 200);
  assert.equal((await runner.once(babyId, jobId)).completed, true); checks++;
  const result = await collector.call("bubu_collector", { action: "status", babyId, jobId }) as { job: CollectorJob };
  assert.equal(result.job.cursor[`${databaseId}:${tableName}`], 1); checks++;
} finally {
  await collector?.close(); await mcp.close();
  // Leave the preview babies untouched and restore the verification baby's original eligibility.
  await membership({ action: "configure", startsAt: original.startsAt, endsAt: original.endsAt, expiryPolicy: original.expiryPolicy });
  await membership({ action: original.paused ? "pause" : "resume" });
  if (collectorConfigured) {
    const disabled = await post({ type: "collector", input: { action: "configure", ...group, enabled: false, intervalMs: 10_000 } });
    assert.equal(disabled.status, 200);
  }
}
console.log(`Full-stack membership HTTP checks passed: ${checks}. Real native Payload login, shared SQLite runtime, operations policy, HTTP/MCP 423, chat-to-calendar, and controlled synthetic collector. Preview baby seeds untouched; verification policy restored; collector disabled.`);
