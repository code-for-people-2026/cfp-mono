import type { Turn } from "./model";

export function retryUserMessageVisible(
  row: Turn,
  historyById: ReadonlyMap<number, Turn>,
  visibleHistoryIds: ReadonlySet<number>,
) {
  let current = row;
  while (
    current.retryOfTurnId !== undefined &&
    current.retryOfTurnId < current.id
  ) {
    const parent = historyById.get(current.retryOfTurnId);
    if (!parent) break;
    if (visibleHistoryIds.has(parent.id)) return false;
    current = parent;
  }
  return true;
}
