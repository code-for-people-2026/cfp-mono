import { APIError, type CollectionConfig, type PayloadRequest } from "payload";
import type { Store } from "../store";
import { membershipPolicySchema, type MembershipPolicy } from "./contracts";
import { z } from "zod";

export const membershipCollections: CollectionConfig[] = ["service-memberships", "service-membership-changes"].map(slug => ({
  slug, timestamps: true, lockDocuments: false, admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: {
    beforeChange: [({ req, operation, data }) => {
      if (req.context.bubuInternal !== true || (slug === "service-membership-changes" && operation === "update")) throw new APIError("请使用受控服务权益操作。", 403);
      return data;
    }],
    beforeDelete: [() => { throw new APIError("服务权益及变更记录不可直接删除。", 403); }],
  },
  fields: [{ name: "id", type: "text" }, { name: "key", type: "text", required: true, unique: true },
    { name: "babyId", type: "text", required: true, index: true }, { name: "value", type: "json", required: true }],
}));
const stateSchema = z.object({ version: z.number().int().positive(), policy: membershipPolicySchema }).strict();
export interface MembershipState { version: number; policy: MembershipPolicy }
export interface MembershipChange {
  version: number; action: string; at: string; actorId: string; reason: string; fingerprint: string;
  before: MembershipState; after: MembershipState;
}
/** Uses the existing Payload transaction. The change row also serves as the command's durable receipt. */
export class MembershipRepository {
  constructor(readonly store: Store) {}
  async state(babyId: string, req: PayloadRequest): Promise<MembershipState | undefined> {
    const result = await this.store.payload.find({ collection: "service-memberships", where: { key: { equals: babyId } }, limit: 1, overrideAccess: true, depth: 0, req });
    const row = result.docs[0];
    if (!row) return undefined;
    if (row.babyId !== babyId) throw new Error("Membership scope mismatch");
    return stateSchema.parse(row.value);
  }
  async change(key: string, babyId: string, req: PayloadRequest): Promise<MembershipChange | undefined> {
    const row = (await this.store.payload.find({ collection: "service-membership-changes", where: { and: [{ key: { equals: key } }, { babyId: { equals: babyId } }] }, limit: 1, overrideAccess: true, depth: 0, req })).docs[0];
    return row?.value as MembershipChange | undefined;
  }
  async changes(babyId: string, req: PayloadRequest) {
    const result = await this.store.payload.find({ collection: "service-membership-changes", where: { babyId: { equals: babyId } }, sort: "-createdAt", limit: 100, overrideAccess: true, depth: 0, req });
    return result.docs.map(row => { const value = row.value as MembershipChange; return { version: value.version, action: value.action, at: value.at, actorId: value.actorId, reason: value.reason }; }).sort((a,b) => b.version-a.version);
  }
  async save(babyId: string, key: string, change: MembershipChange, req: PayloadRequest) {
    const payload = this.store.payload;
    const data = { id: babyId, key: babyId, babyId, value: change.after };
    if (change.before.version) await payload.update({ collection: "service-memberships", id: babyId, data: { value: change.after }, overrideAccess: true, req });
    else await payload.create({ collection: "service-memberships", data, overrideAccess: true, req });
    await payload.create({ collection: "service-membership-changes", data: { id: key, key, babyId, value: change }, overrideAccess: true, req });
  }
}
