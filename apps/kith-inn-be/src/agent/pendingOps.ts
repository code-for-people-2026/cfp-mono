/**
 * Per-operator pending operation for the agent's confirm-card flow (#126).
 * Same pattern as pendingState.ts (in-process Map, keyed by operatorId):
 *
 * 1. Write tool execute handler computes a preview → stores it here → returns
 *    an operation-confirm card.
 * 2. User clicks 确认 → POST /chat/confirm-operation reads + executes + clears.
 *
 * One pending op per operator at a time (newest overwrites).
 * // ponytail: in-process Map — server restart drops it (same trade-off as pendingState).
 */
export type PendingOp = {
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
};

const pending = new Map<string | number, PendingOp>();

export function setPendingOp(operatorId: string | number, op: PendingOp): void {
  pending.set(operatorId, op);
}

export function getPendingOp(operatorId: string | number): PendingOp | undefined {
  return pending.get(operatorId);
}

export function clearPendingOp(operatorId: string | number): void {
  pending.delete(operatorId);
}
