import { createHash } from "node:crypto";
import { z } from "zod";
import type { Payload, PayloadRequest } from "payload";
import lexicon from "../moderation/lexicon";
import { AppError } from "../domain/contracts";

export const RULE_VERSION = "aj-safety-context-v7";
export const builtinLexicon = { version: lexicon.version, sha256: createHash("sha256").update(JSON.stringify(lexicon.words)).digest("hex"), count: lexicon.words.length };
export const categories = ["violence", "self_harm", "sexual", "hate", "privacy", "fraud", "harassment", "other"] as const;
export const roleOf = (user: unknown) => {
  const value = user as { collection?: string; role?: string } | null;
  return value?.collection === "admins" ? (value.role || "administrator") : undefined;
};
export const canReview = (user: unknown) => ["administrator", "reviewer"].includes(roleOf(user) || "");
export const isAdministrator = (user: unknown) => roleOf(user) === "administrator";
export const canAudit = (user: unknown) => ["administrator", "auditor"].includes(roleOf(user) || "");
export const internal = (req: PayloadRequest) => req.context.safetyInternal === true;
export const ruleSchema = z.object({
  version: z.string().trim().min(3).max(80), reason: z.string().trim().min(8).max(1000),
  mode: z.enum(["all", "keywords"]), extraWords: z.array(z.string().trim().min(1).max(80)).max(1000),
  ignoredWords: z.array(z.string().trim().min(1).max(80)).max(1000),
}).strict();
export type Rule = z.infer<typeof ruleSchema> & { id?: number; lexiconVersion: string; lexiconHash: string; promptVersion: string };
export const defaultRule: Rule = { version: "builtin-full-review-v7", reason: "输入输出默认全量语境审核；正式发布仍须回归留痕", mode: "all", extraWords: [], ignoredWords: [], lexiconVersion: builtinLexicon.version, lexiconHash: builtinLexicon.sha256, promptVersion: RULE_VERSION };
export const settingSchema = z.object({
  acceptanceHours: z.number().int().min(1).max(168), resolutionHours: z.number().int().min(1).max(720),
  feedbackHours: z.number().int().min(1).max(168), evidenceDays: z.number().int().min(1).max(30).default(30),
  retentionBasis: z.string().trim().min(10).max(1000), staffing: z.string().trim().min(5).max(500),
  reason: z.string().trim().min(8).max(1000),
}).strict();
export const normalizeEvidenceDays = (value: unknown) => Math.min(30, Math.max(1, Number(value) || 30));
export const finiteRetentionBasis = "安全审核和投诉处置所需的最小证据，自案件创建起最多保留30天";
export const normalizeRetentionBasis = (value: unknown) => {
  const basis = typeof value === "string" ? value.trim() : "";
  return !basis || /(永久|无限|不自动到期|长期保留)/.test(basis) ? finiteRetentionBasis : basis;
};
export async function settings(payload: Payload, req?: Partial<PayloadRequest>) {
  const result = await payload.find({ collection: "safety-settings", overrideAccess: true, limit: 1, req, sort: "-id" });
  const row = result.docs[0];
  // Legacy 0 meant unlimited. It is never copied into a newly created case.
  return row ? { ...row, evidenceDays: normalizeEvidenceDays(row.evidenceDays), retentionBasis: normalizeRetentionBasis(row.retentionBasis) } : undefined;
}
export async function activeRule(payload: Payload): Promise<Rule> {
  const release = (await payload.find({ collection: "safety-releases", limit: 1, sort: "-id", overrideAccess: true })).docs[0];
  if (!release) return defaultRule;
  const rule = await payload.findByID({ collection: "safety-rules", id: Number(release.ruleId), overrideAccess: true });
  if (rule.lexiconHash !== builtinLexicon.sha256 || rule.promptVersion !== RULE_VERSION)
    throw new AppError(503, "安全规则与当前程序版本不一致，请运营复核并重新发布");
  return rule as unknown as Rule;
}
