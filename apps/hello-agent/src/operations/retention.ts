import type { Payload } from "payload";
import { OperationsService, transaction } from "./service";
import { audit } from "./audit";

// Called by privacy deletion before credentials are revoked. Held evidence is
// reported, never silently claimed deleted. No raw text enters the audit trail.
export async function eraseOperationsEvidence(payload: Payload, owner: string, reason = "本人删除关联数据") {
  return transaction(payload, async (req) => {
    const cases = (await payload.find({ collection: "safety-cases", overrideAccess: true, req, pagination: false, limit: 0, where: { owner: { equals: owner } } })).docs;
    let erased = 0, held = 0;
    for (const row of cases) {
      if (row.legalHold) { held++; continue; }
      await payload.update({ collection: "safety-evidence", overrideAccess: true, req, where: { caseId: { equals: row.id } }, data: { excerpt: null, digest: "erased", originalLength: null, purgedAt: new Date().toISOString(), purgeReason: reason } });
      // Keep only non-content operational chronology. Original opaque owner is
      // retained for deletion retries / enforcement, within configured retention.
      await payload.update({ collection: "safety-cases", id: row.id, overrideAccess: true, req, data: { reply: null, reason: "关联正文已按数据权利请求清理", feedbackAt: null, revision: Number(row.revision) + 1 } });
      erased++;
    }
    await audit(payload, "system:privacy", "evidence.erase", `owner:${owner}`, reason, { erased, held }, req);
    return { erased, held, notice: held ? "有案件依据具体留存事由暂缓清理，最小证据仅限受控访问；可提出留存复核。" : "关联投诉正文及审核证据已清理；不含正文的处置与审计记录按运营留存安排管理。" };
  });
}
export async function exportOperationsForOwner(payload: Payload, owner: string) {
  return { cases: await new OperationsService(payload).mine({ id: owner, auth: "cookie" }), notice: "不导出被隔离的违规正文、审核内部笔记或他人信息；可对处理与留存提出申诉。" };
}
export async function purgeExpiredEvidence(payload: Payload, apply = false, now = new Date()) {
  return transaction(payload, async (req) => {
    const cases = (await payload.find({ collection: "safety-cases", overrideAccess: true, req, pagination: false, limit: 0, where: { and: [{ retainUntil: { less_than_equal: now.toISOString() } }, { legalHold: { not_equals: true } }] } })).docs;
    let count = 0;
    for (const row of cases) {
      const evidence = await payload.find({ collection: "safety-evidence", overrideAccess: true, req, limit: 1, where: { and: [{ caseId: { equals: row.id } }, { purgedAt: { exists: false } }] } });
      if (!evidence.docs.length) continue;
      count++;
      if (apply) {
        await payload.update({ collection: "safety-evidence", id: evidence.docs[0].id, overrideAccess: true, req, data: { excerpt: null, digest: "erased", originalLength: null, purgedAt: now.toISOString(), purgeReason: "按案件受理时的期限到期清理" } });
        await audit(payload, "system:retention", "evidence.expired", `case:${row.id}`, "按案件受理时的期限清理最小证据", undefined, req);
      }
    }
    return { dryRun: !apply, eligible: count };
  });
}
