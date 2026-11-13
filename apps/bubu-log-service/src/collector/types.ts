/** A source sender is provenance, never an authenticated Actor. */
export interface SourceMessage {
  sourceId: string;
  accountId: string;
  groupId: string;
  chatId: string;
  databaseId: string;
  tableName: string;
  localId: number;
  sentAt: string;
  senderId: string | null;
  kind: "text" | "image" | "voice" | "video" | "file" | "system" | "other";
  text: string;
  media: SourceMedia[];
}
export interface SourceMedia {
  sourceId: string;
  kind: "image" | "voice" | "video" | "file";
  state: "unresolved";
  fingerprint?: string;
  reason: string;
}
/** Resolution is separate from immutable captured source evidence. */
export interface MediaResolution {
  sourceId: string;
  index: number;
  state: "uploaded" | "unavailable";
  attachmentId?: string;
  reason?: string;
}
export type SourceCursor = Record<string, number>;
export interface SourcePage { messages: SourceMessage[]; nextCursor: SourceCursor; hasMore: boolean }
export interface SourceRead {
  accountId: string;
  chatId: string;
  cursor: SourceCursor;
  limit: number;
  range?: { from: string; to: string };
}
export interface SourceReader { read(input: SourceRead): Promise<SourcePage> }
export function canonicalGroupId(accountId: string, chatId: string): string {
  if (!/^[\w.-]{1,128}$/.test(accountId) || !/^[\w.-]{1,160}@chatroom$/.test(chatId)) throw new Error("INVALID_WECHAT_GROUP");
  const groupId = `wechat:${accountId}:${chatId}`;
  if (groupId.length > 200) throw new Error("INVALID_WECHAT_GROUP");
  return groupId;
}
