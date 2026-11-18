import { createHash } from "node:crypto";
import { z } from "zod";
import type { Payload, PayloadRequest, Where } from "payload";
import lexicon from "../moderation/lexicon";
import type { SafetyCase } from "../payload-types";
import { AppError } from "../domain/contracts";

export const RULE_VERSION = "aj-safety-context-v7";
export const builtinLexicon = { version: lexicon.version, sha256: createHash("sha256").update(JSON.stringify(lexicon.words)).digest("hex"), count: lexicon.words.length };
export const categories = ["violence", "self_harm", "sexual", "hate", "privacy", "fraud", "harassment", "other"] as const;
export const roleOf = (user: unknown) => {
  const value = user as { collection?: string; role?: string } | null;
  return value?.collection === "admins" ? (value.role || "administrator") : undefined;
};
export const canReview = (user: unknown) => ["administrator", "reviewer", "appeal_reviewer"].includes(roleOf(user) || "");
export const isAdministrator = (user: unknown) => roleOf(user) === "administrator";
export const isAppealReviewer = (user: unknown) => roleOf(user) === "appeal_reviewer";
export const canAudit = (user: unknown) => ["administrator", "auditor"].includes(roleOf(user) || "");
const appealReviewerCaseScope = (userId: string | number): Where => ({
  or: [
    { parentId: { exists: true } },
    { status: { equals: "review" } },
    // A reviewer may still reach their own resolved case to provide feedback,
    // without making every unrelated resolved root case readable.
    { and: [{ status: { equals: "resolved" } }, { lastReviewer: { equals: userId } }] },
  ],
});
export const canReadSafetyCases = (user: unknown, slug: string) => {
  if (!isAppealReviewer(user)) return canReview(user);
  // The bounded role currently has exactly one review-readable collection. Keep
  // the mapping explicit so adding another review collection cannot silently
  // apply safety-case-only fields (parentId/status) to a schema lacking them.
  return slug === "safety-cases" ? appealReviewerCaseScope((user as { id?: string | number }).id ?? "") : false;
};
const isAppealReviewCase = (user: unknown, row: Pick<SafetyCase, "parentId" | "status" | "lastReviewer">) => {
  if (!isAppealReviewer(user)) return false;
  return row.parentId != null || row.status === "review" ||
    (row.status === "resolved" && row.lastReviewer != null && String(row.lastReviewer) === String((user as { id?: string | number }).id));
};
export const canWorkCase = (user: unknown, row: Pick<SafetyCase, "parentId" | "status" | "lastReviewer">) => isAppealReviewCase(user, row) || (!isAppealReviewer(user) && canReview(user));
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

const MAX_CASE_ANCESTRY_DEPTH = 32;
const CASE_DECISION_EVENTS = [
  "case.reject", "case.dismiss", "case.quarantine", "case.restore", "case.restrict", "case.unrestrict",
  "case.permit_age_reverification", "case.maintain_age_restriction", "case.restore_age_access",
] as const;

type TypedUserLike = { id: string | number };

const positiveIntegerId = (value: unknown, label: string) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(409, `${label}不合法，不能处理此案件`);
  return id;
};

const decisionActor = (value: string | number | null | undefined) => {
  if (value == null) return undefined;
  const actor = String(value);
  return actor.startsWith("admin:") ? actor.slice("admin:".length) : undefined;
};

async function firstDecisiveActor(payload: Payload, row: SafetyCase, req: PayloadRequest) {
  const rowAudit = (await payload.find({ collection: "safety-audit", overrideAccess: true, req, limit: 1, sort: "id", where: {
    and: [{ target: { equals: `case:${row.id}` } }, { event: { in: [...CASE_DECISION_EVENTS] } }],
  } })).docs[0];
  return decisionActor(rowAudit?.actor) ?? (row.lastReviewer == null ? undefined : String(row.lastReviewer));
}

type CaseAncestry = {
  chain: SafetyCase[];
  root: SafetyCase;
  immediateActor?: string;
  originalActor?: string;
  awaitingInitialAgeDecision: boolean;
};

// Parent links are stored as numeric Payload IDs. Validate the complete but
// bounded chain before every decision, so a missing, forged, cyclic, wrong-owner,
// or unbounded ancestry can never become an authorization bypass. Independence
// intentionally uses only two actors: the immediate parent's current reviewer,
// and the root's earliest decisive reviewer for recovery actions. Earlier
// intermediate reviewers therefore remain eligible for later repeat appeals.
export async function validateCaseAncestry(payload: Payload, row: SafetyCase, req: PayloadRequest): Promise<CaseAncestry> {
  const chain: SafetyCase[] = [row];
  const seen = new Set<number>([positiveIntegerId(row.id, "案件 ID")]);
  let current = row;
  while (current.parentId != null) {
    if (chain.length >= MAX_CASE_ANCESTRY_DEPTH) throw new AppError(409, "案件父级层级过深，不能自动复核；请新建独立说明案件");
    const parentId = positiveIntegerId(current.parentId, "原案件 ID");
    if (parentId >= positiveIntegerId(current.id, "案件 ID") || seen.has(parentId))
      throw new AppError(409, "案件父级关系不安全或成环，不能处理");
    const parent = (await payload.find({ collection: "safety-cases", overrideAccess: true, req, limit: 1, where: { id: { equals: parentId } } })).docs[0] as SafetyCase | undefined;
    if (!parent || parent.owner !== row.owner || parent.status !== "resolved" || parent.lastReviewer == null)
      throw new AppError(409, "案件父级缺失、未形成结论或不属于同一身份，不能处理");
    seen.add(parentId);
    chain.push(parent);
    current = parent;
  }
  const root = chain[chain.length - 1];
  const parent = chain[1];
  const immediateActor = parent?.lastReviewer == null
    ? row.lastReviewer == null ? undefined : String(row.lastReviewer)
    : String(parent.lastReviewer);
  const originalActor = await firstDecisiveActor(payload, root, req);
  // Only an unresolved age-review root with no recorded decision has no prior
  // human decision. A legacy recorded action or reviewer without an
  // attributable audit actor remains an unknown prior decision and must never
  // authorize recovery through a missing actor.
  const awaitingInitialAgeDecision = row.parentId == null && root.stage === "age_review"
    && root.status !== "resolved" && root.action == null && root.lastReviewer == null && originalActor == null;
  return { chain, root, immediateActor, originalActor, awaitingInitialAgeDecision };
}

const recoversPriorDecision = (action: string) => ["restore", "unrestrict", "restore_age_access"].includes(action);

export function assertIndependentReviewer(ancestry: CaseAncestry, user: TypedUserLike, action: string) {
  const id = String(user.id);
  if (ancestry.immediateActor === id)
    throw new AppError(403, ancestry.chain.length > 1 ? "申诉须由原处置人以外的人员复核" : "复核须由不同人员完成");
  if (recoversPriorDecision(action)) {
    if (ancestry.originalActor == null && !ancestry.awaitingInitialAgeDecision)
      throw new AppError(409, "无法确认原决定人，不能恢复原案件限制；请新建人工核实流程");
    if (ancestry.originalActor === id) throw new AppError(403, "原决定人不能恢复本人作出的限制");
  }
}
