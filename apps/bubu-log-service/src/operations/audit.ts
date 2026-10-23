import { randomUUID } from "node:crypto";
import type { Payload, PayloadRequest } from "payload";
import { redactOperations } from "./redaction";
interface OpsAuditInput { actorId: string | number; babyId?: string; action: string; reason: string; result?: unknown; target?: unknown }
/** Existing identity audit is the sole operational audit source. No copied care facts. */
export async function appendOpsAudit(payload: Payload, input: OpsAuditInput, req?: PayloadRequest): Promise<void> {
  const id = randomUUID();
  await payload.create({ collection: "audit", data: { id, key: id, value: { ...redactOperations(input) as Record<string, unknown>, actorKind: "ops-user", at: new Date().toISOString() } }, overrideAccess: true, req });
}
