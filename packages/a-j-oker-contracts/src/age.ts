import { z } from "zod";
import { ageDeclarationSchema, ageStateSchema } from "@cfp/a-j-oker-protocol";

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
