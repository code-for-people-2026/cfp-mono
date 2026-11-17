import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ageStatusSchema } from "./age";

const notice = { version: "notice-synthetic", paragraphs: ["合成年龄说明"] };
const configuration = { wechat: true, provider: true, providerName: "aliyun" as const };
const base = {
  loggedIn: true,
  declaration: "14to17" as const,
  verifiedAt: "2026-11-14T00:00:00.000Z",
  expiresAt: "2026-12-14T00:00:00.000Z",
  notice,
  configuration,
};

// Minimal faithful public-shape snapshot from deployed 0.8.1 (git 000e9c92).
const ageStatusSchema080 = z.object({
  loggedIn: z.boolean(), state: z.enum(["unverified", "cancelled", "pending", "adult", "minor", "unknown", "failed", "unavailable", "expired", "needs_review"]), declaration: z.enum(["under14", "14to17", "adult", "unknown"]).optional(),
  allowed: z.boolean(), verifiedAt: z.string().nullable(), expiresAt: z.string().nullable(), source: z.string().nullable(),
  assurance: z.literal("identity_details_match").nullable(),
  additionalVerification: z.enum(["not_requested", "required"]),
  notice: z.object({ version: z.string(), paragraphs: z.array(z.string()) }),
  configuration: z.object({ wechat: z.boolean(), provider: z.boolean(), providerName: z.enum(["aliyun", "tencent"]).optional(), previewOnly: z.boolean().optional() }),
  review: z.object({
    state: z.enum(["not_needed", "request_required", "pending", "approved", "rejected", "completed"]),
    receipt: z.string().nullable(), caseStatus: z.enum(["pending", "in_progress", "review", "resolved"]).nullable(),
    result: z.enum(["permit_fresh_verification", "maintain_restriction"]).nullable(),
    reply: z.string().nullable(), requestedAt: z.string().nullable(), decidedAt: z.string().nullable(),
    helpPath: z.literal("/pages/help/index?category=age_verification"),
  }).optional(),
  actions: z.object({ requestReview: z.boolean(), checkReviewStatus: z.boolean(), startReverification: z.boolean() }).optional(),
});

describe("年龄跨端协议", () => {
  it("人工恢复保持 0.8.1 状态可解析，且不伪装成供应商匹配", () => {
    const actualManualStatus = {
      ...base,
      state: "adult" as const,
      allowed: true,
      source: "administrator_age_review_manual_assurance",
      assurance: null,
      additionalVerification: "not_requested" as const,
      review: {
        state: "completed" as const,
        receipt: "AGE-SYNTHETIC-MANUAL",
        caseStatus: "resolved" as const,
        result: null,
        manualDecision: true,
        reply: "管理员已直接恢复年龄权限。",
        requestedAt: "2026-11-14T00:00:00.000Z",
        decidedAt: "2026-11-14T00:05:00.000Z",
        helpPath: "/pages/help/index?category=age_verification" as const,
      },
      actions: { requestReview: false, checkReviewStatus: true, startReverification: false },
    };
    const current = ageStatusSchema.parse(actualManualStatus);
    const legacy = ageStatusSchema080.parse(actualManualStatus);
    expect(current.assurance).toBeNull();
    expect(current.source).toBe("administrator_age_review_manual_assurance");
    expect(current.review?.result).toBeNull();
    expect(current.review?.manualDecision).toBe(true);
    expect(legacy.assurance).toBeNull();
    expect(legacy.review?.result).toBeNull();
    expect("manualDecision" in (legacy.review ?? {})).toBe(false);
    expect(ageStatusSchema.safeParse({ ...actualManualStatus, assurance: "manual_administrator_assurance" }).success).toBe(false);
  });

  it("保留原供应商重新核验结果，且拒绝伪造的人工元数据", () => {
    const status = ageStatusSchema.parse({
      ...base,
      state: "needs_review",
      allowed: false,
      source: null,
      assurance: null,
      additionalVerification: "required",
      review: {
        state: "approved",
        receipt: "AGE-SYNTHETIC-REVERIFY",
        caseStatus: "resolved",
        result: "permit_fresh_verification",
        reply: "可以重新发起本人年龄核验。",
        requestedAt: "2026-11-14T00:00:00.000Z",
        decidedAt: "2026-11-14T00:05:00.000Z",
        helpPath: "/pages/help/index?category=age_verification",
      },
      actions: { requestReview: false, checkReviewStatus: true, startReverification: true },
    });
    expect(status.review?.result).toBe("permit_fresh_verification");
    expect(status.actions?.startReverification).toBe(true);
    expect(ageStatusSchema.safeParse({
      ...status,
      review: { ...status.review!, manualDecision: "yes" },
    }).success).toBe(false);
    expect(ageStatusSchema.safeParse({
      ...status,
      review: { ...status.review!, result: "restored_by_administrator" },
    }).success).toBe(false);
  });
});
