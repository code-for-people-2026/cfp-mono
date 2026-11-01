import type { CollectionConfig, Payload, PayloadRequest, Where } from "payload";

export const privacyTables = ["privacy-state", "privacy-requests", "safety-signals"] as const;
type Table = typeof privacyTables[number];
export const privacyCollections: CollectionConfig[] = privacyTables.map(slug => ({
  slug, timestamps: true, admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [{ name: "id", type: "text" }, { name: "key", type: "text", required: true, unique: true },
    { name: "identityId", type: "text", index: true }, { name: "babyId", type: "text", index: true }, { name: "value", type: "json", required: true }],
}));
export interface PrivacyRow<T> { id: string; key: string; identityId?: string; babyId?: string; value: T }
export class PrivacyRepository {
  constructor(readonly payload: Payload, private readonly currentRequest?: () => PayloadRequest | undefined) {}
  async list<T>(table: Table, where?: Where, req?: PayloadRequest): Promise<PrivacyRow<T>[]> {
    req ??= this.currentRequest?.();
    const result = await this.payload.find({ collection: table, where, pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
    return result.docs as unknown as PrivacyRow<T>[];
  }
  async get<T>(table: Table, key: string, req?: PayloadRequest): Promise<T | undefined> { return (await this.list<T>(table, { key: { equals: key } }, req))[0]?.value; }
  async put<T>(table: Table, key: string, value: T, scope: { identityId?: string; babyId?: string }, req?: PayloadRequest) {
    req ??= this.currentRequest?.();
    const existing = (await this.list(table, { key: { equals: key } }, req))[0];
    if (existing && (existing.identityId !== scope.identityId && !(existing.identityId == null && scope.identityId == null) || existing.babyId !== scope.babyId && !(existing.babyId == null && scope.babyId == null))) throw new Error("Privacy namespace mismatch");
    const data = { key, ...scope, value };
    if (existing) await this.payload.update({ collection: table, id: existing.id, data, overrideAccess: true, req });
    else await this.payload.create({ collection: table, data: { id: key, ...data }, overrideAccess: true, req });
  }
}
