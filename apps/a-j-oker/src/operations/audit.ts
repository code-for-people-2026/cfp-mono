import type { SafetyAudit } from "../payload-types";
import type { CollectionAfterChangeHook, CollectionAfterReadHook, Payload, PayloadRequest } from "payload";
import { isAdministrator } from "./policy";
export async function audit(payload: Payload, actor: string, event: string, target: string, reason: string, metadata?: SafetyAudit["metadata"], req?: Partial<PayloadRequest>) {
  return payload.create({ collection: "safety-audit", overrideAccess: true, req: req ? { ...req, context: { ...req.context, safetyInternal: true } } : undefined, context: { safetyInternal: true }, data: { actor, event, target, reason, metadata } });
}
export const adminPermissionAudit: CollectionAfterChangeHook = async ({ req, doc, previousDoc, operation }) => {
  if (operation === "create" || doc.role !== previousDoc?.role || doc.email !== previousDoc?.email)
    await audit(req.payload, req.user ? `admin:${req.user.id}` : "bootstrap", "permission.change", `admin:${doc.id}`, "管理员账户创建或权限变更", { beforeRole: previousDoc?.role ?? null, afterRole: doc.role }, req);
  return doc;
};
export const sensitiveReadAudit: CollectionAfterReadHook = async ({ req, doc, collection }) => {
  if (isAdministrator(req.user) && !req.context.safetyInternal)
    await audit(req.payload, `admin:${req.user!.id}`, "business.read", `${collection.slug}:${doc.id}`, "管理员查看原始业务记录", undefined, req);
  return doc;
};
