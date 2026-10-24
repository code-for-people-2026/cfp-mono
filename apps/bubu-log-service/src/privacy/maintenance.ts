import type { PayloadRequest } from "payload";
import type { AttachmentService } from "../records/attachments";
import type { PrivacyService } from "./service";
import type { DeletionService } from "./deletion";
import type { StoredTurn } from "../chat/persistence";
import type { CollectorBatch } from "../collector/service";

interface Report { expiredChats: number; expiredMessages: number; expiredBatches: number; orphanAttachments: number; expiredSignals: number; deferredTasks: number }
/** One owner and transaction queue; never race a care write or remove a referenced image. */
export class PrivacyMaintenance {
  constructor(private readonly privacy: PrivacyService, private readonly attachments: AttachmentService, private readonly deletion: DeletionService) {}
  async run(apply = false): Promise<Report> {
    if (!this.privacy.policy().ready) throw new Error("Retention policy must be configured before maintenance");
    if (apply) await this.deletion.processPending();
    return this.privacy.identity.exclusive(() => this.privacy.identity.store.transaction(async req => {
      const payload = this.privacy.identity.store.payload, now = this.privacy.identity.now();
      const cutoff = now - this.privacy.config.chatDays * 86400_000, orphanCutoff = now - this.privacy.config.orphanHours * 3600_000;
      const report: Report = { expiredChats: 0, expiredMessages: 0, expiredBatches: 0, orphanAttachments: 0, expiredSignals: 0, deferredTasks: 0 };
      const rows = async (collection: string) => (await payload.find({ collection, pagination: false, limit: 0, depth: 0, overrideAccess: true, req })).docs;
      const update = async (collection: string, id: string | number, value: unknown) => { if (apply) await payload.update({ collection, id, data: { value }, overrideAccess: true, req }); };
      for (const row of await rows("chat-turns")) {
        const turn = row.value as StoredTurn;
        if (turn.privacyExpired || !(Date.parse(turn.createdAt) < cutoff)) continue;
        if (turn.status === "processing" || turn.status === "needs_recovery" || turn.steps.some(step => step.state !== "completed")) { report.deferredTasks++; continue; }
        report.expiredChats++;
        await update("chat-turns", row.id, { ...turn, privacyExpired: true, input: { text: "原文已按保留期限清理", attachmentIds: [], context: { viewedDate: turn.input.context.viewedDate } }, assistantText: "对话原文已清理，已保存的照护记录仍可在日历查看。", transcript: [], steps: [], receipts: [], pending: [], modelContext: undefined, versions: {}, questionVersions: {}, status: "failed", error: { code: "RETENTION_EXPIRED", message: "原文已清理，请发起新消息。", retryable: false } });
      }
      for (const row of await rows("care-batches")) {
        const batch = row.value as CollectorBatch & { privacyExpired?: boolean };
        if (batch.privacyExpired || !(Date.parse(batch.startedAt) < cutoff)) continue;
        if (batch.state !== "completed") { report.deferredTasks++; continue; }
        report.expiredBatches++;
        await update("care-batches", row.id, { ...batch, privacyExpired: true, messages: undefined, plan: undefined, mediaOnly: undefined });
      }
      for (const row of await rows("care-messages")) {
        const value = row.value as { source: { text: string; sentAt: string }; state: string; privacyExpired?: boolean; [key: string]: unknown };
        if (value.privacyExpired || !(Date.parse(value.source.sentAt) < cutoff)) continue;
        if (value.state === "pending") { report.deferredTasks++; continue; }
        report.expiredMessages++;
        // Keep source IDs, hash and cursor deduplication; raw words cannot return through ordinary retries.
        await update("care-messages", row.id, { ...value, privacyExpired: true, source: { ...value.source, text: "" }, reason: undefined });
      }
      const references = new Map<string, string[]>();
      for (const collection of ["care-events", "care-revisions", "care-operations", "care-messages", "care-batches", "chat-turns"]) for (const row of await rows(collection)) {
        const key = String(row.babyId); references.set(key, [...references.get(key) || [], JSON.stringify(row.value)]);
      }
      for (const row of await rows("care-attachments")) {
        const value = row.value as { id: string; babyId: string; createdAt: string; legacyReference?: unknown };
        // Imported photos belong to original care facts/history, outside the sidecar reference tables.
        // Like a retracted event's revision, they survive until the guardian deletes the family.
        if (value.legacyReference) continue;
        if (!(Date.parse(value.createdAt) < orphanCutoff) || references.get(value.babyId)?.some(text => text.includes(value.id))) continue;
        report.orphanAttachments++;
        if (apply) await payload.delete({ collection: "care-attachments", id: row.id, overrideAccess: true, req });
      }
      for (const row of await rows("safety-signals")) {
        const value = row.value as { observedAt: string };
        if (Date.parse(value.observedAt) < cutoff) { report.expiredSignals++; if (apply) await payload.delete({ collection: "safety-signals", id: row.id, overrideAccess: true, req }); }
      }
      for (const row of await rows("privacy-state")) {
        const value = row.value as { seenAt?: string; expiresAt?: string };
        const time = String(row.key).startsWith("safety-seen:") ? value.seenAt : String(row.key).startsWith("intent:") ? value.expiresAt : undefined;
        if (time && Date.parse(time) < cutoff && apply) await payload.delete({ collection: "privacy-state", id: row.id, overrideAccess: true, req });
      }
      if (apply) await this.attachments.purgeOrphanObjects(req as PayloadRequest, orphanCutoff);
      return report;
    }));
  }
}
