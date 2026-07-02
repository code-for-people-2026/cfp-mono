import type { ConfirmCustomerItem } from "@cfp/kith-inn-shared";

/**
 * Server-side pending new-customer confirmations (#97). When `recordOrders`
 * meets unknown names it stores them here keyed by operator; the
 * `POST /chat/confirm-customers` endpoint reads → creates → clears. This makes
 * the new-customer confirmation action a deterministic button click instead of
 * relying on the LLM to recall the list across turns (DeepSeek drops context →
 * flaky multi-turn confirm).
 *
 * `// ponytail:` in-process Map — a server restart drops pending confirmations
 * (acceptable: 桃子 re-pastes the 接龙, record_orders repopulates). Promote to a
 * cms collection (replay from chat-messages) only when persistence is needed.
 */
const pending = new Map<string | number, ConfirmCustomerItem[]>();

/** Store (or clear, when empty) the pending items for an operator. */
export function setPending(operatorId: string | number, items: ConfirmCustomerItem[]): void {
  if (items.length === 0) pending.delete(operatorId);
  else pending.set(operatorId, items);
}

/** The operator's pending items (empty array if none — never undefined). */
export function getPending(operatorId: string | number): ConfirmCustomerItem[] {
  return pending.get(operatorId) ?? [];
}

/** Drop the operator's pending items (after confirm-customers consumes them). */
export function clearPending(operatorId: string | number): void {
  pending.delete(operatorId);
}
