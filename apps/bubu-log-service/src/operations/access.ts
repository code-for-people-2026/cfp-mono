import type { Payload, PayloadRequest } from "payload";
import { AppError } from "../contracts";

export type OpsRole = "administrator" | "operator" | "auditor";
export interface OpsUser { id: string | number; email: string; role: OpsRole; babyIds: string[]; active: boolean; collection: "ops-users" }
const denied = (): never => { throw new AppError(403, "OPS_FORBIDDEN", "没有此运营操作的权限。"); };
/** The cookie/JWT is only an identity proof; scopes and disabled state are always read afresh. */
export async function readOpsUser(payload: Payload, user: unknown, req?: PayloadRequest): Promise<OpsUser> {
  if (!user || typeof user !== "object" || !("collection" in user) || user.collection !== "ops-users" || !("id" in user) || (typeof user.id !== "string" && typeof user.id !== "number")) return denied();
  const doc = await payload.findByID({ collection: "ops-users", id: user.id, overrideAccess: true, depth: 0, req, disableErrors: true });
  if (!doc || doc.active !== true || !["administrator", "operator", "auditor"].includes(String(doc.role))) return denied();
  return { id: doc.id, email: String(doc.email), role: doc.role as OpsRole, active: true, collection: "ops-users", babyIds: Array.isArray(doc.babyIds) ? doc.babyIds.filter((id: unknown): id is string => typeof id === "string" && !!id.trim()) : [] };
}
export function requireBaby(user: OpsUser, babyId: string, write = false): void {
  if (!user.active || !babyId || !user.babyIds.includes(babyId) || (write && user.role === "auditor")) denied();
}
export async function opsAdmin(payload: Payload, user: unknown, req?: PayloadRequest): Promise<boolean> {
  try { return (await readOpsUser(payload, user, req)).role === "administrator"; } catch { return false; }
}
