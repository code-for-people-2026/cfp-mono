import sharp from "sharp";
import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { AppError, permissions } from "../src/contracts";
import { createHandler } from "../src/http";
import type { ChatInput, ChatProvider, ChatTurn, ProviderInput, ProviderOutput } from "../src/chat/contracts";
import { chatCollections } from "../src/chat/persistence";
import { ChatService } from "../src/chat/service";
import { CollectorRunner } from "../src/collector/runner";
import { canonicalGroupId, type SourceMessage } from "../src/collector/types";
import { hash } from "../src/records/persistence";
import type { Attachment } from "../src/records/attachments";
import type { PendingQuestion, RecordReceipt, RuleInput } from "../src/records/types";
import { chatFixture, type ChatFixture } from "./fixtures/chat";

type Step = ProviderOutput | ((input: ProviderInput) => ProviderOutput | Promise<ProviderOutput>);
class ScriptedProvider implements ChatProvider {
  readonly inputs: ProviderInput[] = [];
  private steps: Step[] = [];
  enqueue(...steps: Step[]) { this.steps.push(...steps); }
  async complete(input: ProviderInput) {
    this.inputs.push(structuredClone({ ...input, signal: undefined }));
    const step = this.steps.shift();
    if (!step) throw new Error("Unexpected model invocation: fixture plan exhausted");
    return typeof step === "function" ? step(input) : step;
  }
  tool(name: string, args: Record<string, unknown>, final = "已处理这次照护记录。") {
    this.enqueue({ text: "", calls: [{ id: `controlled-call-${this.inputs.length}-${this.steps.length}`, name, arguments: args }] }, { text: final, calls: [] });
  }
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(provider = new ScriptedProvider()) {
  const f = await chatFixture(chatCollections); cleanup.push(() => f.close());
  let chat: ChatService;
  const install = async () => {
    await f.listen();
    chat = new ChatService(f.identity, f.attachments, { mcpUrl: `${f.origin}/api/mcp`, provider });
    f.setHandler(createHandler(f.identity, f.origin, { allowedOrigins: [] }, { records: f.records, attachments: f.attachments, collector: f.collector, chat }));
  };
  await install();
  return { f, provider, get chat() { return chat; }, async restart() { await f.restart(); await install(); } };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const input = (requestId: string, text: string, extra: Partial<ChatInput> = {}): ChatInput => ({ babyId: "baby-a", requestId, text, attachmentIds: [], context: { viewedDate: "2026-10-21" }, ...extra });
const bottle = { type: "BOTTLE" as const, startTime: "2026-10-23T11:00:00+08:00", durationMinutes: 10, milkSource: "BREAST_MILK" as const, milkAmount: 100, burpSuccess: false };
const receipt = (turn: ChatTurn) => {
  const result = turn.receipts.find((value): value is RecordReceipt => "requestId" in value);
  expect(result, JSON.stringify(turn)).toBeDefined(); return result!;
};
const event = (turn: ChatTurn) => receipt(turn).events[0]!;
const question = (turn: ChatTurn) => {
  const result = turn.pending.find((value): value is PendingQuestion & { kind: "fields" } => value.kind === "fields");
  expect(result, JSON.stringify(turn)).toBeDefined(); return result!;
};
const questionInput = (value: PendingQuestion) => ({ id: value.id, questionVersion: value.version, eventVersion: value.eventVersion });
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]!.text!) as T;
}
async function read<T>(f: ChatFixture, path: string, token = f.aliceToken): Promise<T> {
  const response = await fetch(`${f.origin}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200); return await response.json() as T;
}
async function upload(f: ChatFixture, requestId: string, bytes: Buffer, token = f.aliceToken, babyId = "baby-a") {
  const response = await fetch(`${f.origin}/api/app/attachments?babyId=${babyId}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png", "X-Bubu-Request-Id": requestId }, body: new Uint8Array(bytes) });
  expect(response.status).toBe(200); return (await response.json() as { data: Attachment }).data;
}
async function answer(s: Setup, previous: ChatTurn, requestId: string, text: string, patch: RuleInput) {
  const q = question(previous);
  s.provider.tool("bubu_answer_pending", { questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch });
  return s.chat.send(s.f.alice, input(requestId, text, { question: questionInput(q) }));
}

describe("private durable chat over the real HTTP MCP and Payload boundaries", () => {
  it("keeps feeding branches, computes only same-bottle consumption and refreshes the actual day rather than the viewed date", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ intent: "feeding", facts: { startTime: "2026-10-23T11:00:00+08:00" } }] });
    const first = await s.chat.send(s.f.alice, input("chat-feeding-branch", "喝奶了"));
    expect(first.status).toBe("completed"); expect(event(first).facts.type).toBeUndefined();
    expect(question(first).fields).toContain("type"); expect(s.f.legacy.activities.size).toBe(0);
    expect(first.assistantText).toMatch(/亲喂.*奶瓶/); expect(first.assistantText).toMatch(/母乳.*奶粉/);
    const second = await answer(s, first, "chat-feeding-formula", "奶粉泡120剩20，是同一瓶", { facts: { type: "BOTTLE", milkSource: "FORMULA", preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true } });
    expect(event(second).id).toBe(event(first).id); expect(event(second).facts.milkAmount).toBe(100);
    expect(question(second).fields).toContain("endTime"); expect(question(second).fields).toContain("burpSuccess");
    expect(second.assistantText).toMatch(/实际喝入\s*100\s*毫升/);
    expect(second.assistantText).toMatch(/多久|多长|结束/); expect(second.assistantText).toContain("拍嗝");
    const third = await answer(s, second, "chat-feeding-complete", "喝了10分钟，没拍出嗝", { facts: { durationMinutes: 10, burpSuccess: false } });
    expect(third.status).toBe("completed"); expect(receipt(third).status).toBe("saved");
    expect(event(third).complete).toBe(true); expect(third.pending).toEqual([]); expect(third.refreshRequired).toBe(true);
    type Snapshot = Awaited<ReturnType<ChatFixture["records"]["query"]>>;
    const current = await read<Snapshot>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
    const browsed = await read<Snapshot>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-21");
    expect(current.events).toHaveLength(1); expect(current.summary?.metrics.totalMilkAmount).toBe(100);
    expect(browsed.events).toHaveLength(0); expect(browsed.summary?.metrics.totalMilkAmount).toBe(0);
    expect(s.f.mcpRequests.some(value => value.name === "bubu_get_rules")).toBe(true);
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_record_events")).toHaveLength(1);
    const source = event(third).sources[0]!;
    expect(source.kind).toBe("chat"); expect(source.senderId).toBe(s.f.alice.subjectId);
    expect(source.sentAt).toBe("2026-10-23T12:00:00.000Z");
    const providerText = JSON.stringify(s.provider.inputs);
    expect(providerText).toContain("Asia/Shanghai"); expect(providerText).toContain("2026-10-21");
    expect(providerText).not.toContain(s.f.aliceToken); expect(providerText).not.toContain(s.f.operatorToken);
  }, 30_000);

  it("reads authorized image bytes for vision, asks about uncertainty and replaces the old inference with the explicit answer", async () => {
    const s = await setup();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#b0a030" } }).png().toBuffer();
    const attachment = await upload(s.f, "chat-photo-original", bytes);
    s.provider.enqueue(model => {
      expect(JSON.stringify(model.messages)).toContain(`data:image/png;base64,${bytes.toString("base64")}`);
      return { text: "", calls: [{ id: "inspect-diaper", name: "bubu_record_events", arguments: { events: [{ facts: { type: "DIAPER", startTime: "2026-10-23T11:00:00+08:00", hasPoop: true, hasPee: false, poopColor: "GREEN" }, attachmentIds: [attachment.id], evidence: [{ field: "poopColor", kind: "reported", confirmed: true }] }] } }] };
    }, { text: "照片颜色仍需您确认。", calls: [] });
    const first = await s.chat.send(s.f.alice, input("chat-diaper-image", "刚换的尿布", { attachmentIds: [attachment.id] }));
    expect(event(first).attachmentIds).toEqual([attachment.id]); expect(event(first).facts.poopColor).toBeUndefined();
    expect(event(first).facts.hasPoop).toBeUndefined(); expect(event(first).facts.hasPee).toBeUndefined();
    expect(question(first).fields).toContain("hasPoop");
    expect(first.assistantText).toMatch(/有尿.*有便/);
    const branch = await answer(s, first, "chat-diaper-branch", "有便，没有尿", { facts: { hasPoop: true, hasPee: false } });
    expect(question(branch).fields).toContain("poopColor"); expect(branch.assistantText).toMatch(/便便.*什么颜色/);
    const confirmed = await answer(s, branch, "chat-diaper-confirm", "黄色的", { facts: { poopColor: "YELLOW" } });
    expect(event(confirmed).id).toBe(event(first).id); expect(event(confirmed).facts.poopColor).toBe("YELLOW");
    expect(event(confirmed).evidence.some(value => value.field === "poopColor" && value.kind === "image" && !value.confirmed)).toBe(false);
    expect(confirmed.pending).toHaveLength(0);
    const saved = await read<{ events: Array<{ attachmentIds: string[] }> }>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
    expect(saved.events[0]?.attachmentIds).toEqual([attachment.id]);
    const downloaded = await fetch(new URL(attachment.url, s.f.origin), { headers: { Authorization: `Bearer ${s.f.aliceToken}` } });
    expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect((await fetch(new URL(attachment.url, s.f.origin), { headers: { Authorization: `Bearer ${s.f.bobToken}` } })).status).toBe(403);
    const replacement = await upload(s.f, "chat-photo-replacement", await sharp({ create: { width: 8, height: 8, channels: 3, background: "#eecc55" } }).png().toBuffer());
    s.provider.tool("bubu_attach_images", { eventId: event(confirmed).id, expectedVersion: event(confirmed).version, attachmentIds: [replacement.id] });
    const replaced = await s.chat.send(s.f.alice, input("chat-photo-replace", "把照片换成这一张", { attachmentIds: [replacement.id], context: { viewedDate: "2026-10-23", selectedEventId: event(confirmed).id } }));
    expect(event(replaced).attachmentIds).toEqual([replacement.id]);
    s.provider.tool("bubu_attach_images", { eventId: event(replaced).id, expectedVersion: event(replaced).version, attachmentIds: [] });
    const removed = await s.chat.send(s.f.alice, input("chat-photo-remove", "移除这条记录照片", { context: { viewedDate: "2026-10-23", selectedEventId: event(replaced).id } }));
    expect(event(removed).attachmentIds).toEqual([]);
  }, 30_000);

  it("reauthorizes the previous and selected event photos for later vision turns without persisting image bytes", async () => {
    const s = await setup();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#aabb33" } }).png().toBuffer();
    const attachment = await upload(s.f, "chat-revisited-image", bytes), imageUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    s.provider.enqueue({ text: "请描述这张照片需要记录的事情。", calls: [] });
    await s.chat.send(s.f.alice, input("chat-first-image-only", "我先发张照片", { attachmentIds: [attachment.id] }));
    s.provider.enqueue(model => {
      expect(JSON.stringify(model.messages)).toContain(imageUrl);
      return { text: "这张照片的颜色需要您核对。", calls: [] };
    });
    expect((await s.chat.send(s.f.alice, input("chat-revisit-last-image", "再看一下刚才那张照片"))).status).toBe("completed");
    const client = await s.f.connect();
    const recorded = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "chat-select-existing-photo", events: [{ facts: { type: "DIAPER", startTime: bottle.startTime, hasPee: false, hasPoop: true, poopColor: "YELLOW" }, attachmentIds: [attachment.id] }] });
    const invite = await s.f.identity.invite(s.f.operator, "baby-a", "write"); await s.f.identity.acceptInvite(s.f.bob, invite.code);
    s.provider.enqueue(model => {
      expect(JSON.stringify(model.messages)).toContain(imageUrl);
      expect(JSON.stringify(model.messages)).not.toContain("我先发张照片");
      return { text: "正在核对所选记录的照片。", calls: [] };
    });
    const selected = await s.chat.send(s.f.bob, input("chat-selected-event-image", "看一下这条记录的照片", { context: { viewedDate: "2026-10-23", selectedEventId: recorded.events[0]!.id } }));
    expect(selected.status).toBe("completed");
    const persisted = await s.f.store.payload.find({ collection: "chat-turns", pagination: false, limit: 0, overrideAccess: true });
    expect(JSON.stringify(persisted.docs)).not.toContain("data:image/");
    expect(JSON.stringify(persisted.docs)).not.toContain(bytes.toString("base64"));
    await s.f.identity.setGrant(s.f.operator, "baby-a", s.f.bob.subjectId, "revoked");
    const before = s.provider.inputs.length;
    await expect(s.chat.send(s.f.bob, input("chat-revoked-photo-read", "再看这张图", { context: { viewedDate: "2026-10-23", selectedEventId: recorded.events[0]!.id } }))).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    expect(s.provider.inputs).toHaveLength(before);
  }, 30_000);

  it("does not require choosing among a record's photos before an explicit non-visual deletion", async () => {
    const s = await setup(), client = await s.f.connect();
    const ids: string[] = [];
    for (const [index, background] of ["#aabb33", "#bbcc44", "#ccdd55", "#ddee66"].entries()) {
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer();
      ids.push((await upload(s.f, `chat-multiple-photo-${index}`, bytes)).id);
    }
    const original = (await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "chat-many-photo-record", events: [{ facts: { type: "DIAPER", startTime: bottle.startTime, hasPee: false, hasPoop: true, poopColor: "YELLOW" }, attachmentIds: ids }] })).events[0]!;
    s.provider.tool("bubu_retract_event", { eventId: original.id });
    const removed = await s.chat.send(s.f.alice, input("chat-delete-many-photo-event", "删除这条误记", { context: { viewedDate: "2026-10-23", selectedEventId: original.id } }));
    expect(removed.status).toBe("completed"); expect(event(removed).lifecycle).toBe("retracted");
    expect(s.f.legacy.activities.size).toBe(0);
  }, 30_000);

  it("allows explicitly removing an unavailable attachment without requiring the missing image to be viewed", async () => {
    const s = await setup(), client = await s.f.connect();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#aabb33" } }).png().toBuffer();
    const attachment = await upload(s.f, "chat-unavailable-image", bytes);
    const original = (await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "chat-missing-photo-record", events: [{ facts: { type: "DIAPER", startTime: bottle.startTime, hasPee: false, hasPoop: true, poopColor: "YELLOW" }, attachmentIds: [attachment.id] }] })).events[0]!;
    await unlink(path.join(s.f.directory, "private-attachments", hash("baby-a"), attachment.sha256));
    s.provider.tool("bubu_attach_images", { eventId: original.id, attachmentIds: [] });
    const removed = await s.chat.send(s.f.alice, input("chat-remove-missing-photo", "这张照片打不开了，移除这条记录的照片", { context: { viewedDate: "2026-10-23", selectedEventId: original.id } }));
    expect(removed.status).toBe("completed"); expect(event(removed).attachmentIds).toEqual([]);
    expect(s.f.legacy.activities.size).toBe(1);
  }, 30_000);

  it("restores offline group questions after restart and answers the same event without sharing personal chat text", async () => {
    const s = await setup();
    await s.f.identity.bindGroup(s.f.operator, "baby-a", "account:chat-test-group", "chat-test-collector", true);
    const token = (await s.f.identity.issueAgent(s.f.operator, "baby-a", "collector", { groupId: "account:chat-test-group", agentId: "chat-test-collector" })).token;
    const collector = await s.f.connect(token);
    const original = await call<RecordReceipt>(collector, "bubu_record_events", { babyId: "baby-a", requestId: "offline-group-feeding", events: [{ facts: { ...bottle, milkAmount: null }, sources: [{ kind: "wechat", accountId: "account", conversationId: "account:chat-test-group", messageId: "group-message-1", eventKey: "feed", sentAt: bottle.startTime, senderId: "group-sender", groupId: "account:chat-test-group" }] }] });
    await s.restart();
    const history = await s.chat.history(s.f.alice, "baby-a");
    expect(history.turns).toEqual([]); expect(history.pendingCount).toBe(1);
    const q = history.pending.find((value): value is PendingQuestion & { kind: "fields" } => value.kind === "fields")!;
    expect(q.eventId).toBe(original.events[0]!.id);
    const invite = await s.f.identity.invite(s.f.operator, "baby-a", "write");
    await s.f.identity.acceptInvite(s.f.bob, invite.code);
    expect((await s.chat.history(s.f.bob, "baby-a")).pendingCount).toBe(1);
    s.provider.tool("bubu_answer_pending", { questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch: { facts: { milkAmount: 100 } } });
    const completed = await s.chat.send(s.f.alice, input("group-chat-complete", "实际喝了100，我自己的私人备注", { question: questionInput(q) }));
    expect(event(completed).id).toBe(original.events[0]!.id); expect(s.f.legacy.activities.size).toBe(1);
    const bobHistory = await s.chat.history(s.f.bob, "baby-a");
    expect(bobHistory.turns).toEqual([]); expect(bobHistory.pendingCount).toBe(0);
    expect(JSON.stringify(bobHistory)).not.toContain("私人备注");
    s.provider.tool("bubu_answer_pending", { questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch: { facts: { milkAmount: 120 } } });
    const stale = await s.chat.send(s.f.bob, input("group-stale-answer", "其实是120", { question: questionInput(q) }));
    expect(stale.status).toBe("failed"); expect(stale.error?.code).toBe("QUESTION_STALE");
    expect([...s.f.legacy.activities.values()][0]?.milkAmount).toBe(100);
  }, 30_000);

  it("accepts explicitly unknown answers without turning them into zero or repeatedly asking", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "BOTTLE", startTime: bottle.startTime, milkSource: "BREAST_MILK" } }] });
    const first = await s.chat.send(s.f.alice, input("chat-unknown-create", "瓶喂了母乳"));
    const completed = await answer(s, first, "chat-unknown-answer", "奶量、时长和拍嗝都不知道", { facts: {}, states: { milkAmount: "unknown", durationMinutes: "unknown", endTime: "unknown", burpSuccess: "unknown" } });
    expect(completed.pending).toHaveLength(0); expect(event(completed).complete).toBe(false);
    expect(event(completed).facts.milkAmount).toBeUndefined(); expect(event(completed).states.milkAmount).toBe("unknown");
    await s.restart(); expect((await s.chat.history(s.f.alice, "baby-a")).pendingCount).toBe(0);
    const snapshot = await read<{ summary: { coverage: { unknownFields: number }; byType: { BOTTLE: { unknownMilkAmounts: number } } } }>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
    expect(snapshot.summary.byType.BOTTLE.unknownMilkAmounts).toBe(1);
  }, 30_000);

  it("cannot bypass a pending answer's version by switching to the generic update tool after another caregiver answers", async () => {
    const s = await setup(), client = await s.f.connect();
    const initial = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "racing-pending-original", events: [{ facts: { ...bottle, milkAmount: null } }] });
    const q = initial.questions[0]!;
    const invite = await s.f.identity.invite(s.f.operator, "baby-a", "write"); await s.f.identity.acceptInvite(s.f.bob, invite.code);
    const other = await s.f.connect(s.f.bobToken);
    s.provider.enqueue(async () => {
      const latest = await call<RecordReceipt>(other, "bubu_answer_pending", { babyId: "baby-a", requestId: "other-racing-answer", questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch: { facts: { milkAmount: 100 } } });
      return { text: "", calls: [{ id: "bypass-answer-version", name: "bubu_update_event", arguments: { eventId: latest.events[0]!.id, expectedVersion: latest.events[0]!.version, patch: { facts: { milkAmount: 120 } } } }] };
    });
    const result = await s.chat.send(s.f.alice, input("chat-racing-old-answer", "120ml", { question: questionInput(q) }));
    expect(result.status).toBe("failed"); expect(result.error?.code).toBe("CHAT_ANSWER_REQUIRED");
    expect([...s.f.legacy.activities.values()][0]?.milkAmount).toBe(100);
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_update_event")).toHaveLength(0);
  }, 30_000);

  it("handles unavailable group media separately from field questions and preserves explicit inability to provide it", async () => {
    const s = await setup();
    const accountId = "synthetic-chat-account", chatId = "synthetic-chat-group@chatroom", databaseId = "message/message_0.db";
    const groupId = canonicalGroupId(accountId, chatId), tableName = `Msg_${createHash("md5").update(chatId).digest("hex")}`;
    await s.f.identity.bindGroup(s.f.operator, "baby-a", groupId, "chat-media-collector", true);
    const token = (await s.f.identity.issueAgent(s.f.operator, "baby-a", "collector", { groupId, agentId: "chat-media-collector" })).token;
    const client = await s.f.connect(token), operator = await s.f.connect(s.f.operatorToken);
    const configured = await call<{ job: { id: string } }>(operator, "bubu_collector", { action: "configure", babyId: "baby-a", accountId, chatId, agentId: "chat-media-collector", enabled: true });
    const sourceId = `wechat:${hash(["wechat", accountId, databaseId, tableName, 1])}`;
    const message: SourceMessage = { sourceId, accountId, chatId, databaseId, tableName, groupId, localId: 1, sentAt: bottle.startTime, senderId: "synthetic-caregiver", kind: "image", text: "有尿，无便，尿量少，图片暂时无法读取", media: [{ sourceId, kind: "image", state: "unresolved", reason: "EXACT_PATH_REQUIRED" }] };
    const runner = new CollectorRunner({ call: (name, args) => call(client, name, args), tools: async () => (await client.listTools()).tools },
      { read: async () => ({ messages: [message], nextCursor: { [`${databaseId}:${tableName}`]: 1 }, hasMore: false }) },
      { execute: async () => ({ plans: [{ key: "media-diaper", sourceIds: [sourceId], tool: "bubu_record_events", arguments: { events: [{ facts: { type: "DIAPER", startTime: message.sentAt, hasPee: true, hasPoop: false, peeAmount: "SMALL" } }] } }], ignored: [] }) });
    expect(await runner.once("baby-a", configured.job.id)).toMatchObject({ completed: true });
    await s.restart();
    const history = await s.chat.history(s.f.alice, "baby-a");
    const media = history.pending.find(value => value.kind === "media")!;
    expect(media.kind).toBe("media"); if (media.kind !== "media") throw new Error("Expected media question");
    expect(media.eventIds).toHaveLength(1);
    s.provider.tool("bubu_resolve_media", { pendingId: media.id, eventId: media.eventIds[0], resolution: "unknown" });
    const resolved = await s.chat.send(s.f.alice, input("chat-media-unavailable", "这张照片我找不到了", { context: { viewedDate: "2026-10-23", mediaPendingId: media.id } }));
    expect(resolved.status).toBe("completed"); expect(resolved.pending).toHaveLength(0);
    expect(resolved.receipts).toContainEqual(expect.objectContaining({ kind: "media", state: "resolved", resolution: "unknown" }));
    expect(s.f.mcpRequests.some(value => value.name === "bubu_answer_pending")).toBe(false);
    expect([...s.f.legacy.activities.values()][0]?.poopPhotoUrl).toBeUndefined();
    await s.restart(); expect((await s.chat.history(s.f.alice, "baby-a")).pendingCount).toBe(0);
  }, 30_000);

  it("passes all 15 activity branches through the shared rules without introducing default quantities", async () => {
    const s = await setup();
    const variants: RuleInput["facts"][] = [
      { type: "BREASTFEED", durationMinutes: 10, burpSuccess: false, breastFirmness: "SOFT" },
      { type: "BOTTLE", durationMinutes: 10, milkSource: "FORMULA", preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true, burpSuccess: false },
      { type: "PUMP", durationMinutes: 10, milkAmount: 70 }, { type: "SLEEP", durationMinutes: 10 },
      { type: "DIAPER", hasPee: true, hasPoop: false, peeAmount: "SMALL" },
      { type: "HEAD_LIFT", durationMinutes: 10 }, { type: "PASSIVE_EXERCISE", durationMinutes: 10 },
      { type: "GAS_EXERCISE", durationMinutes: 10 }, { type: "BATH", durationMinutes: 10 },
      { type: "OUTDOOR", durationMinutes: 10 }, { type: "EARLY_EDUCATION", durationMinutes: 10 },
      { type: "ROLL_OVER", count: 0 }, { type: "PULL_TO_SIT", count: 2 },
      { type: "SUPPLEMENT", supplementType: "D3" }, { type: "SPIT_UP", spitUpType: "NORMAL" },
    ];
    for (const [index, facts] of variants.entries()) {
      const startTime = new Date(Date.parse("2026-10-22T00:00:00+08:00") + index * 3_600_000).toISOString();
      s.provider.tool("bubu_record_events", { events: [{ facts: { ...facts, startTime } }] });
      const saved = await s.chat.send(s.f.alice, input(`chat-activity-${facts.type}`, `记录本次 ${facts.type}`, { context: { viewedDate: "2026-10-22" } }));
      expect(saved.status, JSON.stringify(saved)).toBe("completed");
      expect(event(saved).complete, JSON.stringify(saved)).toBe(true);
    }
    expect(s.f.legacy.activities.size).toBe(15);
    const client = await s.f.connect();
    const summary = await call<{ metrics: { totalMilkAmount: number } }>(client, "bubu_get_summary", { babyId: "baby-a", date: "2026-10-22" });
    expect(summary.metrics.totalMilkAmount).toBe(100);
    expect([...s.f.legacy.activities.values()].find(value => value.type === "ROLL_OVER")?.count).toBe(0);
  }, 60_000);

  it("queries the committed request after a lost MCP response and does not execute another business write", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: bottle }] });
    s.f.loseToolResponseOnce("bubu_record_events");
    const request = input("chat-network-lost", "刚才母乳瓶喂100ml，10分钟，没有拍嗝");
    const first = await s.chat.send(s.f.alice, request);
    expect(s.f.legacy.committedWrites).toBe(1);
    const planned = s.f.mcpRequests.find(value => value.name === "bubu_record_events")!;
    expect(typeof planned.arguments.requestId).toBe("string");
    await s.restart();
    const restored = await s.chat.request(s.f.alice, "baby-a", request.requestId);
    expect(restored?.id).toBe(first.id);
    const recovered = await s.chat.send(s.f.alice, request);
    expect(recovered.status).toBe("completed"); expect(event(recovered).facts.milkAmount).toBe(100);
    expect(s.f.legacy.committedWrites).toBe(1); expect(s.f.legacy.activities.size).toBe(1);
    const recovery = s.f.mcpRequests.filter(value => value.name === "bubu_get_request");
    expect(recovery.some(value => value.arguments.requestId === planned.arguments.requestId)).toBe(true);
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_record_events")).toHaveLength(1);
    expect(s.provider.inputs).toHaveLength(2);
  }, 30_000);

  it("keeps a completed candidate in duplicate review and merges only after the user's explicit confirmation", async () => {
    const s = await setup(), client = await s.f.connect();
    const existing = (await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "other-entry-existing", events: [{ facts: bottle }] })).events[0]!;
    s.provider.tool("bubu_record_events", { events: [{ intent: "feeding", facts: { startTime: bottle.startTime } }] });
    const partial = await s.chat.send(s.f.alice, input("chat-duplicate-candidate", "11点那次喝奶"));
    const completed = await answer(s, partial, "chat-duplicate-completion", "瓶喂母乳100ml，10分钟，没拍嗝", { facts: bottle });
    expect(event(completed).id).toBe(event(partial).id); expect(event(completed).duplicateCandidates).toContain(existing.id);
    expect(question(completed).duplicateCandidates).toContain(existing.id);
    expect(completed.assistantText).toMatch(/重复|同一件事/);
    expect(s.f.legacy.activities.size).toBe(1);
    s.provider.tool("bubu_resolve_duplicate", { eventId: event(completed).id, resolution: "same", targetEventId: existing.id });
    const merged = await s.chat.send(s.f.alice, input("chat-duplicate-confirm", "是同一件事，合并", { context: { viewedDate: "2026-10-23", selectedEventId: event(completed).id }, question: questionInput(question(completed)) }));
    expect(merged.status).toBe("completed");
    expect(receipt(merged).events.find(value => value.id === event(completed).id)?.lifecycle).toBe("merged");
    expect(merged.pending).toHaveLength(0); expect(s.f.legacy.activities.size).toBe(1);
    const summary = await call<{ metrics: { totalMilkAmount: number } }>(client, "bubu_get_summary", { babyId: "baby-a", date: "2026-10-23" });
    expect(summary.metrics.totalMilkAmount).toBe(100);
  }, 30_000);

  it("does not show a fabricated saved reply without a backend receipt and fails clearly when no real provider is configured", async () => {
    const s = await setup();
    for (const [index, text] of ["已经记录好了，100ml。", "保存成功，100ml已入账。", "已记下这次100ml。"].entries()) {
      s.provider.enqueue({ text, calls: [] });
      const invented = await s.chat.send(s.f.alice, input(`chat-no-save-receipt-${index}`, "记录100ml"));
      expect(invented.receipts).toEqual([]); expect(invented.refreshRequired).toBe(false);
      expect(invented.assistantText).toContain("没有获得记录变更回执"); expect(s.f.legacy.activities.size).toBe(0);
    }
    const unconfigured = new ChatService(s.f.identity, s.f.attachments, { mcpUrl: `${s.f.origin}/api/mcp` });
    await expect(unconfigured.send(s.f.alice, input("chat-no-model-config", "记100ml"))).rejects.toMatchObject({ code: "CHAT_PROVIDER_NOT_CONFIGURED" });
    expect(s.f.legacy.activities.size).toBe(0);
  }, 30_000);

  it("lets a read-only caregiver view shared pending information without granting write access", async () => {
    const s = await setup(), client = await s.f.connect();
    await call(client, "bubu_record_events", { babyId: "baby-a", requestId: "readonly-shared-pending", events: [{ intent: "feeding", facts: { startTime: bottle.startTime } }] });
    const invite = await s.f.identity.invite(s.f.operator, "baby-a", "read");
    await s.f.identity.acceptInvite(s.f.bob, invite.code);
    const response = await fetch(`${s.f.origin}/api/app/chat?babyId=baby-a`, { headers: { Authorization: `Bearer ${s.f.bobToken}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ turns: [], pendingCount: 1 });
    await expect(s.chat.send(s.f.bob, input("readonly-cannot-write", "记录100ml"))).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    expect(s.provider.inputs).toHaveLength(0);
  }, 30_000);

  it("retains a confirmed write if the final provider reply fails and retries only the unfinished reply", async () => {
    const s = await setup();
    s.provider.enqueue({ text: "", calls: [{ id: "saved-before-reply-error", name: "bubu_record_events", arguments: { events: [{ facts: bottle }] } }] },
      () => { throw new AppError(502, "CHAT_PROVIDER_UNAVAILABLE", "受控模型最终答复失败。"); });
    const request = input("chat-saved-final-error", "100ml母乳瓶喂10分钟，没拍嗝");
    const partial = await s.chat.send(s.f.alice, request);
    expect(partial.status).toBe("failed"); expect(partial.error?.retryable).toBe(true);
    expect(partial.refreshRequired).toBe(true); expect(event(partial).facts.milkAmount).toBe(100);
    expect(partial.assistantText).toMatch(/已记录.*100/); expect(s.f.legacy.committedWrites).toBe(1);
    await s.restart();
    s.provider.enqueue({ text: "已核对。", calls: [] });
    const recovered = await s.chat.send(s.f.alice, request);
    expect(recovered.status).toBe("completed"); expect(event(recovered).id).toBe(event(partial).id);
    expect(s.f.legacy.committedWrites).toBe(1);
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_record_events")).toHaveLength(1);
  }, 30_000);

  it("discards an in-flight logged-out reply and lets the same caregiver recover the original turn after login", async () => {
    const s = await setup();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), continuation = new Promise<void>(resolve => { release = resolve; });
    s.provider.enqueue(async () => { enter(); await continuation; return { text: "", calls: [{ id: "logged-out-call", name: "bubu_record_events", arguments: { events: [{ facts: bottle }] } }] }; });
    const request = input("chat-logout-in-flight", "记录100ml母乳瓶喂10分钟，没拍嗝");
    const sending = s.chat.send(s.f.alice, request);
    const rejected = expect(sending).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await entered; await s.f.identity.logout(s.f.alice); release(); await rejected;
    expect(s.f.legacy.activities.size).toBe(0);
    const token = (await s.f.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    const principal = await s.f.identity.authenticate(token, "bearer");
    const history = await s.chat.history(principal, "baby-a");
    expect(history.turns[0]?.status).toBe("needs_recovery");
    s.provider.tool("bubu_record_events", { events: [{ facts: bottle }] });
    const recovered = await s.chat.send(principal, request);
    expect(recovered.status).toBe("completed"); expect(s.f.legacy.committedWrites).toBe(1);
    s.provider.enqueue({ text: "可以继续说明。", calls: [] });
    expect((await s.chat.send(principal, input("chat-after-login-recovery", "继续"))).status).toBe("completed");
  }, 30_000);

  it("persists HTTP sends, isolates request IDs by caregiver and baby, and rejects forged client context", async () => {
    const s = await setup();
    s.provider.enqueue({ text: "请描述要记录的事情。", calls: [] });
    const body = input("same-private-request", "这是只有我看到的聊天草稿");
    const response = await fetch(`${s.f.origin}/api/app/chat`, { method: "POST", headers: { Authorization: `Bearer ${s.f.aliceToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    await expect.poll(async () => (await read<{ turn: ChatTurn }>(s.f, `/api/app/chat/request?babyId=baby-a&requestId=${body.requestId}`)).turn.status).toBe("completed");
    expect((await read<{ turns: ChatTurn[] }>(s.f, "/api/app/chat?babyId=baby-a")).turns).toHaveLength(1);
    expect((await fetch(`${s.f.origin}/api/app/chat?babyId=baby-a`, { headers: { Authorization: `Bearer ${s.f.bobToken}` } })).status).toBe(403);
    const invite = await s.f.identity.invite(s.f.operator, "baby-a", "write"); await s.f.identity.acceptInvite(s.f.bob, invite.code);
    s.provider.enqueue({ text: "这是一段独立会话。", calls: [] });
    const other = await s.chat.send(s.f.bob, input(body.requestId, "另一位照护者的信息"));
    expect(other.conversationId).not.toBe((await s.chat.request(s.f.alice, "baby-a", body.requestId))!.conversationId);
    expect(JSON.stringify(await s.chat.history(s.f.bob, "baby-a"))).not.toContain("只有我看到");
    const opB = await s.f.identity.authenticate((await s.f.identity.provisionOperator("chat-test-operator-b", "baby-b", 3_600_000)).token, "bearer");
    await s.f.identity.setGrant(opB, "baby-b", s.f.alice.subjectId, "active", permissions);
    expect((await s.chat.history(s.f.alice, "baby-b")).turns).toEqual([]);
    expect(await s.chat.request(s.f.alice, "baby-b", body.requestId)).toBeNull();
    const forged = await fetch(`${s.f.origin}/api/app/chat`, { method: "POST", headers: { Authorization: `Bearer ${s.f.aliceToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestId: "forged-chat-context", actor: { kind: "operator" }, source: { kind: "wechat" } }) });
    expect(forged.status).toBe(400); expect(s.f.legacy.activities.size).toBe(0);
    await s.restart();
    expect((await s.chat.history(s.f.alice, "baby-a")).turns[0]?.input.text).toBe(body.text);
    expect((await s.chat.history(s.f.alice, "baby-b")).turns).toEqual([]);
  }, 30_000);

  it("modifies the selected event, deletes it and undoes the deletion using only backend receipts", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: bottle }] });
    const created = await s.chat.send(s.f.alice, input("chat-edit-create", "记录母乳瓶喂100ml，10分钟，没拍嗝"));
    let current = event(created);
    const context = { viewedDate: "2026-10-23", selectedEventId: current.id };
    s.provider.tool("bubu_update_event", { eventId: current.id, expectedVersion: current.version, patch: { facts: { milkAmount: 80 } } });
    const changed = await s.chat.send(s.f.alice, input("chat-edit-correction", "这条改为80ml", { context }));
    current = event(changed); expect(current.facts.milkAmount).toBe(80); expect(changed.refreshRequired).toBe(true);
    s.provider.tool("bubu_retract_event", { eventId: current.id, expectedVersion: current.version });
    const deleted = await s.chat.send(s.f.alice, input("chat-edit-delete", "删除这条误记", { context }));
    current = event(deleted); expect(current.lifecycle).toBe("retracted"); expect(s.f.legacy.activities.size).toBe(0);
    const client = await s.f.connect();
    const revisions = await call<Array<{ id: string; version: number }>>(client, "bubu_get_revisions", { babyId: "baby-a", eventId: current.id });
    const revision = revisions.find(value => value.version === current.version)!;
    s.provider.tool("bubu_undo_event", { eventId: current.id, expectedVersion: current.version, revisionId: revision.id });
    const restored = await s.chat.send(s.f.alice, input("chat-edit-undo", "撤销刚才的删除", { context }));
    expect(event(restored).lifecycle).toBe("active"); expect(event(restored).facts.milkAmount).toBe(80);
    expect(s.f.legacy.activities.size).toBe(1);
  }, 30_000);

  it("owns provenance and scope even when the model supplies forged IDs, and refuses another baby's image before calling the model", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { babyId: "baby-b", requestId: "model-chosen-request", actor: { kind: "operator" }, events: [{ facts: bottle, sources: [{ kind: "wechat", senderId: "forged-sender" }] }] });
    const saved = await s.chat.send(s.f.alice, input("chat-trusted-context", "记录100ml母乳瓶喂，10分钟，没拍嗝"));
    expect(saved.status).toBe("completed"); expect(event(saved).babyId).toBe("baby-a");
    expect(event(saved).sources[0]).toMatchObject({ kind: "chat", senderId: s.f.alice.subjectId, accountId: s.f.alice.subjectId });
    const mutation = s.f.mcpRequests.find(value => value.name === "bubu_record_events")!;
    expect(mutation.arguments.babyId).toBe("baby-a"); expect(mutation.arguments.requestId).not.toBe("model-chosen-request");
    expect(JSON.stringify(mutation.arguments)).not.toContain("forged-sender");
    expect(await s.f.legacy.listActivities("baby-b")).toEqual([]);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#7799aa" } }).png().toBuffer();
    const otherPhoto = await upload(s.f, "other-baby-private-image", bytes, s.f.bobToken, "baby-b");
    const before = s.provider.inputs.length;
    const denied = await s.chat.send(s.f.alice, input("cross-baby-chat-image", "看这张图", { attachmentIds: [otherPhoto.id] }));
    expect(denied.status).toBe("failed"); expect(denied.error?.code).toBe("ATTACHMENT_NOT_FOUND");
    expect(s.provider.inputs).toHaveLength(before);
  }, 30_000);

  it("rechecks authorization after an asynchronous model response before writing any baby fact", async () => {
    const s = await setup();
    let continueModel!: () => void, enteredModel!: () => void;
    const entered = new Promise<void>(resolve => { enteredModel = resolve; });
    const continuation = new Promise<void>(resolve => { continueModel = resolve; });
    s.provider.enqueue(async () => { enteredModel(); await continuation; return { text: "", calls: [{ id: "revoked-call", name: "bubu_record_events", arguments: { events: [{ facts: bottle }] } }] }; });
    const pending = s.chat.send(s.f.alice, input("chat-revoked-flight", "记一条母乳瓶喂100ml"));
    await entered;
    await s.f.identity.setGrant(s.f.operator, "baby-a", s.f.alice.subjectId, "revoked");
    continueModel();
    await expect(pending).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    expect(s.f.legacy.activities.size).toBe(0);
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_record_events")).toHaveLength(0);
  }, 30_000);
});
