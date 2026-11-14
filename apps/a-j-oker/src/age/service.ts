import { randomUUID } from "node:crypto";
import type { Payload, PayloadRequest } from "payload";
import { ageChallengeSchema, ageReviewChallengeSchema, ageSubmissionSchema, ageStateSchema, ageDeclarationSchema, type AgeStatus } from "@cfp/a-j-oker-contracts";
import { AppError, type Owner } from "../domain/contracts";
import type { AgeProfile } from "../payload-types";
import { ageNotice, ageProvider, ageAssuranceAccepted, MANUAL_AGE_ASSURANCE, providerConfigured, wechatConfigured } from "./policy";
import { withAgeLock } from "./lock";
import { verifyAge, type AgeVerifier } from "./provider";
import { bindAgeRestriction, latestAgeReviewCase, requestAgeReview, requireAgeRiskCase, requireApprovedReview, reviewProjection } from "./review";
import { transaction } from "../operations/transaction";

export async function ageProfile(payload: Payload, owner: string, req?: PayloadRequest) {
  return (await payload.find({ collection: "age-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: owner } } })).docs[0];
}
export class AgeService {
  constructor(readonly payload: Payload, readonly owner: Owner, private verify: AgeVerifier = verifyAge) {}
  private async bound(req?: PayloadRequest) {
    if (!this.owner.wechatKey) return false;
    return !!(await this.payload.find({ collection: "wechat-identities", overrideAccess: true, req, limit: 1, where: { and: [{ owner: { equals: this.owner.id } }, { key: { equals: this.owner.wechatKey } }] } })).docs.length;
  }
  private async mayProcess(req?: PayloadRequest) {
    const profile = (await this.payload.find({ collection: "privacy-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: this.owner.id } } })).docs[0];
    if (["deleting", "deleted", "withdrawn"].includes(String(profile?.state))) throw new AppError(403, "此身份已停止处理，请先查看隐私与数据设置");
  }
  private async personal() {
    if (this.owner.auth !== "miniapp" || !await this.bound()) throw new AppError(403, "请本人先在微信小程序完成微信登录");
    await this.mayProcess();
  }
  private async save(data: Partial<AgeProfile>, req?: PayloadRequest) {
    const profile = await ageProfile(this.payload, this.owner.id, req);
    return profile
      ? this.payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, req, data })
      : this.payload.create({ collection: "age-profiles", overrideAccess: true, req, data: { ...data, owner: this.owner.id, state: data.state || "unverified" } });
  }
  async status(): Promise<AgeStatus> {
    const profile = await ageProfile(this.payload, this.owner.id);
    const reviewCase = await latestAgeReviewCase(this.payload, this.owner.id);
    const loggedIn = await this.bound();
    let state = ageStateSchema.catch("unverified").parse(profile?.state);
    if (["adult", "minor"].includes(state) && (!profile?.expiresAt || Date.parse(String(profile.expiresAt)) <= Date.now())) state = "expired";
    if (state === "adult" && profile?.noticeVersion !== ageNotice().version) state = "expired";
    if (state === "pending" && (!profile?.lastAttemptAt || Date.parse(String(profile.lastAttemptAt)) + 60_000 < Date.now())) state = "unavailable";
    if (profile?.additionalVerification === "required") state = "needs_review";
    return {
      loggedIn, state, declaration: ageDeclarationSchema.optional().catch(undefined).parse(profile?.declaration),
      allowed: loggedIn && state === "adult" && ageAssuranceAccepted(profile || {}) && profile?.noticeVersion === ageNotice().version,
      verifiedAt: typeof profile?.verifiedAt === "string" ? profile.verifiedAt : null,
      expiresAt: typeof profile?.expiresAt === "string" ? profile.expiresAt : null,
      source: typeof profile?.source === "string" ? profile.source : null,
      assurance: profile?.assurance === "identity_details_match" ? "identity_details_match" : null,
      additionalVerification: profile?.additionalVerification === "required" ? "required" : "not_requested",
      notice: ageNotice(), configuration: { wechat: wechatConfigured(), provider: providerConfigured(), providerName: ageProvider() },
      ...reviewProjection(profile, reviewCase),
    };
  }
  async requireLogin() {
    if (!await this.bound()) throw new AppError(403, "请先微信登录");
  }
  async requireCapability() {
    const status = await this.status();
    if (!status.allowed) throw new AppError(403, "请先完成微信登录与有效年龄核验；未成年、未知或需复核时暂不开放生成、上传、广告整理和外部连接。仍可使用隐私与反馈入口。");
  }
  async challenge(value: unknown) {
    await this.personal();
    const input = ageChallengeSchema.parse(value);
    if (input.noticeVersion !== ageNotice().version) throw new AppError(409, "年龄核验说明已更新，请重新阅读并确认");
    return withAgeLock(this.payload, `owner:${this.owner.id}`, async () => {
      const previous = await ageProfile(this.payload, this.owner.id);
      if (input.correction) {
        if (!previous?.declaration || previous.assurance || previous.additionalVerification === "required") throw new AppError(403, "此记录需要通过帮助与反馈申请复核");
        if (input.declaration !== "unknown") throw new AppError(400, "更正年龄须以本人身份证核验结果为准");
        if (!providerConfigured()) throw new AppError(503, "身份核验服务暂不可用，请稍后重试");
        const challenge = randomUUID();
        // Keep the existing declaration and restriction until new evidence arrives.
        await this.save({ noticeVersion: input.noticeVersion, consentedAt: new Date().toISOString(), challenge, challengePurpose: "correction", challengeExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
        return { status: await this.status(), challenge };
      }
      if (previous?.state === "minor" || previous?.additionalVerification === "required") throw new AppError(403, "已有未成年或需复核记录，请通过帮助与反馈申请复核，不能换填他人信息重试");
      if (previous?.declaration === "under14" || (previous?.declaration === "14to17" && input.declaration === "adult")) {
        await transaction(this.payload, async (req) => {
          const restricted = await this.save({ state: "needs_review", additionalVerification: "required", challenge: null, challengePurpose: null, challengeExpiresAt: null, assurance: null, expiresAt: null }, req);
          await bindAgeRestriction(this.payload, restricted, req, "conflict");
        });
        return { status: await this.status(), challenge: null };
      }
      if ((await this.status()).allowed && input.declaration === "adult") return { status: await this.status(), challenge: null };
      const challenge = input.declaration === "under14" || !providerConfigured() ? null : randomUUID();
      const latestReview = input.declaration === "under14" ? await latestAgeReviewCase(this.payload, this.owner.id) : undefined;
      const startsNewReviewCycle = input.declaration === "under14"
        && previous?.state === "adult"
        && (previous.assurance === "identity_details_match" || previous.assurance === MANUAL_AGE_ASSURANCE)
        && latestReview?.status === "resolved"
        && ["permit_age_reverification", "restore_age_access"].includes(String(latestReview.action));
      if (startsNewReviewCycle) await transaction(this.payload, async (req) => {
        const restricted = await this.save({ state: "minor", declaration: input.declaration, noticeVersion: input.noticeVersion, consentedAt: new Date().toISOString(), challenge: null, challengePurpose: null, challengeExpiresAt: null, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), assurance: null, additionalVerification: "required" }, req);
        await bindAgeRestriction(this.payload, restricted, req, "declaration");
      });
      else await this.save({ state: input.declaration === "under14" ? "minor" : challenge ? "unverified" : "unavailable", declaration: input.declaration, noticeVersion: input.noticeVersion, consentedAt: new Date().toISOString(), challenge, challengePurpose: "initial", challengeExpiresAt: challenge ? new Date(Date.now() + 5 * 60_000).toISOString() : null, expiresAt: input.declaration === "under14" ? new Date(Date.now() + 30 * 86400_000).toISOString() : null, assurance: null });
      return { status: await this.status(), challenge };
    });
  }
  async requestReview() {
    await this.personal();
    return withAgeLock(this.payload, `owner:${this.owner.id}`, async () => {
      await requestAgeReview(this.payload, this.owner);
      return this.status();
    });
  }
  async reviewChallenge(value: unknown) {
    await this.personal();
    const input = ageReviewChallengeSchema.parse(value);
    if (input.noticeVersion !== ageNotice().version) throw new AppError(409, "年龄核验说明已更新，请重新阅读并确认");
    if (!providerConfigured()) throw new AppError(503, "身份核验服务暂不可用，请稍后重试");
    return withAgeLock(this.payload, `owner:${this.owner.id}`, async (assertLease) => {
      const profile = await ageProfile(this.payload, this.owner.id);
      if (!profile || profile.additionalVerification !== "required") throw new AppError(409, "当前账户不需要年龄复核");
      const approved = await requireApprovedReview(this.payload, this.owner.id);
      const challenge = randomUUID();
      await transaction(this.payload, async (req) => {
        await assertLease(req);
        if (!await this.bound(req)) throw new AppError(409, "登录绑定已变更，请重新登录并发起核验");
        await this.mayProcess(req);
        const current = await ageProfile(this.payload, this.owner.id, req);
        if (!current || current.id !== profile.id || current.updatedAt !== profile.updatedAt
          || current.additionalVerification !== "required")
          throw new AppError(409, "年龄核验状态已变更，请按当前复核状态重新发起");
        const currentApproved = await requireApprovedReview(this.payload, this.owner.id, req);
        const reference = `age-review:${currentApproved.id}:${currentApproved.revision}`;
        const cycleReference = `age-review:${currentApproved.id}`;
        const referencesCurrentApproval = current.reference === cycleReference
          || String(current.reference || "").startsWith(`${cycleReference}:`);
        if (currentApproved.id !== approved.id || currentApproved.revision !== approved.revision
          || !referencesCurrentApproval)
          throw new AppError(409, "年龄核验状态已变更，请按当前复核状态重新发起");
        const changed = await this.payload.update({ collection: "age-profiles", overrideAccess: true, req,
          where: { and: [{ id: { equals: current.id } }, { updatedAt: { equals: current.updatedAt } }] },
          data: { state: "needs_review", noticeVersion: input.noticeVersion, consentedAt: new Date().toISOString(),
            challenge, challengePurpose: "age_review", challengeExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            reference } });
        if (changed.docs.length !== 1 || changed.errors.length) throw new AppError(409, "年龄核验状态已变更，请按当前复核状态重新发起");
      });
      return { status: await this.status(), challenge };
    });
  }
  async submit(value: unknown) {
    await this.personal();
    // Strict schema: no owner, birthday, age result, provider callback or extra fields.
    const input = ageSubmissionSchema.parse(value);
    return withAgeLock(this.payload, `owner:${this.owner.id}`, async (assertLease) => {
      const profile = await ageProfile(this.payload, this.owner.id);
      const reviewing = profile?.challengePurpose === "age_review";
      if (!profile || profile.challenge !== input.challenge || !profile.challengeExpiresAt || Date.parse(String(profile.challengeExpiresAt)) <= Date.now() || profile.noticeVersion !== ageNotice().version || (profile.additionalVerification === "required" && !reviewing)) throw new AppError(409, "核验请求无效、已使用或过期，请重新阅读说明并发起");
      if (reviewing) await requireApprovedReview(this.payload, this.owner.id);
      const correcting = profile.challengePurpose === "correction";
      if (profile.declaration === "under14" && !correcting && !reviewing) throw new AppError(403, "请先通过帮助与反馈获得监护人支持");
      const day = new Date().toISOString().slice(0, 10);
      const attempts = profile.day === day ? Number(profile.attempts || 0) : 0;
      if (attempts >= 5) throw new AppError(429, "今日核验次数已用完，请明日重试或通过帮助与反馈申请复核");
      const pendingData = { state: "pending", challenge: null, challengePurpose: null, challengeExpiresAt: null, lastAttemptAt: new Date().toISOString(), day, attempts: attempts + 1, assurance: null, expiresAt: null };
      // Consume the challenge and reserve this attempt in one transaction. An
      // administrator decision committed after the stale read cannot be
      // overwritten, and no provider call is made in that case.
      const pending = await transaction(this.payload, async (req) => {
        await assertLease(req);
        if (!await this.bound(req)) throw new AppError(409, "登录绑定已变更，请重新登录并发起核验");
        await this.mayProcess(req);
        const current = await ageProfile(this.payload, this.owner.id, req);
        if (!current || current.id !== profile.id || current.updatedAt !== profile.updatedAt
          || current.challenge !== input.challenge || current.challengePurpose !== profile.challengePurpose
          || current.challengeExpiresAt !== profile.challengeExpiresAt || current.noticeVersion !== profile.noticeVersion
          || (current.additionalVerification === "required" && !reviewing))
          throw new AppError(409, "年龄核验状态已变更，请按当前复核状态重新发起");
        if (reviewing) {
          const approved = await requireApprovedReview(this.payload, this.owner.id, req);
          if (current.additionalVerification !== "required" || current.reference !== `age-review:${approved.id}:${approved.revision}`)
            throw new AppError(409, "年龄复核批准已变更，请按当前结果重新发起");
        }
        const changed = await this.payload.update({ collection: "age-profiles", overrideAccess: true, req, where: { and: [{ id: { equals: profile.id } }, { updatedAt: { equals: profile.updatedAt } }] }, data: pendingData });
        if (changed.docs.length !== 1 || changed.errors.length) throw new AppError(409, "年龄核验状态已变更，请按当前复核状态重新发起");
        return changed.docs[0];
      });
      // Consume the challenge before the network operation; a retry cannot replay it.
      let evidence: Awaited<ReturnType<AgeVerifier>>;
      try { evidence = await this.verify({ name: input.name, idCard: input.idCard }); }
      catch { evidence = { state: "unavailable" }; }
      const state = evidence.state === "adult" && profile.declaration === "14to17" && !correcting && !reviewing ? "needs_review" : evidence.state;
      const verified = state === "adult" || state === "minor";
      const now = new Date();
      await transaction(this.payload, async (req) => {
        await assertLease(req);
        if (!await this.bound(req)) throw new AppError(409, "登录绑定已变更，请重新登录并发起核验");
        await this.mayProcess(req);
        const current = await ageProfile(this.payload, this.owner.id, req);
        if (!current || current.id !== pending.id || current.updatedAt !== pending.updatedAt || current.state !== "pending")
          throw new AppError(409, "年龄核验状态已变更，请按当前复核状态重新发起");
        if (reviewing) {
          const approved = await requireApprovedReview(this.payload, this.owner.id, req);
          if (current.additionalVerification !== "required" || current.reference !== `age-review:${approved.id}:${approved.revision}`)
            throw new AppError(409, "年龄复核批准已变更，请按当前结果重新发起");
        }
        const newRestriction = state === "minor" || state === "needs_review";
        const remainsRestricted = newRestriction || reviewing && state !== "adult";
        const saved = await this.save({ state: reviewing && state === "minor" ? "needs_review" : state, source: ageProvider() === "aliyun" ? "aliyun_id2_meta_name_id" : "tencent_minors_verification_name_id", reference: remainsRestricted && !newRestriction ? current.reference : evidence.reference || null, ...((correcting || reviewing) && verified ? { declaration: state === "adult" ? "adult" : evidence.ageBand || "unknown" } : {}), assurance: verified ? "identity_details_match" : null, verifiedAt: verified ? now.toISOString() : null, expiresAt: verified ? new Date(now.getTime() + 30 * 86400_000).toISOString() : null, additionalVerification: remainsRestricted ? "required" : "not_requested" }, req);
        if (newRestriction) await bindAgeRestriction(this.payload, saved, req, state === "needs_review" ? "conflict" : "minor");
      });
      return this.status();
    });
  }
  async cancel() {
    if (this.owner.auth === "bearer") throw new AppError(403, "请本人管理年龄核验");
    return withAgeLock(this.payload, `owner:${this.owner.id}`, async (assertLease) => {
      const profile = await ageProfile(this.payload, this.owner.id);
      const clearingChallenge = profile?.challengePurpose === "correction" || profile?.challengePurpose === "age_review";
      const cancelling = !clearingChallenge && (!profile || !["adult", "minor", "needs_review"].includes(String(profile.state)));
      if (clearingChallenge || cancelling) await transaction(this.payload, async (req) => {
        await assertLease(req);
        const current = await ageProfile(this.payload, this.owner.id, req);
        if (clearingChallenge) {
          if (!profile || !current || current.id !== profile.id || current.updatedAt !== profile.updatedAt
            || current.challengePurpose !== profile.challengePurpose)
            throw new AppError(409, "年龄核验状态已变更，请按当前状态重新操作");
          const changed = await this.payload.update({ collection: "age-profiles", overrideAccess: true, req,
            where: { and: [{ id: { equals: current.id } }, { updatedAt: { equals: current.updatedAt } }] },
            data: { challenge: null, challengePurpose: null, challengeExpiresAt: null } });
          if (changed.docs.length !== 1 || changed.errors.length) throw new AppError(409, "年龄核验状态已变更，请按当前状态重新操作");
        } else if (profile) {
          if (!current || current.id !== profile.id || current.updatedAt !== profile.updatedAt || current.state !== profile.state
            || current.challengePurpose !== profile.challengePurpose)
            throw new AppError(409, "年龄核验状态已变更，请按当前状态重新操作");
          const changed = await this.payload.update({ collection: "age-profiles", overrideAccess: true, req,
            where: { and: [{ id: { equals: current.id } }, { updatedAt: { equals: current.updatedAt } }] },
            data: { state: "cancelled", challenge: null, challengePurpose: null, challengeExpiresAt: null } });
          if (changed.docs.length !== 1 || changed.errors.length) throw new AppError(409, "年龄核验状态已变更，请按当前状态重新操作");
        } else {
          await this.payload.create({ collection: "age-profiles", overrideAccess: true, req, data: { owner: this.owner.id, state: "cancelled" } });
        }
      });
      return this.status();
    });
  }
  // Trusted internal integration seam for a future risk/guardian review service.
  // No client endpoint clears this flag, and no face verification is implemented.
  async requireAdditionalVerification() {
    return withAgeLock(this.payload, `owner:${this.owner.id}`, async () => {
      await requireAgeRiskCase(this.payload, this.owner.id);
      return this.status();
    });
  }
}
