import { AppError } from "../contracts";
import type { CollectionConfig, Payload, PayloadRequest } from "payload";
import type { ChatTurn, ProviderCall, ProviderMessage } from "./contracts";

const chatTables = ["chat-turns"] as const;
export const chatCollections: CollectionConfig[] = chatTables.map(slug => ({
  slug, timestamps: true,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: "id", type: "text" }, { name: "key", type: "text", required: true, unique: true },
    { name: "identityId", type: "text", required: true, index: true },
    { name: "babyId", type: "text", required: true, index: true },
    { name: "value", type: "json", required: true },
  ],
}));

export interface ChatStep {
  call: ProviderCall;
  /** Immutable server-scoped MCP arguments, checkpointed before the network call. */
  arguments: Record<string, unknown>;
  state: "planned" | "calling" | "completed";
  result?: unknown;
}
export interface StoredTurn extends ChatTurn {
  privacyExpired?: boolean;
  identityId: string; fingerprint: string;
  transcript: ProviderMessage[];
  steps: ChatStep[];
  rounds: number;
  /** First observed versions pin this user action; a model cannot refresh them to overwrite someone else. */
  versions: Record<string, number>;
  questionVersions: Record<string, { questionVersion: number; eventVersion: number }>;
  modelContext?: Record<string, unknown>;
}

/** Private chat state only. No access to care records or the legacy database. */
export class ChatRepository {
  constructor(readonly payload: Payload) {}
  async list(identityId: string, babyId: string, req: PayloadRequest): Promise<StoredTurn[]> {
    const result = await this.payload.find({ collection: "chat-turns", where: { and: [{ identityId: { equals: identityId } }, { babyId: { equals: babyId } }] }, pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
    return result.docs.map(row => row.value as StoredTurn).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async get(identityId: string, babyId: string, key: string, req: PayloadRequest): Promise<StoredTurn | undefined> {
    const result = await this.payload.find({ collection: "chat-turns", where: { and: [{ key: { equals: key } }, { identityId: { equals: identityId } }, { babyId: { equals: babyId } }] }, limit: 1, depth: 0, overrideAccess: true, req });
    return result.docs[0]?.value as StoredTurn | undefined;
  }
  async put(turn: StoredTurn, req: PayloadRequest): Promise<void> {
    const old = await this.payload.find({ collection: "chat-turns", where: { key: { equals: turn.id } }, limit: 1, depth: 0, overrideAccess: true, req });
    if (old.docs[0] && (old.docs[0].value as StoredTurn).privacyExpired && !turn.privacyExpired) throw new AppError(409, "RETENTION_EXPIRED", "对话原文已清理，不能恢复旧内容。");
    if (old.docs[0] && (old.docs[0].identityId !== turn.identityId || old.docs[0].babyId !== turn.babyId)) throw new Error("Chat namespace mismatch");
    if (old.docs[0]) await this.payload.update({ collection: "chat-turns", id: old.docs[0].id, data: { value: turn }, overrideAccess: true, req });
    else await this.payload.create({ collection: "chat-turns", data: { id: turn.id, key: turn.id, identityId: turn.identityId, babyId: turn.babyId, value: turn }, overrideAccess: true, req });
  }
}
