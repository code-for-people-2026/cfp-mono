import { createHash, randomUUID } from "node:crypto";
import type { Payload, PayloadRequest, TypedUser } from "payload";
import type { AgeProfile, SafetyCase } from "../payload-types";
import { AppError, type Owner } from "../domain/contracts";
import { audit } from "../operations/audit";
import { workingDeadline } from "../operations/deadlines";
import { isAdministrator, settings } from "../operations/policy";
import { transaction } from "../operations/transaction";

const AGE_REVIEW_STAGE = "age_review";
const AGE_REVIEW_CATEGORY = "other";
const CREATION = {
  request: { source: "complaint", evidence: "本人申请年龄限制复核。", actor: (owner: string) => `owner:${owner}`, reason: "本人申请年龄复核" },
  appeal: { source: "appeal", evidence: "本人就年龄限制结果再次申请复核。", actor: (owner: string) => `owner:${owner}`, reason: "本人再次申请年龄复核" },
  risk: { source: "moderation", evidence: "内部风险信号要求年龄复核。", actor: () => "system:age-risk", reason: "内部年龄风险信号" },
  minor: { source: "moderation", evidence: "本人核验返回新的未成年结果。", actor: () => "system:age-verification", reason: "本人核验的未成年结果" },
  declaration: { source: "moderation", evidence: "本人作出新的未满十四岁申报。", actor: (owner: string) => `owner:${owner}`, reason: "本人未满十四岁申报" },
  conflict: { source: "moderation", evidence: "本人申报与新的身份核验结果冲突。", actor: () => "system:age-verification", reason: "年龄申报与核验结果冲突" },
} as const;
type CreationKind = keyof typeof CREATION;

export const isAgeReviewCase = (row: Pick<SafetyCase, "stage">) => row.stage === AGE_REVIEW_STAGE;

async function cases(payload: Payload, owner: string, req?: PayloadRequest) {
  return (await payload.find({ collection: "safety-cases", overrideAccess: true, req, limit: 100, sort: "-id", where: {
    and: [{ owner: { equals: owner } }, { stage: { equals: AGE_REVIEW_STAGE } }],
  } })).docs;
}

export async function latestAgeReviewCase(payload: Payload, owner: string, req?: PayloadRequest) {
  return (await cases(payload, owner, req))[0];
}

const reviewReference = (row: Pick<SafetyCase, "id">, revision?: number) =>
  `age-review:${row.id}${revision === undefined ? "" : `:${revision}`}`;

function referencesReview(profile: AgeProfile | undefined, row: SafetyCase | undefined) {
  return !!profile && !!row && (profile.reference === reviewReference(row) || String(profile.reference || "").startsWith(`${reviewReference(row)}:`));
}

export function reviewProjection(profile: AgeProfile | undefined, row: SafetyCase | undefined) {
  const restricted = profile?.additionalVerification === "required" || profile?.state === "needs_review" || profile?.state === "minor";
  const completed = !!row && row.action === "permit_age_reverification" && profile?.state === "adult" && profile.additionalVerification !== "required";
  const current = !restricted || referencesReview(profile, row) ? row : undefined;
  const result = current?.action === "permit_age_reverification" ? "permit_fresh_verification" as const
    : current?.action === "maintain_age_restriction" ? "maintain_restriction" as const : null;
  const state = completed ? "completed" as const
    : !restricted ? "not_needed" as const
    : !current ? "request_required" as const
    : current.status !== "resolved" ? "pending" as const
    : current.action === "permit_age_reverification" ? "approved" as const
    : "rejected" as const;
  return {
    review: {
      state, receipt: current?.receipt || null, caseStatus: current?.status || null, result,
      reply: current?.feedbackAt && current.reply ? current.reply : null,
      requestedAt: current?.createdAt || null, decidedAt: current?.resolvedAt || null,
      helpPath: "/pages/help/index?category=age_verification" as const,
    },
    actions: {
      requestReview: state === "request_required" || state === "rejected",
      checkReviewStatus: !!current,
      startReverification: state === "approved",
    },
  };
}

async function create(payload: Payload, owner: string, req: PayloadRequest, kind: CreationKind, parent?: SafetyCase) {
  const now = Date.now();
  const config = await settings(payload, req);
  const provenance = CREATION[kind];
  const row = await payload.create({ collection: "safety-cases", overrideAccess: true, req, data: {
    receipt: randomUUID(), owner, source: provenance.source, status: parent ? "review" : "pending", severity: "normal",
    category: AGE_REVIEW_CATEGORY, stage: AGE_REVIEW_STAGE, revision: 0,
    parentId: parent?.id,
    acceptBy: workingDeadline(now, 1), resolveBy: workingDeadline(now, 7), feedbackBy: workingDeadline(now, 7),
    retainUntil: Number(config?.evidenceDays ?? 0) > 0 ? new Date(now + Number(config?.evidenceDays) * 86400_000).toISOString() : null,
    retentionBasis: config?.retentionBasis || "安全证据默认永久保留，不自动到期；仅限受控复核使用，数据权利申请另行处理",
  } });
  await payload.create({ collection: "safety-evidence", overrideAccess: true, req, data: {
    caseId: row.id, excerpt: provenance.evidence, originalLength: provenance.evidence.length,
    digest: createHash("sha256").update(provenance.evidence).digest("hex"),
  } });
  await audit(payload, provenance.actor(owner), "case.created", `case:${row.id}`, provenance.reason, { stage: AGE_REVIEW_STAGE, category: AGE_REVIEW_CATEGORY }, req);
  return row;
}

// Caller owns the surrounding transaction. A definitive new risk/minor result
// must move authorization to a new current cycle before that transaction commits.
export async function supersedeAgeReviewAuthorization(payload: Payload, owner: string, req: PayloadRequest, kind: CreationKind = "minor") {
  const latest = await latestAgeReviewCase(payload, owner, req);
  return latest && latest.status !== "resolved" ? latest : create(payload, owner, req, kind);
}

export async function bindAgeRestriction(payload: Payload, profile: AgeProfile, req: PayloadRequest, kind: CreationKind = "minor") {
  const row = await supersedeAgeReviewAuthorization(payload, profile.owner, req, kind);
  await payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, req, data: {
    reference: reviewReference(row),
  } });
  return row;
}

export async function requestAgeReview(payload: Payload, owner: Owner) {
  return transaction(payload, async (req) => {
    const profile = (await payload.find({ collection: "age-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: owner.id } } })).docs[0];
    if (!profile || !["minor", "needs_review"].includes(String(profile.state)) && profile.additionalVerification !== "required")
      throw new AppError(409, "当前账户没有需要人工复核的年龄限制");
    const rows = await cases(payload, owner.id, req);
    const existing = rows.find((row) => row.status !== "resolved");
    if (existing) {
      if (!referencesReview(profile, existing)) await payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, req, data: { reference: reviewReference(existing) } });
      return existing;
    }
    const latest = rows[0];
    // An approval is authorization for this restricted cycle, not a reason to
    // create unlimited duplicate cases when the user refreshes/resubmits.
    if (latest?.action === "permit_age_reverification" && referencesReview(profile, latest)) return latest;
    if (profile.additionalVerification !== "required" || profile.state !== "needs_review")
      await payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, req, data: {
        state: "needs_review", additionalVerification: "required", challenge: null, challengePurpose: null, challengeExpiresAt: null,
      } });
    const parent = latest?.action === "maintain_age_restriction" ? latest : undefined;
    const row = await create(payload, owner.id, req, parent ? "appeal" : "request", parent);
    await payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, req, data: { reference: reviewReference(row) } });
    return row;
  });
}

export async function requireApprovedReview(payload: Payload, owner: string, req?: PayloadRequest) {
  const profile = (await payload.find({ collection: "age-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: owner } } })).docs[0];
  const row = await latestAgeReviewCase(payload, owner, req);
  if (!row || row.status !== "resolved" || row.action !== "permit_age_reverification" || !referencesReview(profile, row))
    throw new AppError(403, "请先等待年龄复核批准后再发起本人核验");
  return row;
}

export async function requireAgeRiskCase(payload: Payload, owner: string) {
  return transaction(payload, async (req) => {
    const profile = (await payload.find({ collection: "age-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: owner } } })).docs[0];
    const restriction = {
      state: "needs_review", additionalVerification: "required", challenge: null, challengePurpose: null,
      challengeExpiresAt: null, assurance: null, expiresAt: null, reference: null,
    };
    const restricted = profile
      ? await payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, req, data: restriction })
      : await payload.create({ collection: "age-profiles", overrideAccess: true, req, data: { owner, ...restriction } });
    return bindAgeRestriction(payload, restricted, req, "risk");
  });
}

export async function decideAgeReview(payload: Payload, user: TypedUser, row: SafetyCase, action: string, reply: string | undefined, req: PayloadRequest) {
  if (!isAgeReviewCase(row)) return false;
  if (!["permit_age_reverification", "maintain_age_restriction"].includes(action)) return false;
  if (!isAdministrator(user)) throw new AppError(403, "年龄复核结论需要系统管理员");
  if (row.assignedTo !== user.id) throw new AppError(403, "请由已领取案件的管理员作出年龄复核结论");
  if (!reply) throw new AppError(400, "年龄复核结论必须填写给本人的说明");
  const current = await latestAgeReviewCase(payload, row.owner, req);
  if (!current || current.id !== row.id) throw new AppError(409, "此年龄复核案件已被更新周期取代，请处理当前案件");
  const profile = (await payload.find({ collection: "age-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: row.owner } } })).docs[0];
  if (!profile || profile.additionalVerification !== "required") throw new AppError(409, "账户已不处于年龄复核限制状态");
  await payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, req, data: {
    state: "needs_review", additionalVerification: "required", challenge: null, challengePurpose: null, challengeExpiresAt: null,
  } });
  return true;
}
