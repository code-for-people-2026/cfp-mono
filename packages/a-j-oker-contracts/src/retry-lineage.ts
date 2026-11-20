export function imageGenerationBlocksRetry(
  image: { status?: unknown } | null | undefined,
): boolean {
  const status = image?.status;
  return (
    status === "submitting" ||
    status === "pending" ||
    status === "stored"
  );
}

type RetryLineageRow = {
  id: number;
  status: "running" | "failed" | "completed";
  retryOfTurnId?: number;
};

/**
 * Find turns which must not be presented as the current conversation.
 *
 * Rows may arrive in any order. Unknown, self, and forward retry links are
 * ignored. A noncompleted parent is superseded when any child is created, while
 * a completed parent waits until a completed replacement exists anywhere in its
 * descendant chain.
 */
export function supersededRetryTurnIds(
  rows: readonly RetryLineageRow[],
): Set<number> {
  const rowById = new Map<number, RetryLineageRow>();
  const childrenByParentId = new Map<number, RetryLineageRow[]>();

  for (const row of rows) {
    if (!Number.isInteger(row.id) || row.id <= 0)
      throw new TypeError("Retry turn ids must be positive integers");
    if (
      row.status !== "running" &&
      row.status !== "failed" &&
      row.status !== "completed"
    )
      throw new TypeError("Retry turn status is invalid");

    if (rowById.has(row.id))
      throw new RangeError("Retry turn ids must be unique");
    rowById.set(row.id, row);
  }

  for (const row of rowById.values()) {
    if (row.retryOfTurnId === undefined) continue;
    if (!Number.isInteger(row.retryOfTurnId) || row.retryOfTurnId <= 0)
      throw new TypeError("Retry parent ids must be positive integers");
    if (
      row.retryOfTurnId === row.id ||
      row.retryOfTurnId > row.id ||
      !rowById.has(row.retryOfTurnId)
    )
      continue;
    const siblings = childrenByParentId.get(row.retryOfTurnId) ?? [];
    siblings.push(row);
    childrenByParentId.set(row.retryOfTurnId, siblings);
  }

  const superseded = new Set<number>();
  const hasCompletedDescendant = new Set<number>();
  for (const row of [...rowById.values()].sort((a, b) => b.id - a.id)) {
    const children = childrenByParentId.get(row.id) ?? [];
    const completed = children.some(
      (child) =>
        child.status === "completed" || hasCompletedDescendant.has(child.id),
    );

    if (children.length > 0 && (row.status !== "completed" || completed))
      superseded.add(row.id);

    if (row.status === "completed" || completed)
      hasCompletedDescendant.add(row.id);
  }

  return new Set([...superseded].sort((a, b) => a - b));
}
