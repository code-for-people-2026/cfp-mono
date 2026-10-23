import { z } from "zod";

const date = z.iso.datetime({ offset: true });
export const expiryPolicySchema = z.object({ chat: z.enum(["continue", "pause"]), collection: z.enum(["continue", "pause"]) }).strict().nullable();
export const membershipPolicySchema = z.object({
  startsAt: date.nullable(), endsAt: date.nullable(), expiryPolicy: expiryPolicySchema, paused: z.boolean(),
}).strict().refine(value => !value.startsAt || !value.endsAt || Date.parse(value.startsAt) < Date.parse(value.endsAt), "开始时间须早于截止时间")
  .refine(value => !value.expiryPolicy || !!value.endsAt, "到期策略需要明确的截止时间");
export type MembershipPolicy = z.infer<typeof membershipPolicySchema>;
const expectedVersion = z.number().int().nonnegative();
export const membershipCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), expectedVersion, startsAt: date.nullable(), endsAt: date.nullable(), expiryPolicy: expiryPolicySchema }).strict(),
  z.object({ action: z.literal("extend"), expectedVersion, endsAt: date }).strict(),
  z.object({ action: z.literal("pause"), expectedVersion }).strict(),
  z.object({ action: z.literal("resume"), expectedVersion }).strict(),
]);
export type MembershipCommand = z.infer<typeof membershipCommandSchema>;
export interface MembershipStatus {
  babyId: string; version: number; configured: boolean; checkedAt: string;
  status: "free" | "scheduled" | "paused" | "expired";
  label: string; message: string; startsAt: string | null; endsAt: string | null;
  entitlements: { chat: boolean; collection: boolean; history: true };
  payment: { enabled: false };
}
export const defaultMembershipPolicy: MembershipPolicy = { startsAt: null, endsAt: null, expiryPolicy: null, paused: false };

/** Time and policy are evaluated together on the server; clients never calculate permission. */
export function membershipStatus(babyId: string, version: number, policy: MembershipPolicy, now: number): MembershipStatus {
  const status = policy.paused ? "paused" : policy.startsAt && now < Date.parse(policy.startsAt) ? "scheduled"
    : policy.endsAt && now >= Date.parse(policy.endsAt) ? "expired" : "free";
  const inactive = status === "paused" || status === "scheduled";
  const entitlements = { chat: !inactive && !(status === "expired" && policy.expiryPolicy?.chat === "pause"),
    collection: !inactive && !(status === "expired" && policy.expiryPolicy?.collection === "pause"), history: true as const };
  const message = status === "paused" ? "服务已由运营暂停；历史记录和图片仍可查看。恢复后可继续原请求。"
    : status === "scheduled" ? "免费服务将在配置的开始时间开放；历史记录仍可查看。"
      : status === "expired" ? !policy.expiryPolicy ? "已到配置的免费截止时间，尚未配置到期策略，服务继续可用。"
        : `已到配置的免费截止时间：内置聊天${entitlements.chat ? "继续可用" : "已暂停"}，群采集${entitlements.collection ? "继续可用" : "已暂停"}；历史记录仍可查看。`
        : policy.endsAt ? "当前限时免费，有效期以服务说明为准；不会自动收费。" : "当前限时免费，尚未设置截止时间；不会自动收费。";
  return { babyId, version, configured: version > 0, checkedAt: new Date(now).toISOString(), status, label: "限时免费", message,
    startsAt: policy.startsAt, endsAt: policy.endsAt, entitlements, payment: { enabled: false } };
}
