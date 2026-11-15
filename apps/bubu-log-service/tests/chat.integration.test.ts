import sharp from "sharp";
import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { AppError, permissions } from "../src/contracts";
import { createHandler } from "../src/http";
import type { ChatFieldPending, ChatInput, ChatProvider, ChatTurn, ProviderInput, ProviderOutput } from "../src/chat/contracts";
import { chatCollections } from "../src/chat/persistence";
import { ChatService } from "../src/chat/service";
import { CollectorRunner } from "../src/collector/runner";
import { canonicalGroupId, type SourceMessage } from "../src/collector/types";
import { hash } from "../src/records/persistence";
import type { Attachment } from "../src/records/attachments";
import type { PendingQuestion, RecordReceipt, RuleInput, RulePatch } from "../src/records/types";
import type { PreferenceMutationReceipt } from "../src/records/preferences";
import { chatFixture, type ChatFixture } from "./fixtures/chat";
import { ChatRepository, type StoredTurn } from "../src/chat/persistence";

type Step = ProviderOutput | ((input: ProviderInput) => ProviderOutput | Promise<ProviderOutput>);
const reply = (text: string, questions: unknown[] = []) => JSON.stringify({ text, questions });
class ScriptedProvider implements ChatProvider {
  readonly inputs: ProviderInput[] = [];
  private steps: Step[] = [];
  private verdicts: string[][] = [];
  enqueue(...steps: Step[]) { this.steps.push(...steps); }
  validate(...issues: string[]) { this.verdicts.push(issues); }
  async complete(input: ProviderInput) {
    this.inputs.push(structuredClone({ ...input, signal: undefined }));
    if (input.responseFormat?.name === "bubu_reply_verdict") {
      const issues = this.verdicts.shift() ?? [];
      return { text: JSON.stringify({ verdict: issues.length ? "fail" : "pass", issues }), calls: [] };
    }
    const step = this.steps.shift();
    if (!step) throw new Error("Unexpected model invocation: fixture plan exhausted");
    const output = typeof step === "function" ? await step(input) : step;
    return !output.calls.length && input.responseFormat?.name === "bubu_chat_reply" && !output.text.trim().startsWith("{") ? { ...output, text: reply(output.text) } : output;
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
const bottle = { type: "BOTTLE" as const, startTime: "2026-10-23T11:00:00+08:00", milkItems: [{ id: "milk-1", milkSource: "BREAST_MILK" as const, milkAmount: 100 }], burpSuccess: false };
const receipt = (turn: ChatTurn) => {
  const result = turn.receipts.find((value): value is RecordReceipt => "requestId" in value);
  expect(result, JSON.stringify(turn)).toBeDefined(); return result!;
};
const event = (turn: ChatTurn) => receipt(turn).events[0]!;
const question = (turn: ChatTurn) => {
  const result = turn.pending.find((value): value is ChatFieldPending => value.kind === "fields");
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
async function answer(s: Setup, previous: ChatTurn, requestId: string, text: string, patch: RulePatch) {
  const q = question(previous);
  s.provider.tool("bubu_answer_pending", { questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch });
  return s.chat.send(s.f.alice, input(requestId, text, { question: questionInput(q) }));
}

describe("private durable chat over the real HTTP MCP and Payload boundaries", () => {
  it("records the exact multi-milk text as one complete meal with no follow-up", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "BOTTLE", milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
      { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] }, progress: "ended" }] }, "这餐已按两个奶品明细记录。羊奶 200 毫升、奶粉 150 毫升，整餐合计 350 毫升。");
    const turn = await s.chat.send(s.f.alice, input("chat-exact-multi-milk", "晚上喝奶 200 羊奶，150 奶粉"));
    expect(turn.status).toBe("completed");
    expect(receipt(turn)).toMatchObject({ status: "saved", questions: [], events: [{ complete: true, facts: { milkAmount: 350, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
      { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] } }] });
    expect(turn.pending).toEqual([]);
    expect(turn.replyQuestions).toEqual([]);
    expect(turn.assistantText).toContain("350");
    expect((await s.f.records.query(s.f.alice, { babyId: "baby-a" })).activities).toHaveLength(1);
  });

  it("never publishes regenerated or fallback milk/time questions after a complete meal", async () => {
    const meal = { events: [{ facts: { type: "BOTTLE", milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 }, { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] } }] };
    const questionCandidate = reply("记录已经完成。", [{ id: "stale-milk", prompt: "这餐奶量是多少？", choices: [
      { id: "a", label: "350 毫升", action: { type: "reply", text: "这餐是350毫升" } },
      { id: "b", label: "其他奶量", action: { type: "reply", text: "这餐是其他奶量" } },
      { id: "custom", label: "自定义", action: { type: "custom" } },
    ] }]);
    const regenerated = await setup();
    regenerated.provider.enqueue(
      { text: "", calls: [{ id: "complete-meal", name: "bubu_record_events", arguments: meal }] },
      { text: reply("请再告诉我这餐几点、喝了多少。", []), calls: [] },
      { text: questionCandidate, calls: [] },
    );
    const afterRegeneration = await regenerated.chat.send(regenerated.f.alice, input("complete-meal-regenerated-question", "晚上喝奶 200 羊奶，150 奶粉"));
    expect(receipt(afterRegeneration).questions).toEqual([]);
    expect(afterRegeneration.replyQuestions).toEqual([]);
    expect(afterRegeneration.assistantText).toContain("合计 350 毫升");
    expect(afterRegeneration.assistantText).not.toMatch(/请再告诉我|这餐奶量是多少/);

    const fallback = await setup();
    const invalid = { text: reply("请再告诉我奶量。", []), calls: [] };
    fallback.provider.enqueue({ text: "", calls: [{ id: "complete-meal-fallback", name: "bubu_record_events", arguments: meal }] }, invalid, invalid, invalid);
    const afterFallback = await fallback.chat.send(fallback.f.alice, input("complete-meal-fallback-question", "晚上喝奶 200 羊奶，150 奶粉"));
    expect(receipt(afterFallback).questions).toEqual([]);
    expect(afterFallback.replyQuestions).toEqual([]);
    expect(afterFallback.assistantText).toContain("合计 350 毫升");
    expect(afterFallback.assistantText).not.toContain("请再告诉我");
  });

  it("keeps a safe answer to an unrelated user question alongside the complete meal receipt", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "BOTTLE", milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 }, { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] } }] }, "羊奶是奶品原话，和配方奶是不同的记录类别；营养选择请按宝宝情况咨询专业人员。");
    const turn = await s.chat.send(s.f.alice, input("complete-meal-with-unrelated-question", "晚上喝奶 200 羊奶，150 奶粉。顺便问，羊奶和奶粉有什么区别？"));
    expect(turn.replyQuestions).toEqual([]);
    expect(turn.assistantText).toContain("合计 350 毫升");
    expect(turn.assistantText).toContain("羊奶是奶品原话");
  });

  it("reads baby-shared options for every manual turn, enriches forms, and changes config only on explicit intent", async () => {
    const s = await setup();
    await s.f.records.preferences.update(s.f.alice, { babyId: "baby-a", requestId: "seed-chat-options", expectedVersion: 0, updates: [{ key: "BOTTLE.milkAmount", values: [180, 210] }] });
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "BOTTLE", milkItems: [{ id: "formula-1", milkSource: "FORMULA" }] } }] });
    const pending = await s.chat.send(s.f.alice, input("chat-options-form", "刚喝完奶粉"));
    const milk = question(pending).form?.controls.find(control => control.field === "milkAmount");
    expect(milk).toMatchObject({ optionsSource: "manual", options: [{ label: "180 ml", value: "180" }, { label: "210 ml", value: "210" }] });
    expect(question(pending).form?.sourceSentAt).toBe(pending.createdAt);
    expect(s.f.mcpRequests.some(request => request.name === "bubu_get_care_preferences")).toBe(true);

    s.provider.tool("bubu_update_care_preferences", { updates: [{ key: "BOTTLE.milkAmount", values: [210, 180, 240] }] });
    const changed = await s.chat.send(s.f.alice, input("chat-options-change", "把 240 ml 加入瓶喂常用选项，排在最后"));
    const configReceipt = changed.receipts.find(value => "kind" in value && value.kind === "care_preferences_changed") as PreferenceMutationReceipt;
    expect(configReceipt).toMatchObject({ version: 2, changedKeys: ["BOTTLE.milkAmount"] });
    expect(changed.assistantText).toContain("瓶喂奶量：210 ml、180 ml、240 ml");
    expect((await s.f.records.preferences.get(s.f.alice, "baby-a")).options.find(option => option.key === "BOTTLE.milkAmount")?.configuredValues).toEqual([210, 180, 240]);

    s.provider.enqueue({ text: "", calls: [{ id: "ordinary-config-rejected", name: "bubu_update_care_preferences", arguments: { updates: [{ key: "BOTTLE.milkAmount", values: [99] }] } }] });
    const rejected = await s.chat.send(s.f.alice, input("chat-options-no-intent", "这次喝了 99 ml"));
    expect(rejected.status).toBe("failed");
    expect((await s.f.records.preferences.get(s.f.alice, "baby-a")).version).toBe(2);

    const recordWrites = s.f.mcpRequests.filter(request => request.name === "bubu_record_events").length;
    const configWrites = s.f.mcpRequests.filter(request => request.name === "bubu_update_care_preferences").length;
    s.provider.enqueue({ text: "", calls: [{ id: "negated-config-rejected", name: "bubu_update_care_preferences", arguments: { updates: [{ key: "BOTTLE.milkAmount", values: [210] }] } }] });
    const negated = await s.chat.send(s.f.alice, input("chat-options-negated", "不要把210加入常用选项"));
    expect(negated.status).toBe("failed");
    expect(s.f.mcpRequests.filter(request => request.name === "bubu_record_events")).toHaveLength(recordWrites);
    expect(s.f.mcpRequests.filter(request => request.name === "bubu_update_care_preferences")).toHaveLength(configWrites);
    expect((await s.f.records.preferences.get(s.f.alice, "baby-a")).options.find(option => option.key === "BOTTLE.milkAmount")?.configuredValues).toEqual([210, 180, 240]);
  }, 30_000);

  it("does not refresh and force a stale shared-config write", async () => {
    const s = await setup();
    s.provider.enqueue(async () => {
      await s.f.records.preferences.update(s.f.alice, { babyId: "baby-a", requestId: "other-caregiver-config", expectedVersion: 0, updates: [{ key: "PUMP.milkAmount", values: [80] }] });
      return { text: "", calls: [{ id: "stale-config", name: "bubu_update_care_preferences", arguments: { updates: [{ key: "PUMP.milkAmount", values: [90] }] } }] };
    });
    const result = await s.chat.send(s.f.alice, input("chat-options-stale", "把 90 ml 加入吸奶常用选项"));
    expect(result.status).toBe("failed");
    const current = await s.f.records.preferences.get(s.f.alice, "baby-a");
    expect(current.version).toBe(1);
    expect(current.options.find(option => option.key === "PUMP.milkAmount")?.configuredValues).toEqual([80]);
    expect(s.f.mcpRequests.filter(request => request.name === "bubu_get_care_preferences")).toHaveLength(1);
  }, 30_000);

  it("recovers a lost shared-config response with the original pinned mutation", async () => {
    const s = await setup();
    s.provider.tool("bubu_update_care_preferences", { updates: [{ key: "PUMP.milkAmount", values: [80, 100] }] });
    s.f.loseToolResponseOnce("bubu_update_care_preferences");
    const partial = await s.chat.send(s.f.alice, input("chat-options-recovery", "把 80 和 100 ml 加入吸奶常用选项"));
    expect(partial.status).toBe("needs_recovery");
    await s.restart();
    const recovered = await s.chat.send(s.f.alice, { babyId: "baby-a", requestId: partial.requestId, ...partial.input });
    expect(recovered.status).toBe("completed");
    const config = recovered.receipts.find(value => "kind" in value && value.kind === "care_preferences_changed") as PreferenceMutationReceipt;
    expect(config).toMatchObject({ version: 1, changedKeys: ["PUMP.milkAmount"] });
    const writes = s.f.mcpRequests.filter(request => request.name === "bubu_update_care_preferences");
    expect(writes).toHaveLength(2);
    expect(writes[1]?.arguments).toEqual(writes[0]?.arguments);
    expect((await s.f.records.preferences.get(s.f.alice, "baby-a")).version).toBe(1);
  }, 30_000);

  it("keeps the persisted first-week baby notice in shared chronological history", async () => {
    const s = await setup(), client = await s.f.connect();
    for (let index = 0; index < 3; index++) await call(client, "bubu_record_events", { babyId: "baby-a", requestId: `chat-first-week-${index}`, events: [{ facts: { type: "PUMP", endTime: `2026-10-23T0${index + 1}:00:00Z`, milkAmount: 90 } }] });
    s.f.advance(8 * 86400_000);
    const catchupToken = (await s.f.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    const catchupPrincipal = await s.f.identity.authenticate(catchupToken, "bearer");
    const history = await s.chat.history(catchupPrincipal, "baby-a");
    expect(history.firstWeekNotice).toMatchObject({ instructions: "可继续聊天调整，也可到设置修改", sampleCounts: { "PUMP.milkAmount": 3 } });
    expect(history.firstWeekNotice?.text).toMatch(/宝宝首周规律总结.*吸奶奶量 90 ml（3次记录）/);
    expect((await s.chat.history(catchupPrincipal, "baby-a")).firstWeekNotice).toEqual(history.firstWeekNotice);
    await s.restart();
    const freshToken = (await s.f.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    const fresh = await s.f.identity.authenticate(freshToken, "bearer");
    expect((await s.chat.history(fresh, "baby-a")).firstWeekNotice).toEqual(history.firstWeekNotice);
  }, 30_000);

  it("keeps feeding branches, computes only same-bottle consumption and refreshes the actual day rather than the viewed date", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ intent: "feeding", facts: { startTime: "2026-10-23T11:00:00+08:00" } }] });
    const first = await s.chat.send(s.f.alice, input("chat-feeding-branch", "喝奶了"));
    expect(first.status).toBe("completed"); expect(event(first).facts.type).toBeUndefined();
    expect(question(first).fields).toContain("type"); expect(s.f.legacy.activities.size).toBe(0);
    const typeControl = question(first).form?.controls.find(control => control.field === "type");
    expect(typeControl?.options?.map(option => option.label)).toEqual(["亲喂", "瓶喂"]);
    const typed = await answer(s, first, "chat-feeding-formula-type", "是瓶喂", { facts: { type: "BOTTLE" } });
    const milkItemId = event(typed).facts.milkItems![0]!.id;
    const second = await answer(s, typed, "chat-feeding-formula", "奶粉，实际喝了100毫升", { facts: {}, milkItemAnswers: [{ milkItemId, facts: { milkSource: "FORMULA", milkAmount: 100 } }] });
    expect(event(second).id).toBe(event(first).id); expect(event(second).facts.milkAmount).toBe(100);
    expect(second.pending).toHaveLength(0);
    expect(second.assistantText).toMatch(/奶粉\s*100\s*毫升.*合计\s*100\s*毫升/);
    expect(second.assistantText).not.toMatch(/多久|多长|拍嗝/);
    expect(second.status).toBe("completed"); expect(receipt(second).status).toBe("saved");
    expect(event(second).complete).toBe(true); expect(second.refreshRequired).toBe(true);
    type Snapshot = Awaited<ReturnType<ChatFixture["records"]["query"]>>;
    const current = await read<Snapshot>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
    const browsed = await read<Snapshot>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-21");
    expect(current.events).toHaveLength(1); expect(current.summary?.metrics.totalMilkAmount).toBe(100);
    expect(browsed.events).toHaveLength(0); expect(browsed.summary?.metrics.totalMilkAmount).toBe(0);
    expect(s.f.mcpRequests.some(value => value.name === "bubu_get_rules")).toBe(true);
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_record_events")).toHaveLength(1);
    const source = event(second).sources[0]!;
    expect(source.kind).toBe("chat"); expect(source.senderId).toBe(s.f.alice.subjectId);
    expect(source.sentAt).toBe("2026-10-23T12:00:00.000Z");
    const providerText = JSON.stringify(s.provider.inputs);
    expect(providerText).toContain("Asia/Shanghai"); expect(providerText).toContain("2026-10-21");
    expect(providerText).not.toContain(s.f.aliceToken); expect(providerText).not.toContain(s.f.operatorToken);
  }, 30_000);

  it("reads authorized image bytes for vision, asks about uncertainty and replaces the old inference with the explicit answer", async () => {
    const s = await setup();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#b0a030" } }).png({ compressionLevel: 9 }).toBuffer();
    const attachment = await upload(s.f, "chat-photo-original", bytes);
    s.provider.enqueue(model => {
      expect(JSON.stringify(model.messages)).toContain(`data:image/png;base64,${bytes.toString("base64")}`);
      return { text: "", calls: [{ id: "inspect-diaper", name: "bubu_record_events", arguments: { events: [{ facts: { type: "DIAPER", startTime: "2026-10-23T11:00:00+08:00", hasPoop: true, hasPee: false, poopColor: "GREEN" }, attachmentIds: [attachment.id], evidence: [{ field: "poopColor", kind: "reported", confirmed: true }] }] } }] };
    }, { text: "照片颜色仍需您确认。", calls: [] });
    const first = await s.chat.send(s.f.alice, input("chat-diaper-image", "刚换的尿布", { attachmentIds: [attachment.id] }));
    expect(event(first).attachmentIds).toEqual([attachment.id]); expect(event(first).facts.poopColor).toBeUndefined();
    expect(event(first).facts.hasPoop).toBeUndefined(); expect(event(first).facts.hasPee).toBeUndefined();
    expect(question(first).fields).toContain("hasPoop"); expect(question(first).fields).toContain("hasPee");
    expect(question(first).fields).not.toContain("poopColor");
    expect(question(first).form?.controls.filter(control => control.field === "hasPee" || control.field === "hasPoop").map(control => control.options?.map(option => option.label))).toEqual([["是", "否"], ["是", "否"]]);
    const branch = await answer(s, first, "chat-diaper-branch", "有便，没有尿", { facts: { hasPoop: true, hasPee: false }, states: { poopPhotoUrl: "known" }, evidence: [{ field: "poopPhotoUrl", kind: "image", confirmed: false }] });
    expect(event(branch).conflicts).toEqual([]);
    expect(s.provider.inputs.at(-1)!.tools.some(tool => tool.name === "bubu_resolve_media")).toBe(false);
    expect(branch.pending).toHaveLength(0); expect(event(branch).facts.poopColor).toBeUndefined();
    expect(event(branch).states.poopColor).toBe("pending"); expect(branch.assistantText).not.toMatch(/便便.*什么颜色/);
    s.provider.tool("bubu_update_event", { eventId: event(branch).id, expectedVersion: event(branch).version, patch: { facts: { poopColor: "YELLOW" } } });
    const confirmed = await s.chat.send(s.f.alice, input("chat-diaper-confirm", "黄色的", { context: { viewedDate: "2026-10-23", selectedEventId: event(branch).id } }));
    expect(s.f.mcpRequests.some(value => value.name === "bubu_update_event")).toBe(true);
    expect(event(confirmed).id).toBe(event(first).id); expect(event(confirmed).facts.poopColor).toBe("YELLOW");
    expect(event(confirmed).evidence.some(value => value.field === "poopColor" && value.kind === "image" && !value.confirmed)).toBe(false);
    expect(confirmed.pending).toHaveLength(0);
    const saved = await read<{ events: Array<{ attachmentIds: string[] }> }>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
    expect(saved.events[0]?.attachmentIds).toEqual([attachment.id]);
    const downloaded = await fetch(new URL(attachment.url, s.f.origin), { headers: { Authorization: `Bearer ${s.f.aliceToken}` } });
    expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect((await fetch(new URL(attachment.url, s.f.origin), { headers: { Authorization: `Bearer ${s.f.bobToken}` } })).status).toBe(403);
    const replacement = await upload(s.f, "chat-photo-replacement", await sharp({ create: { width: 8, height: 8, channels: 3, background: "#eecc55" } }).png({ compressionLevel: 9 }).toBuffer());
    s.provider.tool("bubu_attach_images", { eventId: event(confirmed).id, expectedVersion: event(confirmed).version, attachmentIds: [replacement.id] });
    const replaced = await s.chat.send(s.f.alice, input("chat-photo-replace", "把照片换成这一张", { attachmentIds: [replacement.id], context: { viewedDate: "2026-10-23", selectedEventId: event(confirmed).id } }));
    expect(event(replaced).attachmentIds).toEqual([replacement.id]);
    s.provider.tool("bubu_attach_images", { eventId: event(replaced).id, expectedVersion: event(replaced).version, attachmentIds: [] });
    const removed = await s.chat.send(s.f.alice, input("chat-photo-remove", "移除这条记录照片", { context: { viewedDate: "2026-10-23", selectedEventId: event(replaced).id } }));
    expect(event(removed).attachmentIds).toEqual([]);
  }, 30_000);

  it("reauthorizes the previous and selected event photos for later vision turns without persisting image bytes", async () => {
    const s = await setup();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#aabb33" } }).png({ compressionLevel: 9 }).toBuffer();
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

  it("turns ambiguous private photo references into scoped choices and loads only the selected reference", async () => {
    const s = await setup();
    const firstBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#112233" } }).png().toBuffer();
    const secondBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ddeeff" } }).png().toBuffer();
    const firstPhoto = await upload(s.f, "ambiguous-photo-first", firstBytes), secondPhoto = await upload(s.f, "ambiguous-photo-second", secondBytes);
    s.provider.tool("bubu_record_events", { events: [{ facts: bottle, attachmentIds: [firstPhoto.id, secondPhoto.id] }] });
    await s.chat.send(s.f.alice, input("chat-ambiguous-photo-source", "这两张是本次记录", { attachmentIds: [firstPhoto.id, secondPhoto.id] }));
    const callsBeforeQuestion = s.provider.inputs.length;
    const ambiguous = await s.chat.send(s.f.alice, input("chat-ambiguous-photo-question", "看上一张图"));
    expect(ambiguous.status).toBe("completed"); expect(s.provider.inputs).toHaveLength(callsBeforeQuestion);
    const imageQuestion = ambiguous.replyQuestions?.find(question => question.id.startsWith("image-"));
    expect(imageQuestion).toBeDefined();
    if (!imageQuestion) throw new Error("Missing image choice question");
    expect(imageQuestion.choices.map(choice => choice.label)).toEqual(["第 1 张", "第 2 张", "添加新照片", "暂不查看"]);
    s.provider.enqueue(model => {
      const payload = JSON.stringify(model.messages);
      expect(payload).toContain(firstPhoto.id);
      expect(model.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === "image_url")).toHaveLength(1);
      return { text: reply("已查看所选照片。", []), calls: [] };
    });
    const selected = await s.chat.send(s.f.alice, input("chat-ambiguous-photo-selected", "", { choiceAnswer: { questionId: imageQuestion.id, choiceId: "reference-1", originTurnId: ambiguous.id } }));
    expect(selected.status, JSON.stringify(selected)).toBe("completed"); expect(selected.input.attachmentIds).toEqual([firstPhoto.id]);
  }, 30_000);

  it("does not require choosing among a record's photos before an explicit non-visual deletion", async () => {
    const s = await setup(), client = await s.f.connect();
    const ids: string[] = [];
    for (const [index, background] of ["#aabb33", "#bbcc44", "#ccdd55", "#ddee66"].entries()) {
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png({ compressionLevel: 9 }).toBuffer();
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
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#aabb33" } }).png({ compressionLevel: 9 }).toBuffer();
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
    const groupSource = (messageId: string, groupId: string) => ({ kind: "wechat" as const, accountId: "account", conversationId: groupId, messageId, eventKey: `feed:${messageId}`, sentAt: bottle.startTime, senderId: `sender-${groupId}`, groupId });
    const partialBottle = { ...bottle, milkItems: [{ id: "milk-1", milkSource: "BREAST_MILK" as const }] };
    const original = await call<RecordReceipt>(collector, "bubu_record_events", { babyId: "baby-a", requestId: "offline-group-feeding", events: [{ facts: partialBottle, sources: [{ kind: "wechat", accountId: "account", conversationId: "account:chat-test-group", messageId: "group-message-1", eventKey: "feed", sentAt: bottle.startTime, senderId: "group-sender", groupId: "account:chat-test-group" }] }] });
    await s.restart();
    const replayClient = await s.f.connect(token);
    expect(await call<RecordReceipt>(replayClient, "bubu_record_events", { babyId: "baby-a", requestId: "offline-group-feeding", events: [{ facts: partialBottle, sources: [{ kind: "wechat", accountId: "account", conversationId: "account:chat-test-group", messageId: "group-message-1", eventKey: "feed", sentAt: bottle.startTime, senderId: "group-sender", groupId: "account:chat-test-group" }] }] })).toEqual(original);
    const history = await s.chat.history(s.f.alice, "baby-a");
    expect(history.turns).toEqual([]); expect(history.pendingCount).toBe(1);
    expect(history.automaticMessages).toHaveLength(1); expect(history.automaticMessages[0]).toMatchObject({ requestId: "offline-group-feeding", outcome: "needs_information" });
    expect(JSON.stringify(history.automaticMessages)).not.toMatch(/group-sender|group-message-1|私人/);
    const q = history.pending.find((value): value is PendingQuestion & { kind: "fields" } => value.kind === "fields")!;
    expect(q.eventId).toBe(original.events[0]!.id);
    const invite = await s.f.identity.invite(s.f.operator, "baby-a", "write");
    await s.f.identity.acceptInvite(s.f.bob, invite.code);
    expect((await s.chat.history(s.f.bob, "baby-a")).pendingCount).toBe(1);
    s.provider.tool("bubu_answer_pending", { questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 100 } }] } });
    const completed = await s.chat.send(s.f.alice, input("group-chat-complete", "实际喝了100，我自己的私人备注", { question: questionInput(q) }));
    expect(event(completed).id).toBe(original.events[0]!.id); expect(s.f.legacy.activities.size).toBe(1);
    const bobHistory = await s.chat.history(s.f.bob, "baby-a");
    expect(bobHistory.turns).toEqual([]); expect(bobHistory.pendingCount).toBe(0);
    expect(bobHistory.automaticMessages).toHaveLength(1);
    expect(JSON.stringify(bobHistory)).not.toContain("私人备注");
    await s.f.identity.bindGroup(s.f.operator, "baby-a", "account:chat-test-other-group", "chat-test-other-collector", true);
    const otherToken = (await s.f.identity.issueAgent(s.f.operator, "baby-a", "collector", { groupId: "account:chat-test-other-group", agentId: "chat-test-other-collector" })).token;
    const otherCollector = await s.f.connect(otherToken);
    await call(otherCollector, "bubu_record_events", { babyId: "baby-a", requestId: "offline-group-complete", events: [{ facts: { type: "PUMP", startTime: "2026-10-23T12:00:00+08:00", durationMinutes: 5, milkAmount: 60 }, sources: [groupSource("other-group-message-1", "account:chat-test-other-group")] }] });
    const caregiverActivity = await s.chat.history(s.f.alice, "baby-a");
    expect(caregiverActivity.pendingCount).toBe(0); expect(caregiverActivity.automaticMessages.map(message => message.requestId).sort()).toEqual(["offline-group-complete", "offline-group-feeding"]);
    const completeNotice = caregiverActivity.automaticMessages.find(message => message.requestId === "offline-group-complete")!;
    expect(completeNotice.outcome).toBe("saved"); expect(completeNotice.events[0]?.complete).toBe(true);
    // Collector delegates cannot enumerate caregiver-facing activity notices;
    // the caregiver history projection above is the scoped read boundary.
    s.provider.tool("bubu_answer_pending", { questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 120 } }] } });
    const stale = await s.chat.send(s.f.bob, input("group-stale-answer", "其实是120", { question: questionInput(q) }));
    expect(stale.status).toBe("failed"); expect(stale.error?.code).toBe("QUESTION_STALE");
    expect([...s.f.legacy.activities.values()][0]?.milkAmount).toBe(100);
  }, 30_000);

  it("renders one event form and executes a typed multi-field answer through MCP without a provider", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "PUMP", startTime: "2026-10-23T10:00:00+08:00" } }] });
    const created = await s.chat.send(s.f.alice, input("form-pump-create", "吸奶还没结束"));
    const q = question(created);
    expect(q.form?.controls.map(control => control.field)).toEqual(["milkAmount"]);
    expect(q.form?.controls.find(control => control.field === "milkAmount")?.label).toBe("泵出奶量");
    expect(q.form?.progressControl).toBeUndefined();
    const noModel = new ChatService(s.f.identity, s.f.attachments, { mcpUrl: `${s.f.origin}/api/mcp` });
    const modelCallsBefore = s.provider.inputs.length;
    const request = input("form-pump-answer", "", {
      context: { viewedDate: "2026-10-23", selectedEventId: event(created).id },
      question: questionInput(q),
      formAnswer: { facts: { milkAmount: 0 } },
    });
    s.f.loseToolResponseOnce("bubu_answer_pending");
    const partial = await noModel.send(s.f.alice, request);
    expect(partial.status).toBe("needs_recovery"); expect(partial.error?.retryable).toBe(true);
    await noModel.close();
    await s.restart();
    const adopted = new ChatService(s.f.identity, s.f.attachments, { mcpUrl: `${s.f.origin}/api/mcp` });
    const recovered = await adopted.send(s.f.alice, { babyId: "baby-a", requestId: "form-pump-answer", ...partial.input });
    expect(recovered.status).toBe("completed"); expect(event(recovered).facts.milkAmount).toBe(0);
    expect(event(recovered).facts.durationMinutes).toBeUndefined(); expect(event(recovered).id).toBe(event(created).id);
    expect(recovered.pending).toHaveLength(0); expect(recovered.input.text).toContain("奶量：0毫升");
    expect(s.provider.inputs).toHaveLength(modelCallsBefore);
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_answer_pending")).toHaveLength(1);
    await expect(adopted.send(s.f.alice, input("form-pump-answer", "", {
      context: { viewedDate: "2026-10-23", selectedEventId: event(created).id },
      question: questionInput(q),
      formAnswer: { facts: { milkAmount: 20 } },
    }))).rejects.toMatchObject({ code: "CHAT_REQUEST_REUSED" });
    const stale = await adopted.send(s.f.alice, input("form-pump-stale", "", {
      context: { viewedDate: "2026-10-23", selectedEventId: event(created).id },
      question: questionInput(q),
      formAnswer: { facts: { milkAmount: 20 } },
    }));
    expect(stale.status).toBe("failed"); expect(stale.error?.code).toBe("QUESTION_STALE");
    expect(event(recovered).facts.milkAmount).toBe(0);
    await adopted.close();
  }, 30_000);

  it("keeps explicit zero from a typed form and rejects unrelated fields", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "BOTTLE", startTime: bottle.startTime, milkItems: [{ id: "zero-milk", milkSource: "BREAST_MILK" }], burpSuccess: false } }] });
    const created = await s.chat.send(s.f.alice, input("form-unknown-create", "瓶喂母乳"));
    const q = question(created);
    const zeroMilkItemId = event(created).facts.milkItems![0]!.id;
    const noModel = new ChatService(s.f.identity, s.f.attachments, { mcpUrl: `${s.f.origin}/api/mcp` });
    const result = await noModel.send(s.f.alice, input("form-unknown-answer", "", {
      context: { viewedDate: "2026-10-23", selectedEventId: event(created).id },
      question: questionInput(q),
      formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: zeroMilkItemId, facts: { milkAmount: 0 } }] },
    }));
    expect(result.status, JSON.stringify(result)).toBe("completed"); expect(result.pending).toHaveLength(0);
    expect(event(result).facts.milkAmount).toBe(0); expect(event(result).facts.burpSuccess).toBe(false);
    expect(event(result).facts.durationMinutes).toBeUndefined();
    expect(result.input.text).toContain("这项奶品：0毫升"); expect(result.input.text).not.toContain("拍嗝结果：否");
    expect(result.assistantText).not.toContain("还需补充");
    expect(result.assistantText).toContain("已记录瓶喂，母乳 0 毫升，合计 0 毫升。");
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "PUMP", startTime: "2026-10-23T12:00:00+08:00" } }] });
    const unrelated = await s.chat.send(s.f.alice, input("form-unrelated-create", "再记一条吸奶", { text: "再记一条吸奶" }));
    const next = question(unrelated);
    const rejected = await noModel.send(s.f.alice, input("form-unrelated-answer", "", {
      context: { viewedDate: "2026-10-23", selectedEventId: event(unrelated).id },
      question: questionInput(next),
      formAnswer: { facts: { notes: "不相关字段" } },
    }));
    expect(rejected.status).toBe("failed"); expect(rejected.error?.code).toBe("CHAT_FORM_FIELD_MISMATCH");
  }, 30_000);

  it("omits a malformed scalar form without dropping the public turn", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "BOTTLE", milkItems: [{ id: "malformed-milk", milkSource: "FORMULA" }] } }] });
    const created = await s.chat.send(s.f.alice, input("malformed-form-publication", "刚喝完奶粉"));
    expect(question(created).form?.controls.find(control => control.field === "milkAmount")?.options?.length).toBeGreaterThan(0);
    const repository = new ChatRepository(s.f.store.payload);
    await s.f.identity.executeAuthorized(s.f.alice, "baby-a", "records:write", async (_scope, req) => {
      const stored = await repository.get(s.f.alice.subjectId, "baby-a", created.id, req);
      expect(stored).toBeDefined();
      const preferences = stored!.modelContext!.preferences as { options: Array<{ key: string; effectiveValues: number[] }> };
      preferences.options.find(option => option.key === "BOTTLE.milkAmount")!.effectiveValues = [];
      await repository.put(stored!, req);
    });
    const publicTurn = await s.chat.request(s.f.alice, "baby-a", created.requestId);
    expect(publicTurn).not.toBeNull();
    expect(question(publicTurn!).form).toBeUndefined();
    expect(question(publicTurn!).prompt).toBe("这项待补表单暂时无法显示。");
    expect(publicTurn!.input.text).toBe(created.input.text);
  }, 30_000);

  it("keeps a fresh processing turn empty before any checked reply exists", async () => {
    const s = await setup();
    const fresh = await s.chat.submit(s.f.alice, input("fresh-processing-empty-reply", "总结今天的记录"));
    expect(fresh.status).toBe("processing");
    expect(fresh.receipts).toEqual([]);
    expect(fresh.assistantText).toBe("");
  }, 30_000);

  it("preserves ordinary turn fingerprints from before structured forms", async () => {
    const s = await setup();
    const original = input("legacy-fingerprint-retry", "记录母乳瓶喂100ml");
    const repository = new ChatRepository(s.f.store.payload);
    const legacy: StoredTurn = {
      id: `turn_${hash([s.f.alice.subjectId, "baby-a", original.requestId])}`,
      identityId: s.f.alice.subjectId,
      conversationId: `chat_${hash([s.f.alice.subjectId, "baby-a"])}`,
      babyId: "baby-a", requestId: original.requestId, fingerprint: hash(original),
      createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z", status: "failed",
      input: { text: original.text, attachmentIds: original.attachmentIds, context: original.context },
      assistantText: "处理暂未完成，输入和已确认结果仍保留，请继续处理。",
      receipts: [], pending: [], refreshRequired: false,
      error: { code: "CHAT_SERVICE_UNAVAILABLE", message: "处理暂未完成，输入和已确认结果仍保留，请继续处理。", retryable: true },
      transcript: [], steps: [], rounds: 0, versions: {}, questionVersions: {},
    };
    await s.f.identity.executeAuthorized(s.f.alice, "baby-a", "records:write", (_scope, req) => repository.put(legacy, req));
    s.provider.enqueue({ text: "我再核对一下。", calls: [] });
    const retried = await s.chat.send(s.f.alice, original);
    expect(retried.status).toBe("completed"); expect(retried.id).toBe(legacy.id); expect(retried.requestId).toBe(original.requestId);
    await expect(s.chat.send(s.f.alice, input(original.requestId, "记录120ml"))).rejects.toMatchObject({ code: "CHAT_REQUEST_REUSED" });
  }, 30_000);

  it("keeps original user text but replaces all unchecked legacy assistant output", async () => {
    const s = await setup();
    const repository = new ChatRepository(s.f.store.payload);
    const original = input("legacy-unchecked-history", "宝宝刚才喝过奶，原话不要改");
    const legacy: StoredTurn = {
      id: `turn_${hash([s.f.alice.subjectId, "baby-a", original.requestId])}`,
      identityId: s.f.alice.subjectId,
      conversationId: `chat_${hash([s.f.alice.subjectId, "baby-a"])}`,
      babyId: "baby-a", requestId: original.requestId, fingerprint: hash(original),
      createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z", status: "completed",
      input: { text: original.text, attachmentIds: [], context: original.context },
      assistantText: "还缺宝宝这次喝奶的量，麻烦说一声",
      replyQuestions: [{ id: "legacy-question", prompt: "请继续补充", origin: { kind: "turn", turnId: "legacy" }, choices: [
        { id: "a", label: "选项A", action: { type: "reply", text: "A" } }, { id: "b", label: "选项B", action: { type: "reply", text: "B" } },
      ] }],
      receipts: [], pending: [], refreshRequired: false, transcript: [], steps: [], rounds: 0, versions: {}, questionVersions: {},
    };
    await s.f.identity.executeAuthorized(s.f.alice, "baby-a", "records:write", (_scope, req) => repository.put(legacy, req));
    const history = await s.chat.history(s.f.alice, "baby-a");
    expect(history.turns[0]?.input.text).toBe(original.text);
    expect(history.turns[0]?.assistantText).toBe("这条旧版回复未经过当前发送检查，已停止显示。当前记录与待补状态以下方内容为准。");
    expect(history.turns[0]?.replyQuestions).toEqual([]);
  }, 30_000);

  it("returns fresh questions after an in-turn stale answer without overwriting or trapping the composer", async () => {
    const s = await setup();
    let questionId = "";
    s.provider.enqueue({ text: "", calls: [{ id: "stale-create", name: "bubu_record_events", arguments: { events: [{ facts: { type: "BOTTLE", startTime: bottle.startTime, milkItems: [{ id: "stale-milk", milkSource: "BREAST_MILK" }] } }] } }] }, model => {
      const result = JSON.parse(String(model.messages.filter(message => message.role === "tool").at(-1)!.content)) as RecordReceipt;
      questionId = result.questions[0]!.id;
      return { text: "", calls: [{ id: "stale-first-answer", name: "bubu_answer_pending", arguments: { questionId, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "stale-milk", facts: { milkAmount: 80 } }] } } }] };
    }, () => ({ text: "", calls: [{ id: "stale-second-answer", name: "bubu_answer_pending", arguments: { questionId, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "stale-milk", facts: { milkAmount: 120 } }] } } }] }));
    const result = await s.chat.send(s.f.alice, input("chat-stale-mid-turn", "瓶喂母乳，喝了80毫升"));
    expect(result.status).toBe("completed"); expect(result.error).toBeUndefined();
    expect(result.assistantText).toContain("待补问题已经更新");
    expect(result.pending).toHaveLength(0);
    expect([...s.f.legacy.activities.values()]).toHaveLength(1);
    expect([...s.f.legacy.activities.values()][0]?.milkAmount).toBe(80);
    expect([...s.f.legacy.activities.values()][0]?.milkAmount).toBe(80);
  }, 30_000);

  it("accepts explicitly unknown answers without turning them into zero or repeatedly asking", async () => {
    const s = await setup();
    s.provider.tool("bubu_record_events", { events: [{ facts: { type: "BOTTLE", startTime: bottle.startTime, milkItems: [{ id: "unknown-milk", milkSource: "BREAST_MILK" }] } }] });
    const first = await s.chat.send(s.f.alice, input("chat-unknown-create", "瓶喂了母乳"));
    const completed = await answer(s, first, "chat-unknown-answer", "奶量不知道", { facts: {}, milkItemAnswers: [{ milkItemId: "unknown-milk", states: { milkAmountState: "unknown" } }] });
    expect(completed.pending).toHaveLength(0); expect(event(completed).complete).toBe(false);
    expect(event(completed).facts.milkAmount).toBeUndefined(); expect(event(completed).states.milkAmount).toBe("unknown");
    expect(completed.assistantText).not.toContain("还需补充");
    expect(completed.assistantText).toContain("母乳（奶量未知）；不确定的信息已记下，不再重复追问。");
    expect(completed.assistantText).not.toContain("已记录瓶喂。");
    await s.restart(); expect((await s.chat.history(s.f.alice, "baby-a")).pendingCount).toBe(0);
    const snapshot = await read<{ summary: { coverage: { unknownFields: number }; byType: { BOTTLE: { unknownMilkAmounts: number } } } }>(s.f, "/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
    expect(snapshot.summary.byType.BOTTLE.unknownMilkAmounts).toBe(1);
  }, 30_000);

  it("cannot bypass a pending answer's version by switching to the generic update tool after another caregiver answers", async () => {
    const s = await setup(), client = await s.f.connect();
    const initial = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "racing-pending-original", events: [{ facts: { ...bottle, milkItems: [{ id: "racing-milk", milkSource: "BREAST_MILK" }] } }] });
    const q = initial.questions[0]!;
    const invite = await s.f.identity.invite(s.f.operator, "baby-a", "write"); await s.f.identity.acceptInvite(s.f.bob, invite.code);
    const other = await s.f.connect(s.f.bobToken);
    s.provider.enqueue(async () => {
      const latest = await call<RecordReceipt>(other, "bubu_answer_pending", { babyId: "baby-a", requestId: "other-racing-answer", questionId: q.id, questionVersion: q.version, eventVersion: q.eventVersion, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "racing-milk", facts: { milkAmount: 100 } }] } });
      return { text: "", calls: [{ id: "bypass-answer-version", name: "bubu_update_event", arguments: { eventId: latest.events[0]!.id, expectedVersion: latest.events[0]!.version, patch: { facts: { milkItems: [{ id: "racing-milk", milkSource: "BREAST_MILK", milkAmount: 120 }] } } } }] };
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
    const mediaQuestion = history.replyQuestions.find(question => question.origin.mediaPendingId === media.id)!;
    expect(mediaQuestion.choices.map(choice => choice.label)).toEqual(["补照片", "无法提供", "稍后处理"]);
    const unavailable = mediaQuestion.choices.find(choice => choice.id === "cannot-provide")!;
    s.provider.tool("bubu_resolve_media", { pendingId: media.id, eventId: media.eventIds[0], resolution: "unknown" });
    const resolved = await s.chat.send(s.f.alice, input("chat-media-unavailable", "", { context: { viewedDate: "2026-10-23", mediaPendingId: media.id }, choiceAnswer: { questionId: mediaQuestion.id, choiceId: unavailable.id } }));
    expect(resolved.status).toBe("completed"); expect(resolved.pending).toHaveLength(0);
    expect(s.provider.inputs.at(-1)!.tools.some(tool => tool.name === "bubu_resolve_media")).toBe(false);
    expect(resolved.receipts).toContainEqual(expect.objectContaining({ kind: "media", state: "resolved", resolution: "unknown" }));
    expect(s.f.mcpRequests.some(value => value.name === "bubu_answer_pending")).toBe(false);
    expect([...s.f.legacy.activities.values()][0]?.poopPhotoUrl).toBeUndefined();
    await s.restart(); expect((await s.chat.history(s.f.alice, "baby-a")).pendingCount).toBe(0);
  }, 30_000);

  it("passes all 15 activity branches through the shared rules without introducing default quantities", async () => {
    const s = await setup();
    const variants: RuleInput["facts"][] = [
      { type: "BREASTFEED", durationMinutes: 10, burpSuccess: false, breastFirmness: "SOFT" },
      { type: "BOTTLE", durationMinutes: 10, milkItems: [{ id: "branch-formula", milkSource: "FORMULA" }], preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true, burpSuccess: false },
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
    expect(s.provider.inputs).toHaveLength(3);
  }, 30_000);

  it("keeps a completed candidate in duplicate review and merges only after the user's explicit confirmation", async () => {
    const s = await setup(), client = await s.f.connect();
    const existing = (await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "other-entry-existing", events: [{ facts: bottle }] })).events[0]!;
    s.provider.tool("bubu_record_events", { events: [{ intent: "feeding", facts: { startTime: bottle.startTime } }] });
    const partial = await s.chat.send(s.f.alice, input("chat-duplicate-candidate", "11点那次喝奶"));
    const typed = await answer(s, partial, "chat-duplicate-type", "是瓶喂", { facts: { type: "BOTTLE" } });
    const pendingItemId = event(typed).facts.milkItems![0]!.id;
    const completed = await answer(s, typed, "chat-duplicate-completion", "母乳100ml", { facts: {}, milkItemAnswers: [{ milkItemId: pendingItemId, facts: { milkSource: "BREAST_MILK", milkAmount: 100 } }] });
    expect(event(completed).id).toBe(event(partial).id); expect(event(completed).duplicateCandidates).toContain(existing.id);
    expect(question(completed).duplicateCandidates).toContain(existing.id);
    const duplicateQuestion = completed.replyQuestions?.find(item => item.choices.some(choice => choice.id === `same-event-${existing.id}`));
    expect(duplicateQuestion).toBeDefined();
    if (!duplicateQuestion) throw new Error("Missing duplicate choice question");
    expect(duplicateQuestion.choices.map(choice => choice.label)).toEqual(["与候选 1是同一件事", "不同事件"]);
    expect(s.f.legacy.activities.size).toBe(1);
    s.provider.tool("bubu_resolve_duplicate", { eventId: event(completed).id, resolution: "same", targetEventId: existing.id });
    const merged = await s.chat.send(s.f.alice, input("chat-duplicate-confirm", "", { context: { viewedDate: "2026-10-23", selectedEventId: event(completed).id }, question: questionInput(question(completed)), choiceAnswer: { questionId: duplicateQuestion.id, choiceId: `same-event-${existing.id}` } }));
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
    s.provider.tool("bubu_update_event", { eventId: current.id, expectedVersion: current.version, patch: { facts: { milkItems: [{ id: "milk-1", milkSource: "BREAST_MILK", milkAmount: 80 }] } } });
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
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#7799aa" } }).png({ compressionLevel: 9 }).toBuffer();
    const otherPhoto = await upload(s.f, "other-baby-private-image", bytes, s.f.bobToken, "baby-b");
    const before = s.provider.inputs.length;
    const denied = await s.chat.send(s.f.alice, input("cross-baby-chat-image", "看这张图", { attachmentIds: [otherPhoto.id] }));
    expect(denied.status).toBe("failed"); expect(denied.error?.code).toBe("ATTACHMENT_NOT_FOUND");
    expect(s.provider.inputs).toHaveLength(before);
  }, 30_000);

  it("gates hidden prose requests, uses the separate semantic verdict and publishes only corrected clickable choices", async () => {
    const s = await setup();
    const corrected = reply("我还需要确认这次的奶量。", [{
      id: "milk-clarification", prompt: "这次奶量接近哪一种？", choices: [
        { id: "small", label: "少于 100 ml", action: { type: "reply", text: "这次少于 100 ml" } },
        { id: "large", label: "至少 100 ml", action: { type: "reply", text: "这次至少 100 ml" } },
        { id: "unknown", label: "不知道", action: { type: "reply", text: "我不知道这次奶量" } },
        { id: "custom", label: "自定义", action: { type: "custom" } },
      ],
    }]);
    s.provider.enqueue({ text: reply("告诉我奶量", []), calls: [] }, { text: corrected, calls: [] });
    const deterministic = await s.chat.send(s.f.alice, input("chat-gate-hidden-request", "想补一条说明"));
    expect(deterministic.status).toBe("completed");
    expect(deterministic.assistantText).toBe("我还需要确认这次的奶量。");
    expect(deterministic.assistantText).not.toContain("告诉我奶量");
    expect(deterministic.replyQuestions?.[0]?.choices.map(choice => choice.label)).toEqual(["少于 100 ml", "至少 100 ml", "不知道", "自定义"]);
    expect(s.provider.inputs.filter(value => value.tools.length === 0 && value.responseFormat?.name === "bubu_reply_verdict")).toHaveLength(2);

    const firstChoice = deterministic.replyQuestions![0]!.choices[0]!;
    s.provider.enqueue(model => {
      expect(JSON.stringify(model.messages)).toContain("这次少于 100 ml");
      return { text: reply("已收到所选范围。", []), calls: [] };
    });
    const selected = await s.chat.send(s.f.alice, input("chat-gate-choice-answer", "", {
      choiceAnswer: { questionId: deterministic.replyQuestions![0]!.id, choiceId: firstChoice.id, originTurnId: deterministic.id },
    }));
    expect(selected.status).toBe("completed"); expect(selected.input.text).toBe("这次少于 100 ml");
    await expect(s.chat.send(s.f.alice, input("chat-gate-expired-choice", "", {
      choiceAnswer: { questionId: deterministic.replyQuestions![0]!.id, choiceId: firstChoice.id, originTurnId: deterministic.id },
    }))).rejects.toMatchObject({ code: "CHAT_CHOICE_EXPIRED" });

    s.provider.validate("陈述暗示用户继续提供奶量，但没有对应选择题");
    s.provider.enqueue({ text: reply("若方便，奶量信息会有帮助。", []), calls: [] }, { text: corrected, calls: [] });
    const semantic = await s.chat.send(s.f.alice, input("chat-gate-semantic-request", "再问一次"));
    expect(semantic.status).toBe("completed"); expect(semantic.replyQuestions).toHaveLength(1);
    const semanticChecks = s.provider.inputs.filter(value => value.responseFormat?.name === "bubu_reply_verdict");
    expect(semanticChecks.at(-2)?.tools).toEqual([]); expect(semanticChecks.at(-1)?.tools).toEqual([]);

    s.provider.enqueue({ text: reply("已有选择题。请再告诉我具体奶量", JSON.parse(corrected).questions), calls: [] }, { text: corrected, calls: [] });
    const badTail = await s.chat.send(s.f.alice, input("chat-gate-good-form-bad-tail", "继续核对"));
    expect(badTail.status).toBe("completed"); expect(badTail.assistantText).toBe("我还需要确认这次的奶量。");
    expect(badTail.assistantText).not.toContain("请再告诉我");
  }, 30_000);

  it("allows an ordinary declarative read-only summary", async () => {
    const s = await setup();
    s.provider.enqueue({ text: reply("今天共瓶喂 3 次，已知喝入量合计 300 ml。", []), calls: [] });
    const result = await s.chat.send(s.f.alice, input("chat-gate-safe-summary", "总结今天的瓶喂"));
    expect(result.status).toBe("completed"); expect(result.assistantText).toBe("今天共瓶喂 3 次，已知喝入量合计 300 ml。");
    expect(result.replyQuestions).toEqual([]);
  }, 30_000);

  it("fails closed after repeated invalid replies and never executes malicious retry tool calls or repeats a saved write", async () => {
    const s = await setup();
    const invalid = { text: reply("请告诉我奶量", []), calls: [] };
    s.provider.enqueue(invalid, invalid, invalid);
    const failed = await s.chat.send(s.f.alice, input("chat-gate-fail-closed", "普通查询"));
    expect(failed.status).toBe("completed");
    expect(failed.assistantText).toBe("这次回复暂未完成；已确认的记录结果仍保留。");
    expect(failed.assistantText).not.toContain("请告诉我奶量");

    const beforeWrites = s.f.mcpRequests.filter(value => value.name === "bubu_record_events").length;
    s.provider.enqueue(
      { text: "", calls: [{ id: "write-once", name: "bubu_record_events", arguments: { events: [{ facts: bottle }] } }] },
      { text: reply("告诉我是否还要记录", []), calls: [] },
      { text: "", calls: [{ id: "malicious-retry-write", name: "bubu_record_events", arguments: { events: [{ facts: { ...bottle, milkItems: [{ id: "milk-1", milkSource: "BREAST_MILK", milkAmount: 999 }] } }] } }] },
      { text: reply("记录回执由服务器确认。", []), calls: [] },
    );
    const saved = await s.chat.send(s.f.alice, input("chat-gate-write-once", "记录母乳瓶喂100ml"));
    expect(saved.status).toBe("completed"); expect(receipt(saved).status).toBe("saved");
    expect(s.f.mcpRequests.filter(value => value.name === "bubu_record_events")).toHaveLength(beforeWrites + 1);
    expect(s.provider.inputs.filter(value => value.tools.length === 0).every(value => value.tools.length === 0)).toBe(true);
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
