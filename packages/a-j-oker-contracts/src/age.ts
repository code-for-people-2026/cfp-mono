import { z } from "zod";

export const ageDeclarationSchema = z.enum(["under14", "14to17", "adult", "unknown"]);
export const ageStateSchema = z.enum(["unverified", "cancelled", "pending", "adult", "minor", "unknown", "failed", "unavailable", "expired", "needs_review"]);
export const ageChallengeSchema = z.object({
  declaration: ageDeclarationSchema,
  noticeVersion: z.string().min(1).max(100),
  consent: z.literal(true),
  correction: z.boolean().optional(),
}).strict();
export const ageSubmissionSchema = z.object({
  challenge: z.string().uuid(),
  name: z.string().trim().min(2).max(50),
  idCard: z.string().trim().regex(/^\d{17}[\dXx]$/).transform((value) => value.toUpperCase()),
}).strict();
export type AgeDeclaration = z.infer<typeof ageDeclarationSchema>;
export type AgeState = z.infer<typeof ageStateSchema>;
export const ageStateText: Record<AgeState, string> = {
  unverified: "尚未核验年龄", cancelled: "已取消，可随时继续", pending: "正在核验，请稍候再查询",
  adult: "提交的身份信息核验为成年", minor: "未成年人保护入口", unknown: "暂未查到可确认的年龄结果",
  failed: "核验未通过，请检查本人信息或申请复核", unavailable: "核验服务暂不可用，请稍后重试",
  expired: "年龄核验已过期，请重新核验", needs_review: "需要追加核验，请通过帮助与反馈申请复核",
};

export const ageStatusSchema = z.object({
  loggedIn: z.boolean(), state: ageStateSchema, declaration: ageDeclarationSchema.optional(),
  allowed: z.boolean(), verifiedAt: z.string().nullable(), expiresAt: z.string().nullable(), source: z.string().nullable(),
  assurance: z.literal("identity_details_match").nullable(),
  additionalVerification: z.enum(["not_requested", "required"]),
  notice: z.object({ version: z.string(), paragraphs: z.array(z.string()) }),
  configuration: z.object({ wechat: z.boolean(), provider: z.boolean(), providerName: z.enum(["aliyun", "tencent"]).optional(), previewOnly: z.boolean().optional() }),
});
export const ageChallengeResultSchema = z.object({ status: ageStatusSchema, challenge: z.string().nullable() });
export const wechatLoginResultSchema = z.object({
  token: z.string().min(1), owner: z.string().min(1), expiresAt: z.string(),
  history: z.enum(["kept", "wechat_restored", "new"]),
});

export type AgeStatus = z.infer<typeof ageStatusSchema>;
