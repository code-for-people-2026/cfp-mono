import { createHash } from "node:crypto";
import type { CollectionConfig, PayloadRequest, Payload } from "payload";

export const recordTables = ["care-events", "care-operations", "care-revisions", "care-questions", "care-source-links", "care-attachments", "care-batches", "care-sync", "care-messages"] as const;
export type RecordTable = typeof recordTables[number];
export const recordCollections: CollectionConfig[] = recordTables.map(slug => ({
  slug, timestamps: true,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [{ name: "id", type: "text" }, { name: "key", type: "text", required: true, unique: true },
    { name: "babyId", type: "text", required: true, index: true }, { name: "value", type: "json", required: true }],
}));
export const hash = (value: unknown): string => createHash("sha256").update(stableJson(value)).digest("hex");
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Only call inside IdentityService.executeAuthorized; req carries the real SQLite transaction. */
export class RecordsRepository {
  constructor(readonly payload: Payload) {}
  async get<T>(table: RecordTable, babyId: string, key: string, req: PayloadRequest): Promise<T | undefined> {
    const rows = await this.payload.find({ collection: table, where: { and: [{ key: { equals: key } }, { babyId: { equals: babyId } }] }, limit: 1, depth: 0, overrideAccess: true, req });
    return rows.docs[0]?.value as T | undefined;
  }
  async list<T>(table: RecordTable, babyId: string, req: PayloadRequest): Promise<T[]> {
    const rows = await this.payload.find({ collection: table, where: { babyId: { equals: babyId } }, pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
    return rows.docs.map(row => row.value as T);
  }
  async put<T>(table: RecordTable, babyId: string, key: string, value: T, req: PayloadRequest): Promise<void> {
    const previous = await this.payload.find({ collection: table, where: { key: { equals: key } }, limit: 1, depth: 0, overrideAccess: true, req });
    if (previous.docs[0] && previous.docs[0].babyId !== babyId) throw new Error("Record namespace mismatch");
    if (previous.docs[0]) await this.payload.update({ collection: table, id: previous.docs[0].id, data: { value }, overrideAccess: true, req });
    else await this.payload.create({ collection: table, data: { id: key, key, babyId, value }, overrideAccess: true, req });
  }
}
