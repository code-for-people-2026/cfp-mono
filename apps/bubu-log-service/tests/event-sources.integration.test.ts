import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CollectionConfig, PayloadRequest } from "payload";
import { afterEach, describe, expect, it } from "vitest";
import { AppError, type LegacyBackend } from "../src/contracts";
import { ChatRepository, chatCollections, type StoredTurn } from "../src/chat/persistence";
import { CollectorService, sourceMessageSchema, type StoredMessage } from "../src/collector/service";
import { canonicalGroupId, isSafeWechatAvatarUrl, sourceFingerprint, type SourceMessage } from "../src/collector/types";
import { IdentityService, type Principal } from "../src/identity";
import { hash, RecordsRepository, recordCollections } from "../src/records/persistence";
import type { CareEvent, LegacyActivity, SourceRef } from "../src/records/types";
import { openStore } from "../src/store";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";

const cleaners: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleaners.splice(0).reverse()) await close(); });

class ScopedLegacyFixture implements LegacyBackend {
  private readonly identity = new LegacyFixture();
  readonly activities = new Map<string, LegacyActivity>();
  readonly recordReads: Array<{ babyId: string; path: string }> = [];

  constructor() {
    this.identity.memberships.set("old-bob", ["baby-a", "baby-b"]);
  }

  verifyCredentials(username: string, password: string) { return this.identity.verifyCredentials(username, password); }
  createFamily(identityId: string, input: { name: string }) { return this.identity.createFamily(identityId, input); }
  findFamilyAccount(identityId: string) { return this.identity.findFamilyAccount(identityId); }
  userExists(userId: string) { return this.identity.userExists(userId); }
  listBabies(userId: string) { return this.identity.listBabies(userId); }
  getBaby(babyId: string) { return this.identity.getBaby(babyId); }
  async read(babyId: string, resource: string, _query: URLSearchParams): Promise<unknown> {
    this.recordReads.push({ babyId, path: resource });
    const match = /^activities\/([^/]+)$/.exec(resource);
    const activity = match ? this.activities.get(decodeURIComponent(match[1]!)) : undefined;
    if (!activity || activity.babyId !== babyId) throw new AppError(404, "NOT_FOUND", "未找到此记录");
    return structuredClone(activity);
  }
  updateBabyNames(babyId: string, input: { name: string; fullName: string | null }) { return this.identity.updateBabyNames(babyId, input); }
}

let fixtureCount = 0;
function uniqueExtension(): CollectionConfig {
  fixtureCount += 1;
  return {
    slug: `event-sources-${fixtureCount}`, timestamps: true,
    access: { read: () => false, create: () => false, update: () => false, delete: () => false },
    fields: [
      { name: "id", type: "text" }, { name: "key", type: "text", required: true, unique: true },
      { name: "babyId", type: "text", required: true, index: true }, { name: "value", type: "json", required: true },
    ],
  };
}

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-event-sources-"));
  const previousPush = process.env.PAYLOAD_FORCE_DRIZZLE_PUSH;
  process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = "true";
  let store: Awaited<ReturnType<typeof openStore>>;
  try { store = await openStore({ directory, extensions: [...recordCollections, ...chatCollections, uniqueExtension()] }); }
  finally {
    if (previousPush === undefined) delete process.env.PAYLOAD_FORCE_DRIZZLE_PUSH;
    else process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = previousPush;
  }
  cleaners.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const legacy = new ScopedLegacyFixture();
  const identity = new IdentityService(store, legacy, new WechatFixture(), () => Date.parse("2026-10-23T12:00:00.000Z"));
  const collector = new CollectorService(identity, async () => false);
  const repository = new RecordsRepository(store.payload);
  const chat = new ChatRepository(store.payload);
  const aliceToken = (await identity.loginLegacy("old-alice", "correct-password", "native")).token;
  const bobToken = (await identity.loginLegacy("old-bob", "correct-password", "native")).token;
  const operatorToken = (await identity.provisionOperator("event-sources-operator", "baby-a", 3_600_000)).token;
  const alice = await identity.authenticate(aliceToken, "bearer"), bob = await identity.authenticate(bobToken, "bearer");
  const operator = await identity.authenticate(operatorToken, "bearer");
  return {
    legacy, identity, collector, repository, chat, alice, bob, operator,
    async put<T>(principal: Principal, babyId: string, table: Parameters<RecordsRepository["put"]>[0], key: string, value: T) {
      await identity.executeAuthorized(principal, babyId, "records:write", (_scope, req: PayloadRequest) => repository.put(table, babyId, key, value, req));
    },
    async putTurn(principal: Principal, turn: StoredTurn) {
      await identity.executeAuthorized(principal, turn.babyId, "records:write", (_scope, req: PayloadRequest) => chat.put(turn, req));
    },
  };
}

function message(overrides: Partial<SourceMessage> = {}): SourceMessage {
  const base = {
    sourceId: "source-1", accountId: "account-a", chatId: "group-a@chatroom",
    databaseId: "message/message_0.db", tableName: "Msg_0", localId: 1,
    sentAt: "2026-10-23T04:00:01.000Z", senderId: "sender-a", kind: "text" as const,
    text: "第一条", media: [],
  };
  const source = { ...base, ...overrides };
  return { ...source, groupId: overrides.groupId ?? canonicalGroupId(source.accountId, source.chatId) };
}

function wechatRef(source: SourceMessage, eventKey = "message"): SourceRef {
  return {
    kind: "wechat", accountId: source.accountId, conversationId: source.chatId,
    messageId: `${source.databaseId}/${source.tableName}/${source.localId}`, eventKey,
    sentAt: source.sentAt, senderId: source.senderId || "unknown", groupId: source.groupId,
  };
}

function event(id: string, sources: SourceRef[], principal: Principal, babyId = "baby-a"): CareEvent {
  const at = "2026-10-23T04:05:00.000Z";
  return {
    id, babyId, legacyId: id, version: 1, facts: { type: "BOTTLE", startTime: "2026-10-23T04:00:00.000Z" },
    states: { type: "known", startTime: "known" }, progress: "ended", evidence: [], missing: [], conflicts: [],
    complete: true, lifecycle: "active", duplicateCandidates: [], sources, attachmentIds: [],
    actor: { kind: "caregiver", id: principal.subjectId, sessionId: principal.sessionId },
    projection: "candidate", projected: null, createdAt: at, updatedAt: at,
  };
}

function conversationId(principal: Principal, babyId: string) { return `chat_${hash([principal.subjectId, babyId])}`; }

function turn(principal: Principal, id: string, text: string, sentAt: string, babyId = "baby-a"): StoredTurn {
  const at = sentAt;
  return {
    id, identityId: principal.subjectId, conversationId: conversationId(principal, babyId), babyId,
    requestId: `request-${id}`, createdAt: at, updatedAt: at, status: "completed",
    input: { text, attachmentIds: [], context: { viewedDate: "2026-10-23" } },
    assistantText: "已保存", receipts: [], pending: [], refreshRequired: false,
    transcript: [], steps: [], rounds: 0, versions: {}, questionVersions: {}, fingerprint: hash([id, text]),
  };
}

function chatRef(value: StoredTurn, eventKey = "message"): SourceRef {
  return {
    kind: "chat", accountId: value.identityId, conversationId: value.conversationId, messageId: value.id,
    eventKey, sentAt: value.createdAt, senderId: value.identityId,
  };
}

describe("collector event source expansion", () => {
  it("keeps old source payloads valid and rejects unsafe avatar schemes", () => {
    const old = message();
    expect(sourceMessageSchema.parse(old)).toEqual(old);
    expect(() => sourceMessageSchema.parse({ ...old, senderAvatarUrl: "data:image/png;base64,abc" })).toThrow();
  });

  it("matches every source identity component, keeps chronology, and ignores neighbors", async () => {
    const f = await setup();
    const avatar = "https://wx.qlogo.cn/mmhead/synthetic/132";
    const late = message({ sourceId: "source-late", localId: 2, sentAt: "2026-10-23T04:00:02.000Z", senderId: "sender-b", senderName: "外婆", senderAvatarUrl: avatar, text: "第二条" });
    const early = message({ sourceId: "source-early", localId: 1 });
    const unrelated = message({ sourceId: "source-unrelated", localId: 3, text: "无关消息" });
    const otherBaby = message({ sourceId: "source-other-baby", localId: 2, text: "另一个宝宝" });
    await f.put(f.alice, "baby-a", "care-messages", late.sourceId, { source: late });
    await f.put(f.alice, "baby-a", "care-messages", early.sourceId, { source: early });
    await f.put(f.alice, "baby-a", "care-messages", unrelated.sourceId, { source: unrelated });
    await f.put(f.bob, "baby-b", "care-messages", otherBaby.sourceId, { source: otherBaby });
    await f.put(f.alice, "baby-a", "care-events", "event-exact", event("event-exact", [wechatRef(late), wechatRef(early)], f.alice));

    await expect(f.collector.eventSources(f.alice, "baby-a", "event-exact")).resolves.toEqual({
      babyId: "baby-a", eventId: "event-exact", unavailableCount: 0,
      messages: [
        { id: early.sourceId, kind: "wechat", senderId: early.senderId, sentAt: early.sentAt, text: early.text },
        { id: late.sourceId, kind: "wechat", senderId: late.senderId, senderName: "外婆", senderAvatarUrl: avatar, sentAt: late.sentAt, text: late.text },
      ],
    });

    const otherChat = "group-b@chatroom";
    const mismatched = [
      { ...wechatRef(late), accountId: "account-b", groupId: canonicalGroupId("account-b", late.chatId) },
      { ...wechatRef(late), groupId: canonicalGroupId(late.accountId, otherChat) },
      { ...wechatRef(late), conversationId: otherChat, groupId: canonicalGroupId(late.accountId, otherChat) },
      { ...wechatRef(late), messageId: `message/message_1.db/${late.tableName}/${late.localId}` },
      { ...wechatRef(late), messageId: `${late.databaseId}/Msg_other/${late.localId}` },
      { ...wechatRef(late), messageId: `${late.databaseId}/${late.tableName}/99` },
    ];
    await f.put(f.alice, "baby-a", "care-events", "event-mismatch", event("event-mismatch", mismatched, f.alice));
    const missing = await f.collector.eventSources(f.alice, "baby-a", "event-mismatch");
    expect(missing.messages).toHaveLength(6);
    expect(missing.messages.every(item => item.text === null)).toBe(true);
    expect(missing.unavailableCount).toBe(6);
    expect(hash(sourceFingerprint(late))).toBe(hash(sourceFingerprint({ ...late, senderName: "新名字", senderAvatarUrl: "https://thirdwx.qlogo.cn/mmopen/new/132" })));
    expect(isSafeWechatAvatarUrl(avatar)).toBe(true);
    for (const unsafe of ["http://wx.qlogo.cn/mmhead/a/132", "javascript:alert(1)", "file:///tmp/a", "https://user:secret@wx.qlogo.cn/mmhead/a/132", "https://evil.example/mmhead/a/132"]) {
      expect(isSafeWechatAvatarUrl(unsafe)).toBe(false);
    }
  });

  it("deduplicates source identity despite event keys", async () => {
    const f = await setup();
    const source = message({ sourceId: "source-duplicate" });
    const absent = message({ sourceId: "source-absent", localId: 9, sentAt: "2026-10-23T04:00:02.000Z" });
    await f.put(f.alice, "baby-a", "care-messages", source.sourceId, { source });
    await f.put(f.alice, "baby-a", "care-events", "event-duplicate", event("event-duplicate", [
      wechatRef(source, "event:0"), wechatRef(source, "event:1"),
      wechatRef(absent, "answer:0"), wechatRef(absent, "answer:1"),
    ], f.alice));

    await expect(f.collector.eventSources(f.alice, "baby-a", "event-duplicate")).resolves.toMatchObject({
      unavailableCount: 1,
      messages: [
        { id: "source-duplicate", text: source.text },
        { id: `missing:wechat:${absent.accountId}:${absent.chatId}:${absent.databaseId}/${absent.tableName}/${absent.localId}`, text: null },
      ],
    });
  });

  it("keeps chat private, validates its conversation, and preserves equal IDs by kind", async () => {
    const f = await setup();
    const own = turn(f.alice, "turn-own", "我记的奶量", "2026-10-23T04:00:00.000Z");
    const foreign = turn(f.bob, "turn-foreign", "别人的私聊", "2026-10-23T04:00:01.000Z");
    const collisionTurn = turn(f.alice, "same-id", "直接对话", "2026-10-23T04:00:02.000Z");
    const collisionMessage = message({ sourceId: "same-id", localId: 4, sentAt: collisionTurn.createdAt, text: "微信群消息" });
    await f.putTurn(f.alice, own); await f.putTurn(f.bob, foreign); await f.putTurn(f.alice, collisionTurn);
    await f.put(f.alice, "baby-a", "care-messages", collisionMessage.sourceId, { source: collisionMessage });
    await f.put(f.alice, "baby-a", "care-events", "event-chat", event("event-chat", [chatRef(own), chatRef(foreign)], f.alice));
    await expect(f.collector.eventSources(f.alice, "baby-a", "event-chat")).resolves.toEqual({
      babyId: "baby-a", eventId: "event-chat", unavailableCount: 0,
      messages: [{ id: own.id, kind: "chat", senderId: f.alice.subjectId, senderName: "我", sentAt: own.createdAt, text: own.input.text }],
    });

    await f.put(f.alice, "baby-a", "care-events", "event-chat-conversation", event("event-chat-conversation", [
      { ...chatRef(own), conversationId: "chat_wrong" },
    ], f.alice));
    await expect(f.collector.eventSources(f.alice, "baby-a", "event-chat-conversation")).resolves.toMatchObject({
      unavailableCount: 1, messages: [{ id: own.id, kind: "chat", text: null }],
    });

    await f.put(f.alice, "baby-a", "care-events", "event-collision", event("event-collision", [
      wechatRef(collisionMessage), chatRef(collisionTurn),
    ], f.alice));
    const collision = await f.collector.eventSources(f.alice, "baby-a", "event-collision");
    expect(collision.messages.map(item => item.kind)).toEqual(["chat", "wechat"]);
    expect(collision.messages.map(item => item.text)).toEqual([collisionTurn.input.text, collisionMessage.text]);
  });

  it("expands only exact marked acceptance evidence and honors retention", async () => {
    const f = await setup();
    const manual: SourceRef = {
      kind: "manual", accountId: "maintenance:fixture-operator", conversationId: "acceptance-feedback",
      messageId: "acceptance-feedback:bottle-formula-missing-amount", eventKey: "bottle-formula-missing-amount",
      sentAt: "2026-10-23T04:00:00.000Z", senderId: "fixture-operator",
    };
    const privateTurn = turn(f.bob, "foreign-private-turn", "不应泄露的私聊", "2026-10-23T04:00:01.000Z");
    await f.putTurn(f.bob, privateTurn);
    const source: SourceMessage = {
      sourceId: "acceptance-test:exact", accountId: "acceptance-test", groupId: "acceptance-test:fixture",
      chatId: "acceptance-feedback@test", databaseId: "test/acceptance-originals", tableName: "SyntheticMessage", localId: 1,
      sentAt: "2026-10-23T04:00:00.000Z", senderId: "acceptance-test:aunt", senderName: "阿姨（测试）",
      kind: "text", text: "刚给宝宝喂完奶粉。", media: [],
    };
    const stored: StoredMessage = {
      source, contentHash: hash(sourceFingerprint(source)), state: "processed", batchId: "acceptance-test-originals",
      acceptanceSource: { kind: "acceptance-test-original/v1", eventId: "event-test-original", manualRef: manual, operationFingerprint: "a".repeat(64), sourceHash: hash(sourceFingerprint(source)) },
    };
    await f.put(f.alice, "baby-a", "care-messages", source.sourceId, stored);
    const crossBabySource = { ...source, sourceId: "acceptance-test:other-baby", text: "另一个宝宝的模拟原文" };
    await f.put(f.bob, "baby-b", "care-messages", crossBabySource.sourceId, {
      ...stored, source: crossBabySource, contentHash: hash(sourceFingerprint(crossBabySource)),
      acceptanceSource: { ...stored.acceptanceSource!, sourceHash: hash(sourceFingerprint(crossBabySource)) },
    });
    const marked = event("event-test-original", [manual, chatRef(privateTurn)], f.alice);
    marked.facts.notes = "[测试记录] 仅用于验收。";
    await f.put(f.alice, "baby-a", "care-events", marked.id, marked);

    await expect(f.collector.eventSources(f.alice, "baby-a", marked.id)).resolves.toEqual({
      babyId: "baby-a", eventId: marked.id, unavailableCount: 0,
      messages: [{ id: source.sourceId, kind: "test", label: "测试记录 · 模拟消息", senderId: source.senderId,
        senderName: source.senderName, sentAt: source.sentAt, text: source.text }],
    });

    const generic = event("event-generic-manual", [{ ...manual, conversationId: "ordinary-manual" }], f.alice);
    generic.facts.notes = "普通手工记录";
    await f.put(f.alice, "baby-a", "care-events", generic.id, generic);
    await expect(f.collector.eventSources(f.alice, "baby-a", generic.id)).resolves.toMatchObject({ messages: [], unavailableCount: 0 });
    const other = event("event-other-test", [manual], f.alice); other.facts.notes = "[测试记录] 另一个事件";
    await f.put(f.alice, "baby-a", "care-events", other.id, other);
    await expect(f.collector.eventSources(f.alice, "baby-a", other.id)).resolves.toMatchObject({ messages: [], unavailableCount: 0 });

    await f.put(f.alice, "baby-a", "care-messages", source.sourceId, { ...stored, privacyExpired: true, source: { ...source, text: "" } });
    await expect(f.collector.eventSources(f.alice, "baby-a", marked.id)).resolves.toMatchObject({
      unavailableCount: 1, messages: [{ id: source.sourceId, kind: "test", text: null }],
    });
  });

  it("allows only authorized caregivers and exposes real legacy records without provenance", async () => {
    const f = await setup();
    await f.put(f.alice, "baby-a", "care-events", "event-auth", event("event-auth", [], f.alice));
    await expect(f.collector.eventSources(f.operator, "baby-a", "event-auth")).rejects.toMatchObject({ status: 403, code: "RECORD_SOURCES_CAREGIVER_REQUIRED" });
    await expect(f.collector.eventSources(f.bob, "baby-a", "event-auth")).resolves.toMatchObject({ eventId: "event-auth" });
    await f.identity.setGrant(f.operator, "baby-a", f.bob.subjectId, "revoked");
    await expect(f.collector.eventSources(f.bob, "baby-a", "event-auth")).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });

    f.legacy.activities.set("legacy-real", {
      id: "legacy-real", babyId: "baby-a", type: "SLEEP", startTime: "2026-10-23T03:00:00.000Z", endTime: "2026-10-23T03:30:00.000Z",
    });
    await expect(f.collector.eventSources(f.alice, "baby-a", "legacy-real")).resolves.toEqual({
      babyId: "baby-a", eventId: "legacy-real", messages: [], unavailableCount: 0,
    });
    await expect(f.collector.eventSources(f.alice, "baby-a", "legacy-missing")).rejects.toMatchObject({ status: 404, code: "RECORD_EVENT_NOT_FOUND" });
    expect(f.legacy.recordReads).toEqual([
      { babyId: "baby-a", path: "activities/legacy-real" },
      { babyId: "baby-a", path: "activities/legacy-missing" },
    ]);
  });
});
