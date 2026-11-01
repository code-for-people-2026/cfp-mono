import { z } from "zod";
import { permissions, type Permission } from "../contracts";
import type { Principal } from "../identity";

const id = z.string().trim().min(1).max(200);
export const opsReason = z.string().trim().min(4).max(500);
export const opsRequestId = z.string().min(8).max(128).regex(/^[\w.-]+$/);
const recordTools = ["bubu_record_events", "bubu_update_event", "bubu_retract_event", "bubu_restore_event", "bubu_undo_event", "bubu_answer_pending", "bubu_attach_images", "bubu_resolve_media", "bubu_resolve_duplicate", "bubu_confirm_overlap", "bubu_get_request", "bubu_accept_legacy"] as const;
const collectorCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), accountId: id.regex(/^[\w.-]{1,128}$/), chatId: id.regex(/^[\w.-]{1,160}@chatroom$/), agentId: id, enabled: z.boolean(), intervalMs: z.number().int().min(10_000).max(86400_000) }).strict(),
  z.object({ action: z.literal("retry"), jobId: id }).strict(),
  z.object({ action: z.literal("backfill"), jobId: id, requestId: opsRequestId.optional(), range: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).strict() }).strict(),
]);
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("invite"), access: z.enum(["read", "write"]) }).strict(),
  z.object({ type: z.literal("grant"), subjectId: id, state: z.enum(["active", "revoked"]), permissions: z.array(z.enum(permissions as [Permission, ...Permission[]])).max(6) }).strict(),
  z.object({ type: z.literal("baby"), name: z.string().trim().min(1).max(30), fullName: z.string().trim().max(60).nullable() }).strict(),
  z.object({ type: z.literal("binding"), groupId: id, agentId: id, active: z.boolean() }).strict(),
  z.object({ type: z.literal("collector"), input: collectorCommand }).strict(),
  z.object({ type: z.literal("credential"), groupId: id, agentId: id }).strict(),
  z.object({ type: z.literal("record"), tool: z.enum(recordTools), arguments: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ type: z.literal("membership"), input: z.unknown() }).strict(),
]);
export const actionSchema = z.object({ babyId: id, reason: opsReason, requestId: opsRequestId, command: commandSchema }).strict();
export type OpsAction = z.infer<typeof actionSchema>;
export const readSchema = z.object({ babyId: id, reason: opsReason, kind: z.enum(["event", "revisions", "source", "attachment", "history"]), id: id.optional(), before: z.unknown().optional(), after: z.unknown().optional() }).strict();
export type OpsRead = z.infer<typeof readSchema>;

/** #398 owns schema, storage and policy; ops supplies fresh scoped identity, idempotency and audit. */
export interface MembershipOperations {
  schema: z.ZodType;
  read(principal: Principal, babyId: string): Promise<unknown>;
  execute(principal: Principal, babyId: string, requestId: string, input: unknown, reason?: string): Promise<unknown>;
}
