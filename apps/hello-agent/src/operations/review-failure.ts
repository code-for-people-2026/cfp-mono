import type { PayloadRequest, Where } from "payload";
import { AppError } from "../domain/contracts";
import type { ModerationRequest } from "../domain/moderation";

function limit(name: string, fallback: number) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new AppError(503, "审核故障记录额度配置无效，请联系管理员");
  return Number(value);
}

// Called after BEGIN IMMEDIATE, using the same Payload request as the eventual
// case/evidence/audit writes. No second ledger or pre-transaction read can race
// another worker. Persisted cases preserve deduplication across days/restarts.
export async function reviewFailureAdmission(owner: string, request: ModerationRequest, req: PayloadRequest) {
  const base: Where[] = [{ source: { equals: "moderation" } }, { decision: { equals: "unavailable" } }];
  const duplicate = await req.payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [
    ...base, { owner: { equals: owner } }, { stage: { equals: request.stage } }, { requestId: { equals: request.requestId } },
  ] } });
  if (duplicate.totalDocs) return "duplicate";
  const ownerLimit = limit("HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT", 10);
  const globalLimit = limit("HELLO_REVIEW_FAILURE_GLOBAL_DAILY_LIMIT", 100);
  if (!ownerLimit || !globalLimit) return "limited";
  const today = new Date().toISOString().slice(0, 10);
  const day: Where[] = [...base, { createdAt: { greater_than_equal: `${today}T00:00:00.000Z` } },
    { createdAt: { less_than: new Date(Date.parse(`${today}T00:00:00.000Z`) + 86400_000).toISOString() } }];
  const total = await req.payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: day } });
  if (total.totalDocs >= globalLimit) return "limited";
  const owned = await req.payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [...day, { owner: { equals: owner } }] } });
  return owned.totalDocs >= ownerLimit ? "limited" : "create";
}
