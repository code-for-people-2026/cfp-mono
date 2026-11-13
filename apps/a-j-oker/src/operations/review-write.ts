import type { PayloadRequest } from "payload";
import { assertSessionLeaseInTransaction } from "../cms/session-lease";
import { AppError } from "../domain/contracts";

// A provider response may arrive after its caller's lease or consent ended.
// Check both inside the transaction that will append cases, evidence and audit;
// uploads have no session lease, but still cannot recreate data after deletion.
export async function assertReviewWrite(owner: string, req: PayloadRequest) {
  await assertSessionLeaseInTransaction(owner, req);
  const { docs } = await req.payload.find({ collection: "privacy-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: owner } } });
  const profile = docs[0];
  if (profile && (profile.state !== "active" || (profile.expiresAt && Date.parse(profile.expiresAt) <= Date.now())))
    throw new AppError(403, "已停止处理此身份的数据，本次审核结果未保存");
}
