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
  specialist?: { handoff?: { status: string } } | null;
};

/**
 * Find turns which must not be presented as the current conversation.
 *
 * Rows may arrive in any order. Unknown, self, and forward retry links are
 * ignored. A noncompleted parent is superseded when any child is created, while
 * a completed parent waits until a real replacement is delivered anywhere in
 * its descendant chain. A completed failed-handoff retry after earlier delivery
 * is a repeated fallback, not a real replacement.
 */
export function projectRetryLineage(
  rows: readonly RetryLineageRow[],
) {
  const rowById = new Map<number, RetryLineageRow>();
  const deliveredAncestry = new Set<number>();
  const repeatedFallbacks = new Set<number>();

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

  const ascending = [...rowById.values()].sort((a, b) => a.id - b.id);
  for (const row of ascending) {
    if (row.retryOfTurnId === undefined) continue;
    if (
      !Number.isInteger(row.retryOfTurnId) ||
      row.retryOfTurnId <= 0
    )
      throw new TypeError("Retry parent ids must be positive integers");
  }

  for (const row of ascending) {
    const parentId = row.retryOfTurnId;
    const parent =
      parentId !== undefined &&
      Number.isInteger(parentId) &&
      parentId > 0 &&
      parentId < row.id
        ? rowById.get(parentId)
        : undefined;
    const inheritedDelivery = !!parent && deliveredAncestry.has(parent.id);

    if (
      row.status === "completed" &&
      row.specialist?.handoff?.status === "failed" &&
      inheritedDelivery
    )
      repeatedFallbacks.add(row.id);

    if (row.status === "completed" || inheritedDelivery)
      deliveredAncestry.add(row.id);
  }

  const superseded = new Set<number>();
  const hasValidChild = new Set<number>();
  const hasDeliveredDescendant = new Set<number>();
  for (const row of ascending.reverse()) {
    const parentId = row.retryOfTurnId;
    const parent =
      parentId !== undefined &&
      Number.isInteger(parentId) &&
      parentId > 0 &&
      parentId < row.id
        ? rowById.get(parentId)
        : undefined;
    const realDelivery =
      (row.status === "completed" && !repeatedFallbacks.has(row.id)) ||
      hasDeliveredDescendant.has(row.id);

    if (parent) {
      hasValidChild.add(parent.id);
      if (realDelivery) hasDeliveredDescendant.add(parent.id);
    }

    if (
      hasValidChild.has(row.id) &&
      (row.status !== "completed" ||
        repeatedFallbacks.has(row.id) ||
        hasDeliveredDescendant.has(row.id))
    )
      superseded.add(row.id);
  }

  return {
    superseded: new Set([...superseded].sort((a,b)=>a-b)),
    repeatedFallbacks,
  };
}
