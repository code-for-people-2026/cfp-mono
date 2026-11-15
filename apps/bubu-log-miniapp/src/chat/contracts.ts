import { array, object, ResponseFormatError } from "../api/contracts";
import type { ChatRequest } from "./drafts";
export interface FieldPending { prompt?: string; kind: "fields"; id: string; babyId: string; eventId: string; version: number; eventVersion: number; fields: string[]; conflicts: string[]; duplicateCandidates: string[]; state: "open" | "resolved" | "dismissed" }
export interface MediaPending { prompt?: string; kind: "media"; id: string; babyId: string; eventIds: string[]; state: "open"; sentAt?: string; media: Array<{ index: number; state: string }> }
export type ChatPending = FieldPending | MediaPending;
export interface ChatTurn {
  id: string; requestId: string; babyId: string; createdAt: string; updatedAt: string;
  status: "processing" | "completed" | "failed" | "needs_recovery";
  input: Omit<ChatRequest, "babyId" | "requestId">; assistantText: string; replySource?: "ai" | "safety";
  receipts: Array<{ status: "saved" | "needs_information" | "pending_projection" | "conflict" } | { kind: "media"; state: "resolved" | "open" }>;
  pending: ChatPending[]; refreshRequired: boolean; error?: { code: string; message: string; retryable: boolean };
}
export interface ChatHistory { babyId: string; conversationId: string; turns: ChatTurn[]; pending: ChatPending[]; pendingCount: number }
export interface Attachment { id: string; babyId: string; url: string; mime: "image/jpeg" | "image/png" | "image/webp"; byteLength: number }
const text = (value: unknown): string => { if (typeof value !== "string") throw new ResponseFormatError(); return value; };
const id = (value: unknown): string => { const result = text(value); if (!result.trim()) throw new ResponseFormatError(); return result; };
const integer = (value: unknown): number => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ResponseFormatError(); return value; };
const bool = (value: unknown): boolean => { if (typeof value !== "boolean") throw new ResponseFormatError(); return value; };
const date = (value: unknown): string => { const result = text(value); if (!Number.isFinite(Date.parse(result))) throw new ResponseFormatError(); return result; };
function choice<T extends string>(value: unknown, choices: readonly T[]): T { const match = choices.find(item => item === value); if (!match) throw new ResponseFormatError(); return match; }
export const attachmentUrl = (babyId: string, attachmentId: string) => `/api/app/attachments/${attachmentId}?babyId=${encodeURIComponent(babyId)}`;
export function decodeAttachment(value: unknown, babyId: string): Attachment {
  const row = object(value), attachmentId = id(row.id);
  if (row.babyId !== babyId || !/^att_[a-f0-9]{64}$/.test(attachmentId) || row.url !== attachmentUrl(babyId, attachmentId)) throw new ResponseFormatError();
  return { id: attachmentId, babyId, url: row.url, mime: choice(row.mime, ["image/jpeg", "image/png", "image/webp"] as const), byteLength: integer(row.byteLength) };
}
export function decodePending(value: unknown, babyId: string): ChatPending {
  const row = object(value);
  if (row.babyId !== babyId) throw new ResponseFormatError();
  if (row.kind === "media") return { ...(typeof row.prompt === "string" ? { prompt: row.prompt } : {}), kind: "media", id: id(row.id), babyId, state: choice(row.state, ["open"] as const), eventIds: array(row.eventIds, id),
    ...(row.source && object(row.source).sentAt ? { sentAt: date(object(row.source).sentAt) } : {}),
    media: array(row.media, item => { const media = object(item); return { index: integer(media.index), state: choice(media.state, ["unavailable", "unlinked"] as const) }; }) };
  const version = integer(row.version), eventVersion = integer(row.eventVersion);
  if (!version || !eventVersion) throw new ResponseFormatError();
  return { ...(typeof row.prompt === "string" ? { prompt: row.prompt } : {}), kind: "fields", id: id(row.id), babyId, eventId: id(row.eventId), version, eventVersion, fields: array(row.fields, id),
    conflicts: array(row.conflicts, item => id(object(item).code)), duplicateCandidates: array(row.duplicateCandidates, id), state: choice(row.state, ["open", "resolved", "dismissed"] as const) };
}
export function decodeTurn(value: unknown, babyId: string): ChatTurn {
  const row = object(value), input = object(row.input), context = object(input.context);
  if (row.babyId !== babyId) throw new ResponseFormatError();
  const viewedDate = text(context.viewedDate); if (!/^\d{4}-\d{2}-\d{2}$/.test(viewedDate)) throw new ResponseFormatError();
  const attachments = array(input.attachmentIds, id); if (attachments.length > 3 || attachments.some(value => !/^att_[a-f0-9]{64}$/.test(value))) throw new ResponseFormatError();
  const question = input.question ? object(input.question) : undefined;
  const error = row.error ? object(row.error) : undefined;
  return { id: id(row.id), requestId: id(row.requestId), babyId, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt), status: choice(row.status, ["processing", "completed", "failed", "needs_recovery"] as const),
    input: { text: text(input.text), attachmentIds: attachments, context: { viewedDate, ...(context.selectedEventId ? { selectedEventId: id(context.selectedEventId) } : {}), ...(context.mediaPendingId ? { mediaPendingId: id(context.mediaPendingId) } : {}) },
      ...(question ? { question: { id: id(question.id), questionVersion: integer(question.questionVersion), eventVersion: integer(question.eventVersion) } } : {}) },
    assistantText: text(row.assistantText), replySource: row.replySource === "safety" ? "safety" : "ai", receipts: array(row.receipts, item => { const receipt = object(item); return receipt.kind === "media" ? { kind: "media" as const, state: choice(receipt.state, ["resolved", "open"] as const) } : { status: choice(receipt.status, ["saved", "needs_information", "pending_projection", "conflict"] as const) }; }),
    pending: array(row.pending, value => decodePending(value, babyId)), refreshRequired: bool(row.refreshRequired),
    ...(error ? { error: { code: id(error.code), message: text(error.message), retryable: bool(error.retryable) } } : {}) };
}
export function decodeHistory(value: unknown, babyId: string): ChatHistory {
  const row = object(value); if (row.babyId !== babyId) throw new ResponseFormatError();
  return { babyId, conversationId: id(row.conversationId), turns: array(row.turns, value => decodeTurn(value, babyId)), pending: array(row.pending, value => decodePending(value, babyId)), pendingCount: integer(row.pendingCount) };
}
export const fieldLabels: Record<string, string> = { type: "活动类型", startTime: "发生时间", endTime: "结束时间", durationMinutes: "时长", milkAmount: "喝入奶量", milkSource: "奶来源", preparedMilkAmount: "泡好奶量", remainingMilkAmount: "剩余奶量", sameBottle: "是否同一瓶", burpSuccess: "拍嗝结果", breastFirmness: "乳房软硬", hasPoop: "是否有便", hasPee: "是否有尿", poopColor: "大便颜色", peeAmount: "尿量", count: "次数", supplementType: "补剂类型", spitUpType: "吐奶类型" };
const fieldQuestions: Record<string, string> = {
  type: "这次是什么活动？", startTime: "大约是什么时候发生的？", endTime: "这次已经结束了吗？什么时候结束的？", durationMinutes: "这次大约持续了多久？",
  milkSource: "奶瓶里是母乳还是配方奶？", milkAmount: "宝宝实际喝了多少毫升？", preparedMilkAmount: "这瓶奶一开始泡好了多少毫升？", remainingMilkAmount: "这瓶奶还剩多少毫升？", sameBottle: "泡好和剩下的奶量是同一瓶吗？",
  burpSuccess: "结束后拍嗝成功了吗？", breastFirmness: "亲喂后乳房是柔软还是仍然偏硬？", hasPoop: "这次尿布里有大便吗？", hasPee: "这次尿布里有尿吗？", poopColor: "大便是什么颜色？", peeAmount: "尿量大约是少量、中等还是大量？",
  count: "这次明确做了多少次？", supplementType: "补充的是 AD、D3、益生菌还是益生元？", spitUpType: "这次是普通吐奶，还是喷射状吐奶？",
};
export function pendingLabel(item: ChatPending): string {
  if (item.prompt) return item.prompt;
  if (item.kind === "media") return "能补发这条群记录的照片吗？没有也可以告诉我。";
  if (item.duplicateCandidates.length) return "这与另一条记录是同一次吗？";
  if (item.conflicts.length) return "这条记录有需要核对的信息，可以说明实际情况吗？";
  return (fieldQuestions[item.fields[0]!] || "可以补充一下这条记录的情况吗？") + (item.fields.length > 1 ? `（另有 ${item.fields.length - 1} 项）` : "");
}
export function receiptLabels(turn: ChatTurn): string[] { return [...new Set(turn.receipts.map(receipt => "kind" in receipt ? receipt.state === "resolved" ? "图片待补事项已处理" : "图片仍待补充" : { saved: "已记录", needs_information: "已有内容已保存，仍待补充", pending_projection: "保存尚未确认，待恢复", conflict: "信息待核对" }[receipt.status]))]; }
