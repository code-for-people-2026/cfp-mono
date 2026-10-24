export interface PrivacyPolicy { version: string; ready: boolean; contact: string; documents: { title: string; paragraphs: string[] }[]; retention: { chatDays: number; backupDays: number; orphanHours: number; responseDays: number } }
export interface PersonalChoice { policyVersion: string; accepted: true; adultCaregiver: true; sensitive: true; ai: boolean; images: boolean }
export interface GuardianChoice { policyVersion: string; guardian: true; sensitive: true; ai: boolean; images: boolean; collection: boolean; groupMembersInformed: boolean }
export interface PrivacyStatus { policy: PrivacyPolicy; consentCurrent: boolean; guardianCurrent: boolean; canManage: boolean; consent: (PersonalChoice & { revokedAt?: string }) | null; guardian: (GuardianChoice & { isOwn: boolean; replaceable?: boolean; revokedAt?: string }) | null }
export interface PrivacyRequest { id: string; kind: string; message: string; status: string; reply?: string; createdAt: string }
export interface DeletionIntent { token: string; confirmation: string; expiresAt: string; scope: "account" | "family"; consequences: string[] }
export interface DeletionJob { id: string; scope: "account" | "family"; status: "pending" | "running" | "retry" | "completed"; updatedAt: string }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("隐私说明读取失败，请重试。"); return value as Record<string, unknown>; }
export function decodePolicy(value: unknown): PrivacyPolicy {
  const row = object(value), retention = object(row.retention);
  if (typeof row.version !== "string" || typeof row.ready !== "boolean" || typeof row.contact !== "string" || !Array.isArray(row.documents) || !row.documents.every(doc => { const d = object(doc); return typeof d.title === "string" && Array.isArray(d.paragraphs) && d.paragraphs.every(p => typeof p === "string"); }) || !["chatDays", "backupDays", "orphanHours", "responseDays"].every(k => typeof retention[k] === "number")) throw new Error("隐私说明格式不完整，请稍后重试。");
  return row as unknown as PrivacyPolicy;
}
export function decodePrivacyStatus(value: unknown): PrivacyStatus {
  const row = object(value); decodePolicy(row.policy);
  if (!["consentCurrent", "guardianCurrent", "canManage"].every(k => typeof row[k] === "boolean") || ![row.consent, row.guardian].every(v => v === null || typeof v === "object" && v !== undefined)) throw new Error("隐私选择读取失败，请重试。");
  return row as unknown as PrivacyStatus;
}
