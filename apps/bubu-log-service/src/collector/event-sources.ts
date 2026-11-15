import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import type { Principal } from "../identity";
import { ChatRepository } from "../chat/persistence";
import { hash, type RecordsRepository } from "../records/persistence";
import type { CareEvent, SourceRef } from "../records/types";
import type { AcceptanceTestSourceLink, StoredMessage as CollectorStoredMessage } from "./service";
import { isSafeWechatAvatarUrl, sourceFingerprint, type SourceMessage } from "./types";

export interface EventSourceMessage {
  id: string;
  kind: "wechat" | "chat" | "test";
  label?: "测试记录 · 模拟消息";
  senderId: string | null;
  senderName?: string;
  senderAvatarUrl?: string;
  sentAt: string;
  text: string | null;
}

export interface EventSourcesResult {
  babyId: string;
  eventId: string;
  messages: EventSourceMessage[];
  unavailableCount: number;
}

type StoredMessage = Pick<CollectorStoredMessage, "source" | "contentHash" | "state" | "privacyExpired" | "acceptanceSource">;

const wechatMessageId = (source: SourceMessage) => `${source.databaseId}/${source.tableName}/${source.localId}`;
const wechatRefKey = (accountId: string, groupId: string | undefined, conversationId: string, messageId: string) =>
  `wechat\0${accountId}\0${groupId ?? ""}\0${conversationId}\0${messageId}`;
const refWechatKey = (ref: SourceRef) => wechatRefKey(ref.accountId, ref.groupId, ref.conversationId, ref.messageId);
const sourceWechatKey = (source: SourceMessage) => wechatRefKey(source.accountId, source.groupId, source.chatId, wechatMessageId(source));
const chatKey = (ref: SourceRef) => `chat\0${ref.accountId}\0${ref.messageId}`;
const testKey = (source: SourceMessage) => `test\0${source.sourceId}`;
const chronological = (left: EventSourceMessage, right: EventSourceMessage) => {
  const leftTime = Date.parse(left.sentAt);
  const rightTime = Date.parse(right.sentAt);
  if (leftTime !== rightTime) return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
  return left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind);
};

/**
 * Expand only exact references carried by one event. The caller has already
 * opened the baby-scoped Payload transaction and rechecked records:read.
 */
export async function collectEventSources(input: {
  babyId: string;
  event: CareEvent;
  principal: Principal;
  repository: RecordsRepository;
  request: PayloadRequest;
  includeChat: boolean;
}): Promise<EventSourcesResult> {
  const messages: EventSourceMessage[] = [];
  const seen = new Set<string>();
  let unavailableCount = 0;
  const add = (key: string, message: EventSourceMessage) => {
    if (seen.has(key)) return;
    seen.add(key);
    messages.push(message);
  };

  const wechatRefs = input.event.sources.filter(ref => ref.kind === "wechat");
  let storedMessages: StoredMessage[] | undefined;
  const listStoredMessages = async () => storedMessages ??= await input.repository.list<StoredMessage>("care-messages", input.babyId, input.request);
  if (wechatRefs.length) {
    const storedMessages = await listStoredMessages();
    const sourceIndex = new Map<string, SourceMessage>();
    for (const stored of storedMessages) {
      const source = stored.source;
      const key = sourceWechatKey(source);
      const previous = sourceIndex.get(key);
      if (!previous || previous.sourceId.localeCompare(source.sourceId) > 0) sourceIndex.set(key, source);
    }

    for (const ref of wechatRefs) {
      const key = refWechatKey(ref);
      if (seen.has(key)) continue;
      const source = sourceIndex.get(key);
      if (!source) {
        unavailableCount += 1;
        add(key, {
          id: `missing:wechat:${ref.accountId}:${ref.conversationId}:${ref.messageId}`,
          kind: "wechat",
          senderId: ref.senderId || null,
          sentAt: ref.sentAt,
          text: null,
        });
        continue;
      }
      add(key, {
        id: source.sourceId,
        kind: "wechat",
        senderId: source.senderId,
        ...(source.senderName ? { senderName: source.senderName } : {}),
        ...(source.senderAvatarUrl && isSafeWechatAvatarUrl(source.senderAvatarUrl) ? { senderAvatarUrl: source.senderAvatarUrl } : {}),
        sentAt: source.sentAt,
        text: source.text,
      });
    }
  }

  // Manual sources are not generally expandable. Only a marked acceptance fixture
  // with an independently stored, exact event+manual-ref join may expose simulated text.
  const manualRefs = input.event.facts.notes?.startsWith("[测试记录]")
    ? input.event.sources.filter(ref => ref.kind === "manual" && ref.conversationId === "acceptance-feedback")
    : [];
  if (manualRefs.length) {
    const exactManualRefs = new Map(manualRefs.map(ref => [hash(ref), ref]));
    for (const stored of await listStoredMessages()) {
      const link: AcceptanceTestSourceLink | undefined = stored.acceptanceSource;
      if (!link || link.kind !== "acceptance-test-original/v1" || link.eventId !== input.event.id ||
          !/^[a-f0-9]{64}$/.test(link.operationFingerprint) || !/^[a-f0-9]{64}$/.test(link.sourceHash) ||
          link.sourceHash !== stored.contentHash || !exactManualRefs.has(hash(link.manualRef)) ||
          stored.state !== "processed" || stored.source.accountId !== "acceptance-test" ||
          stored.source.groupId !== "acceptance-test:fixture" || stored.source.chatId !== "acceptance-feedback@test" ||
          stored.source.databaseId !== "test/acceptance-originals" || stored.source.tableName !== "SyntheticMessage" ||
          stored.source.kind !== "text" || stored.source.media.length ||
          (stored.privacyExpired === true
            ? stored.source.text !== "" || !/^[a-f0-9]{64}$/.test(stored.contentHash)
            : hash(sourceFingerprint(stored.source)) !== stored.contentHash)) continue;
      const key = testKey(stored.source);
      if (seen.has(key)) continue;
      const unavailable = stored.privacyExpired === true || stored.source.text === "";
      if (unavailable) unavailableCount += 1;
      add(key, {
        id: stored.source.sourceId,
        kind: "test",
        label: "测试记录 · 模拟消息",
        senderId: stored.source.senderId,
        ...(stored.source.senderName ? { senderName: stored.source.senderName } : {}),
        sentAt: stored.source.sentAt,
        text: unavailable ? null : stored.source.text,
      });
    }
  }

  if (input.includeChat) {
    const chat = new ChatRepository(input.repository.payload);
    for (const ref of input.event.sources) {
      if (ref.kind !== "chat" || ref.accountId !== input.principal.subjectId) continue;
      const key = chatKey(ref);
      if (seen.has(key)) continue;
      const turn = await chat.get(input.principal.subjectId, input.babyId, ref.messageId, input.request);
      if (!turn || turn.id !== ref.messageId || turn.conversationId !== ref.conversationId) {
        unavailableCount += 1;
        add(key, {
          id: ref.messageId,
          kind: "chat",
          senderId: ref.senderId || input.principal.subjectId,
          sentAt: ref.sentAt,
          text: null,
        });
        continue;
      }
      add(key, {
        id: turn.id,
        kind: "chat",
        senderId: input.principal.subjectId,
        senderName: "我",
        sentAt: turn.createdAt,
        text: turn.input.text,
      });
    }
  }

  return {
    babyId: input.babyId,
    eventId: input.event.id,
    messages: messages.sort(chronological),
    unavailableCount,
  };
}

export function assertEventSourceTarget(babyId: string, eventId: string): void {
  if (!babyId || !eventId) throw new AppError(400, "INVALID_INPUT", "宝宝和记录 ID 必填。");
}
