import type { Payload, PayloadRequest, Where } from "payload";
import type { SafetyCase } from "../payload-types";
import { randomUUID } from "node:crypto";
import { afterTransactionCommit, transaction } from "./transaction";
import { audit } from "./audit";
import { confirmedRetentionLedger, receiptMatches, retentionRecord, writeRetentionLedger, type RetentionLedgerRecord } from "./retention-ledger";

const PAGE_SIZE = 100;
const DAY = 86400_000;
const genericAuditReason = "案件内容已按留存期限清理";
const finiteLegacyBasis = "旧安全证据已由管理员安排在不超过30天的有限复核宽限期内";

async function pages(payload: Payload, req: PayloadRequest, where: Where, visit: (row: SafetyCase) => Promise<void>) {
  let after: number | string | undefined;
  while (true) {
    const cursor = after === undefined ? where : { and: [where, { id: { greater_than: after } }] };
    const result = await payload.find({ collection: "safety-cases", overrideAccess: true, req, pagination: false, depth: 0, limit: PAGE_SIZE, sort: "id", where: cursor });
    for (const row of result.docs) {
      after = row.id;
      await visit(row);
    }
    if (result.docs.length < PAGE_SIZE) break;
  }
}

async function activeReference(payload: Payload, req: PayloadRequest, row: SafetyCase) {
  const enforcement = await payload.count({ collection: "safety-enforcements", overrideAccess: true, req, where: { and: [{ caseId: { equals: row.id } }, { active: { equals: true } }] } });
  return enforcement.totalDocs > 0;
}

async function sanitizeEnforcements(payload: Payload, req: PayloadRequest, row: SafetyCase) {
  let after: number | string | undefined;
  while (true) {
    const where: Where = after === undefined
      ? { caseId: { equals: row.id } }
      : { and: [{ caseId: { equals: row.id } }, { id: { greater_than: after } }] };
    const result = await payload.find({ collection: "safety-enforcements", overrideAccess: true, req, pagination: false, depth: 0, limit: PAGE_SIZE, sort: "id", where });
    for (const enforcement of result.docs) {
      after = enforcement.id;
      await payload.update({ collection: "safety-enforcements", id: enforcement.id, overrideAccess: true, req, data: {
        reason: "保留必要处置状态；案件内容已清理",
        ...(!enforcement.active ? { owner: `retention-tombstone:${row.id}`, key: `retention-tombstone:${row.id}:${enforcement.id}`, sessionId: null, targetId: null } : {}),
      } });
    }
    if (result.docs.length < PAGE_SIZE) break;
  }
}

async function sanitizeAudits(payload: Payload, req: PayloadRequest, row: SafetyCase) {
  let after: number | string | undefined;
  const retentionReq = { ...req, context: { ...req.context, safetyInternal: true, safetyRetentionSanitize: true } } as PayloadRequest;
  while (true) {
    const where: Where = after === undefined
      ? { target: { equals: `case:${row.id}` } }
      : { and: [{ target: { equals: `case:${row.id}` } }, { id: { greater_than: after } }] };
    const audits = await payload.find({ collection: "safety-audit", overrideAccess: true, req, pagination: false, depth: 0, limit: PAGE_SIZE, sort: "id", where });
    for (const entry of audits.docs) {
      after = entry.id;
      await payload.update({ collection: "safety-audit", id: entry.id, overrideAccess: true, req: retentionReq, context: { safetyInternal: true, safetyRetentionSanitize: true }, data: {
        actor: String(entry.actor).startsWith("owner:") ? "owner:withheld" : entry.actor,
        reason: genericAuditReason,
        metadata: null,
      } });
    }
    if (audits.docs.length < PAGE_SIZE) break;
  }
}

async function purgeCaseContent(payload: Payload, req: PayloadRequest, row: SafetyCase, now: Date, reason: string, recordGuard = true) {
  if (row.retentionPurgedAt) return false;
  const keepReferences = await activeReference(payload, req, row);
  const nextReview = keepReferences ? new Date(now.getTime() + 30 * DAY).toISOString() : null;
  const projected = { ...row, revision: Number(row.revision) + 1, retainUntil: nextReview, retentionReviewNeeded: keepReferences, legalHold: false, holdReviewAt: null };
  if (recordGuard) await writeRetentionLedger(retentionRecord(projected, "purge"));
  await payload.update({ collection: "safety-evidence", overrideAccess: true, req, where: { caseId: { equals: row.id } }, data: { excerpt: null, provenance: null, conversation: null, digest: "erased", originalLength: null, purgedAt: now.toISOString(), purgeReason: reason } });
  await sanitizeEnforcements(payload, req, row);
  const changed = await payload.update({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ id: { equals: row.id } }, { revision: { equals: row.revision } }] }, data: {
    reason: null, reply: null, retentionBasis: null, holdReason: null, holdReviewAt: null,
    alertDetails: null, alertNextAt: null, ...(row.alertStatus && !["delivered", "failed", "cancelled"].includes(String(row.alertStatus)) ? { alertStatus: "cancelled" as const } : {}),
    retentionPurgedAt: now.toISOString(), retentionReviewNeeded: keepReferences, retainUntil: nextReview,
    legalHold: false, revision: Number(row.revision) + 1,
    ...(keepReferences ? {} : { owner: `retention-tombstone:${row.id}`, sessionId: null, turnId: null, mediaId: null, requestId: null, parentId: null }),
  } });
  if (changed.docs.length !== 1 || changed.errors.length) throw new Error("案件留存修订冲突；本轮已回滚并将在下次维护重试");
  await sanitizeAudits(payload, req, row);
  return true;
}

async function sweepReleasedReferences(payload: Payload, req: PayloadRequest, apply: boolean, now: Date) {
  let released = 0, active = 0, overdue = 0;
  await pages(payload, req, { and: [{ retentionPurgedAt: { exists: true } }, { retentionReviewNeeded: { equals: true } }] }, async (row) => {
    if (await activeReference(payload, req, row)) {
      active++;
      if (!row.retainUntil || Date.parse(String(row.retainUntil)) <= now.getTime()) overdue++;
      return;
    }
    released++;
    if (!apply) return;
    await sanitizeEnforcements(payload, req, row);
    const changed = await payload.update({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ id: { equals: row.id } }, { revision: { equals: row.revision } }] }, data: {
      owner: `retention-tombstone:${row.id}`, sessionId: null, turnId: null, mediaId: null, requestId: null, parentId: null,
      retainUntil: null, retentionReviewNeeded: false, revision: Number(row.revision) + 1,
    } });
    if (changed.docs.length !== 1 || changed.errors.length) throw new Error("生效限制引用清理发生修订冲突");
  });
  return { releasedReferenceSweeps: released, activeRestrictionReferences: active, activeRestrictionReviewsOverdue: overdue };
}

export async function validatedRetentionLedger() {
  const records: RetentionLedgerRecord[] = [];
  for await (const record of confirmedRetentionLedger()) records.push(record);
  return records;
}

export async function replayRetentionLedger(payload: Payload, req: PayloadRequest, validated?: readonly RetentionLedgerRecord[]) {
  let records = 0, states = 0, purges = 0;
  const ledger = validated ? [...validated] : await validatedRetentionLedger();
  // Validate every restored case identity before the first destructive replay.
  // The second read below is still required to apply sequential revisions.
  for (const record of ledger) {
    let row: SafetyCase;
    try { row = await payload.findByID({ collection: "safety-cases", id: record.caseId, overrideAccess: true, req, depth: 0 }); }
    catch (error) {
      const value = error as { status?: unknown; statusCode?: unknown };
      if (value?.status === 404 || value?.statusCode === 404) continue;
      throw new Error("恢复时读取安全证据案件失败，禁止恢复开放", { cause: error });
    }
    if (!receiptMatches(row, record)) throw new Error("安全证据留存清单与恢复数据库案件不一致，禁止恢复开放");
  }
  for (const record of ledger) {
    records++;
    let row: SafetyCase;
    try { row = await payload.findByID({ collection: "safety-cases", id: record.caseId, overrideAccess: true, req, depth: 0 }); }
    catch (error) {
      const value = error as { status?: unknown; statusCode?: unknown };
      if (value?.status === 404 || value?.statusCode === 404) continue;
      throw new Error("恢复时读取安全证据案件失败，禁止恢复开放", { cause: error });
    }
    if (!receiptMatches(row, record)) throw new Error("安全证据留存清单与恢复数据库案件不一致，禁止恢复开放");
    if (record.event === "purge") {
      if (!row.retentionPurgedAt && await purgeCaseContent(payload, req, row, new Date(record.recordedAt), "恢复时重放既有到期清理", false)) purges++;
      continue;
    }
    if (row.retentionPurgedAt || Number(row.revision) > record.revision) continue;
    const changed = await payload.update({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ id: { equals: row.id } }, { revision: { equals: row.revision } }] }, data: {
      revision: record.revision, retainUntil: record.retainUntil, retentionReviewNeeded: record.retentionReviewNeeded,
      retentionBasis: record.retainUntil ? finiteLegacyBasis : null,
      legalHold: record.legalHold, holdReviewAt: record.holdReviewAt,
      holdReason: record.legalHold ? "独立留存清单恢复的法律留存状态；须由管理员复核具体依据" : null,
    } });
    if (changed.docs.length !== 1 || changed.errors.length) throw new Error("恢复时重放安全证据留存状态发生修订冲突");
    states++;
  }
  return { records, states, purges };
}

export async function eraseOperationsEvidence(payload: Payload, owner: string, reason = "本人删除关联数据") {
  return transaction(payload, async (req) => {
    let erased = 0, held = 0;
    await pages(payload, req, { owner: { equals: owner } }, async (row) => {
      if (row.legalHold) { held++; return; }
      if (await purgeCaseContent(payload, req, row, new Date(), reason)) erased++;
    });
    await audit(payload, "system:privacy", "evidence.erase", "owner:withheld", "本人数据权利请求", { erased, held }, req);
    return { erased, held, notice: held ? "有案件依据具体留存事由暂缓清理，最小证据仅限受控访问；可提出留存复核。" : "关联投诉正文及审核证据已清理；必要的处置状态按有限运营用途保留。" };
  });
}

export async function purgeExpiredEvidence(payload: Payload, apply = false, now = new Date(), options: { replayLedger?: boolean; validatedLedger?: readonly RetentionLedgerRecord[] } = {}) {
  if (options.replayLedger && !apply) throw new Error("恢复留存清单必须显式启用执行模式");
  return transaction(payload, async (req) => {
    const replay = options.replayLedger ? await replayRetentionLedger(payload, req, options.validatedLedger) : undefined;
    const legacyNull = await payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ retainUntil: { exists: false } }, { retentionPurgedAt: { exists: false } }] } });
    const holdsMissingReview = await payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ legalHold: { equals: true } }, { holdReviewAt: { exists: false } }, { retentionPurgedAt: { exists: false } }] } });
    let eligible = 0, overdueHolds = 0, reviewNeeded = 0;
    await pages(payload, req, { or: [
      { and: [{ retentionReviewNeeded: { equals: true } }, { retentionPurgedAt: { exists: false } }] },
      { and: [{ legalHold: { equals: true } }, { holdReviewAt: { less_than_equal: now.toISOString() } }, { retentionPurgedAt: { exists: false } }] },
      { and: [{ retentionPurgedAt: { exists: false } }, { retentionReviewNeeded: { not_equals: true } }, { legalHold: { not_equals: true } }, { retainUntil: { exists: true } }, { retainUntil: { less_than_equal: now.toISOString() } }] },
    ] }, async (row) => {
      if (row.legalHold) { overdueHolds++; return; }
      if (row.retentionReviewNeeded) { reviewNeeded++; return; }
      eligible++;
      if (apply && await purgeCaseContent(payload, req, row, now, "按案件的有限期限到期清理"))
        await audit(payload, "system:retention", "evidence.expired", `case:${row.id}`, genericAuditReason, undefined, req);
    });
    const dueSoon = await payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [
      { legalHold: { not_equals: true } }, { retentionReviewNeeded: { not_equals: true } }, { retentionPurgedAt: { exists: false } },
      { retainUntil: { greater_than: now.toISOString() } }, { retainUntil: { less_than_equal: new Date(now.getTime() + 7 * DAY).toISOString() } },
    ] } });
    const references = await sweepReleasedReferences(payload, req, apply, now);
    return {
      dryRun: !apply, eligible, expiredExisting: eligible, legacyNullExpiry: legacyNull.totalDocs,
      overdueHolds, holdsMissingReviewDate: holdsMissingReview.totalDocs, reviewNeeded, reviewDueSoon: dueSoon.totalDocs,
      ...references, ...(replay ? { replay } : {}),
    };
  });
}

type LegacyAdoptionOptions = {
  apply?: boolean;
  activate?: boolean;
  scheduleUntil?: string;
  reason?: string;
  expectedCount?: number;
  expectedRevisions?: Record<string, number>;
  now?: Date;
};

export async function adoptLegacyEvidence(payload: Payload, value: boolean | LegacyAdoptionOptions = {}) {
  const options: LegacyAdoptionOptions = typeof value === "boolean" ? { apply: value } : value;
  const now = options.now || new Date();
  const scheduling = options.scheduleUntil !== undefined || options.reason !== undefined || options.expectedCount !== undefined || options.expectedRevisions !== undefined || options.activate === true;
  let deadline: string | undefined;
  if (scheduling) {
    if (!options.scheduleUntil || !options.reason || options.reason.trim().length < 8 || options.reason.trim().length > 1000) throw new Error("旧案排期必须提供未来期限和8—1000字的具体理由");
    const parsed = Date.parse(options.scheduleUntil);
    if (!Number.isFinite(parsed) || parsed <= now.getTime() || parsed > now.getTime() + 30 * DAY) throw new Error("旧案宽限复核期限须在未来30天内");
    deadline = new Date(parsed).toISOString();
    if (options.apply && (!Number.isSafeInteger(options.expectedCount) || !options.expectedRevisions)) throw new Error("旧案排期执行必须提供预览确认的数量和案件修订号");
  }
  return transaction(payload, async (req) => {
    const records: Array<{ id: number | string; revision: number; legalHold: boolean; holdReviewMissing: boolean }> = [];
    let count = 0, held = 0, heldMissingReview = 0;
    await pages(payload, req, { and: [{ retainUntil: { exists: false } }, { retentionPurgedAt: { exists: false } }] }, async (row) => {
      count++;
      if (row.legalHold) { held++; if (!row.holdReviewAt) heldMissingReview++; }
      records.push({ id: row.id, revision: Number(row.revision), legalHold: Boolean(row.legalHold), holdReviewMissing: Boolean(row.legalHold && !row.holdReviewAt) });
    });
    const expired = await payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [
      { retainUntil: { exists: true } }, { retainUntil: { less_than_equal: now.toISOString() } }, { retentionPurgedAt: { exists: false } }, { legalHold: { not_equals: true } },
    ] } });
    let updated = 0, alreadyApplied = 0;
    if (options.apply && scheduling) {
      const expected = options.expectedRevisions!;
      const expectedIds = Object.keys(expected);
      if (options.expectedCount !== expectedIds.length) throw new Error("旧案排期预期数量与修订清单不一致");
      const unexpected = records.filter((record) => !record.legalHold && expected[String(record.id)] === undefined);
      if (unexpected.length) throw new Error("旧案排期出现预览外候选；请重新预览");
      for (const id of expectedIds) {
        const revision = expected[id]!;
        const row = await payload.findByID({ collection: "safety-cases", id, overrideAccess: true, req, depth: 0 });
        const reviewNeeded = options.activate !== true;
        if (!row.retentionPurgedAt && !row.legalHold && row.retainUntil === deadline && Boolean(row.retentionReviewNeeded) === reviewNeeded && Number(row.revision) === revision + 1) {
          alreadyApplied++;
          continue;
        }
        if (row.retentionPurgedAt || row.legalHold || row.retainUntil || Number(row.revision) !== revision)
          throw new Error("旧案排期修订号或状态与预览不一致；请重新预览");
        const changed = await payload.update({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ id: { equals: row.id } }, { revision: { equals: revision } }, { retainUntil: { exists: false } }] }, data: {
          retainUntil: deadline, retentionReviewNeeded: reviewNeeded, retentionBasis: finiteLegacyBasis, revision: revision + 1,
        } });
        if (changed.docs.length !== 1 || changed.errors.length) throw new Error("旧案排期发生修订冲突；本轮已回滚");
        const operationId = randomUUID();
        await writeRetentionLedger(retentionRecord(changed.docs[0], "state_intent", operationId));
        afterTransactionCommit(req, () => writeRetentionLedger(retentionRecord(changed.docs[0], "state_commit", operationId)));
        await audit(payload, "system:approved-retention", options.activate ? "case.legacy_retention_scheduled_and_activated" : "case.legacy_retention_scheduled", `case:${row.id}`, options.reason!, {
          revision: revision + 1, retainUntil: deadline, automaticCleanupActive: options.activate === true,
        }, req);
        updated++;
      }
    } else if (options.apply) {
      await pages(payload, req, { and: [{ retainUntil: { exists: false } }, { retentionReviewNeeded: { not_equals: true } }, { retentionPurgedAt: { exists: false } }] }, async (row) => {
        const changed = await payload.update({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ id: { equals: row.id } }, { revision: { equals: row.revision } }] }, data: { retentionReviewNeeded: true, revision: Number(row.revision) + 1 } });
        if (changed.docs.length !== 1 || changed.errors.length) throw new Error("旧案复核标记发生修订冲突；本轮已回滚");
        const operationId = randomUUID();
        await writeRetentionLedger(retentionRecord(changed.docs[0], "state_intent", operationId));
        afterTransactionCommit(req, () => writeRetentionLedger(retentionRecord(changed.docs[0], "state_commit", operationId)));
        updated++;
      });
    }
    return {
      dryRun: !options.apply, mode: scheduling ? options.activate ? "schedule_and_activate" as const : "schedule" as const : "review" as const,
      count, schedulable: count - held, updated, alreadyApplied, held, heldMissingReviewDate: heldMissingReview,
      activated: options.activate === true ? updated : 0,
      expiredExisting: expired.totalDocs, records, recordsTruncated: false,
      ...(deadline ? { scheduleUntil: deadline } : {}),
    };
  });
}
