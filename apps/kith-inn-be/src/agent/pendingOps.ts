/**
 * Per-operator pending operation for the agent's confirm-card flow (#126).
 * In-process Map keyed by operatorId (same trade-off as the old pendingState):
 *
 * 1. Write tool execute handler computes a preview → stores it here (getting back
 *    an `opId`) → returns an operation-confirm card carrying that opId.
 * 2. User clicks 确认 → POST /chat/confirm-operation compares the submitted opId
 *    with the stored one (rejects stale cards → 409), then executes + clears.
 *
 * One pending op per operator at a time (newest overwrites). The opId is a
 * monotonic counter so an older card's opId can't match a newer op.
 * // ponytail: in-process Map + counter — server restart drops both (acceptable:
 * pending is ephemeral by design; restart just clears outstanding cards).
 */
export type PendingOp = {
  opId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
};

const pending = new Map<string | number, PendingOp>();
let counter = 0;

/** Store the op for `operatorId`, returning the opaque id the card must carry. */
export function setPendingOp(operatorId: string | number, op: Omit<PendingOp, "opId">): string {
  counter += 1;
  const opId = String(counter);
  pending.set(operatorId, { ...op, opId });
  return opId;
}

export function getPendingOp(operatorId: string | number): PendingOp | undefined {
  return pending.get(operatorId);
}

export function clearPendingOp(operatorId: string | number): void {
  pending.delete(operatorId);
}
