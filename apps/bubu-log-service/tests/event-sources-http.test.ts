import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "../src/http";
import { sourceFingerprint, type SourceMessage } from "../src/collector/types";
import type { StoredMessage } from "../src/collector/service";
import { hash } from "../src/records/persistence";
import type { CareEvent, SourceRef } from "../src/records/types";
import { chatFixture, type ChatFixture } from "./fixtures/chat";
import { source } from "./fixtures/records";

const origin = "https://bubu.example.test";
let fixture: ChatFixture;
let handle: ReturnType<typeof createHandler>;
let browserToken: string;
let collectorToken: string;
let chatAgentToken: string;

beforeAll(async () => {
  fixture = await chatFixture([]);
  handle = createHandler(fixture.identity, origin, undefined, {
    records: fixture.records,
    attachments: fixture.attachments,
    collector: fixture.collector,
  });
  browserToken = (await fixture.identity.loginLegacy("old-alice", "correct-password", "browser")).token;
  await fixture.identity.bindGroup(fixture.operator, "baby-a", "account:group-http", "collector-http", true);
  collectorToken = (await fixture.identity.issueAgent(fixture.operator, "baby-a", "collector", {
    groupId: "account:group-http",
    agentId: "collector-http",
  })).token;
  chatAgentToken = (await fixture.identity.issueAgent(fixture.alice, "baby-a", "chat-agent", { readOnly: true })).token;
  const at = new Date(fixture.identity.now()).toISOString();
  const manual: SourceRef = {
    kind: "manual", accountId: "maintenance:http-fixture", conversationId: "acceptance-feedback",
    messageId: "acceptance-feedback:sleep-ended-missing-duration", eventKey: "sleep-ended-missing-duration",
    sentAt: "2026-10-23T05:00:00.000Z", senderId: "http-fixture",
  };
  const synthetic: SourceMessage = {
    sourceId: "acceptance-test:http-source", accountId: "acceptance-test", groupId: "acceptance-test:fixture",
    chatId: "acceptance-feedback@test", databaseId: "test/acceptance-originals", tableName: "SyntheticMessage", localId: 1,
    sentAt: "2026-10-23T05:00:00.000Z", senderId: "acceptance-test:mom", senderName: "妈妈（测试）",
    kind: "text", text: "宝宝醒啦，这一觉睡得挺安稳。", media: [],
  };
  const event: CareEvent = {
    id: "event-http-sources",
    babyId: "baby-a",
    legacyId: "legacy-event-http-sources",
    version: 1,
    facts: { type: "SLEEP", startTime: "2026-10-23T04:00:00.000Z", endTime: "2026-10-23T05:00:00.000Z", notes: "[测试记录] HTTP 来源验收。" },
    states: {},
    progress: "ended",
    evidence: [],
    missing: [],
    conflicts: [],
    complete: true,
    lifecycle: "active",
    duplicateCandidates: [],
    sources: [source("database/messages/1"), manual],
    attachmentIds: [],
    actor: { kind: "caregiver", id: "old-alice", sessionId: "seed" },
    projection: "synced",
    projected: null,
    createdAt: at,
    updatedAt: at,
  };
  await fixture.store.transaction(async req => {
    await fixture.collector.repository.put("care-events", "baby-a", event.id, event, req);
    const stored: StoredMessage = { source: synthetic, contentHash: hash(sourceFingerprint(synthetic)), state: "processed", batchId: "acceptance-test-http",
      acceptanceSource: { kind: "acceptance-test-original/v1", eventId: event.id, manualRef: manual, operationFingerprint: "b".repeat(64), sourceHash: hash(sourceFingerprint(synthetic)) } };
    await fixture.collector.repository.put("care-messages", "baby-a", synthetic.sourceId, stored, req);
  });
}, 30_000);

afterAll(async () => { await fixture?.close(); });

function sourcesRequest(token: string, kind: "bearer" | "cookie") {
  return handle(new Request(`${origin}/api/app/records/sources?babyId=baby-a&eventId=event-http-sources`, {
    headers: kind === "bearer" ? { authorization: `Bearer ${token}` } : { cookie: `bubu_session=${token}` },
  }));
}

describe("GET /api/app/records/sources", () => {
  it("serves both caregiver browser cookies and native bearer sessions", async () => {
    for (const credential of [["bearer", fixture.aliceToken], ["cookie", browserToken]] as const) {
      const response = await sourcesRequest(credential[1], credential[0]);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        babyId: "baby-a",
        eventId: "event-http-sources",
        unavailableCount: 1,
      });
    }
  });

  it("returns the explicitly labelled simulated source through the caregiver HTTP path", async () => {
    const response = await sourcesRequest(fixture.aliceToken, "bearer");
    expect(response.status).toBe(200);
    const body = await response.json() as { unavailableCount: number; messages: unknown[] };
    expect(body.unavailableCount).toBe(1);
    expect(body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "test", label: "测试记录 · 模拟消息", senderName: "妈妈（测试）", text: "宝宝醒啦，这一觉睡得挺安稳。" }),
    ]));
  });

  it("rejects forged credentials in either transport", async () => {
    for (const credential of [["bearer", "forged-native-token"], ["cookie", "forged-browser-token"]] as const) {
      const response = await sourcesRequest(credential[1], credential[0]);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  it("keeps service agents on the caregiver-only read side", async () => {
    for (const token of [fixture.operatorToken, collectorToken, chatAgentToken]) {
      const response = await sourcesRequest(token, "bearer");
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "RECORD_SOURCES_CAREGIVER_REQUIRED" });
    }
  });
});
