import type { CollectionConfig, CollectionBeforeChangeHook } from "payload";
import { AppError } from "../domain/contracts";

export const privacyCollections: CollectionConfig[] = [{
  slug: "privacy-profiles", lockDocuments: false, admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeChange: [({ originalDoc, data }) => {
    if (originalDoc?.state === "deleted" && data.state && data.state !== "deleted") throw new AppError(409, "已删除状态不可回退");
    if (["deleting", "deleted"].includes(originalDoc?.state) && !["deleting", "deleted"].includes(data.state || originalDoc.state)) throw new AppError(409, "删除状态不能恢复为处理状态");
    return data;
  }] },
  fields: [
    { name: "owner", type: "text", required: true, unique: true },
    { name: "state", type: "select", options: ["active", "withdrawn", "deleting", "deleted"], required: true },
    { name: "revision", type: "number", required: true, defaultValue: 0, min: 0 },
    { name: "consent", type: "json" },
    { name: "sensitiveHistory", type: "checkbox", defaultValue: false },
    { name: "historyInspected", type: "checkbox", defaultValue: false },
    { name: "events", type: "json" },
    { name: "recoveryDigest", type: "text", unique: true },
    { name: "expiresAt", type: "date" },
    { name: "deletedAt", type: "date" },
  ],
}];

// Runs inside the same Local API transaction as the write. A late model/OSS
// response cannot resurrect data after withdrawal or a deletion tombstone.
export const guardPrivacyWrite: CollectionBeforeChangeHook = async ({ req, data }) => {
  if (typeof data.owner !== "string") return data;
  const result = await req.payload.find({ collection: "privacy-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: data.owner } } });
  const profile = result.docs[0];
  if (profile && (profile.state !== "active" || (profile.expiresAt && Date.parse(String(profile.expiresAt)) <= Date.now())))
    throw new AppError(403, "已停止处理此身份的数据，请查看隐私与数据设置");
  return data;
};
