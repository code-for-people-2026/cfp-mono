import { z } from "zod";

export const privacyPolicySchema = z.object({
  version: z.string(), ready: z.boolean(), contact: z.string(),
  documents: z.array(z.object({ title: z.string(), paragraphs: z.array(z.string()) })),
});
export const privacyStatusSchema = z.object({
  policy: privacyPolicySchema,
  state: z.enum(["unaccepted", "active", "withdrawn", "deleting", "deleted"]),
  consent: z.object({ version: z.string(), core: z.boolean(), model: z.boolean(), sensitive: z.boolean(), external: z.boolean(), externalRecipient: z.object({ name: z.string(), contact: z.string(), region: z.string(), privacyUrl: z.string() }).optional() }).nullable(),
  hasRecoveryCode: z.boolean(), expiresAt: z.string().nullable(),
});
export const recoveryCodeSchema = z.object({ code: z.string() });
export const recoveredIdentitySchema = z.object({ token: z.string().optional(), owner: z.string().optional() });
export const logoutSchema = z.object({ loggedOut: z.literal(true) });
export const deletionSchema = z.object({ deleted: z.literal(true), backupNotice: z.string(), operations: z.object({ erased: z.number(), held: z.number(), notice: z.string() }).optional() });
export type PrivacyPolicy = z.infer<typeof privacyPolicySchema>;
export type PrivacyStatus = z.infer<typeof privacyStatusSchema>;
