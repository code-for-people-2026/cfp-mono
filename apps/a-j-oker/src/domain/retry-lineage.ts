import { createHash } from "node:crypto";
import type { AJoker } from "../payload-types";

export function retryRequestId(owner: string, turnId: number) {
  const digest = createHash("sha256")
    .update(`${owner}:turn-retry:${turnId}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

type RetryRequestRow = Pick<AJoker, "id" | "requestKey">;
type RetryLineage = { retryOfTurnId?: number };

export function retryLineages(
  owner: string,
  rows: readonly RetryRequestRow[],
): RetryLineage[] {
  const parentByRequestKey = new Map<string, RetryRequestRow>();
  for (const candidate of rows) {
    const requestKey = `${owner}:${retryRequestId(owner, candidate.id)}`;
    if (!parentByRequestKey.has(requestKey))
      parentByRequestKey.set(requestKey, candidate);
  }

  return rows.map((row) => {
    const parent = parentByRequestKey.get(row.requestKey);
    return parent ? { retryOfTurnId: parent.id } : {};
  });
}
