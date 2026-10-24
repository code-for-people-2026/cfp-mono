import { AppError } from "../contracts";
import type { PayloadRequest } from "payload";
import type { Principal } from "../identity";
import { hash } from "../records/persistence";
import type { PrivacyService } from "../privacy/service";
import { safetyCategory, safetyNotice } from "./notice";
export interface SafetySignal { id: string; babyId: string; category: "breathing" | "consciousness"; source: "chat" | "group"; sentAt: string; observedAt: string; status: "open" | "reviewed"; note?: string }
export class SafetyService {
  constructor(private readonly privacy: PrivacyService) {}
  /** Called within an already authorized transaction; persist categories and times, not copied symptoms/photos. */
  async observe(babyId: string, sourceId: string, text: string, sentAt: string, source: "chat" | "group", req: PayloadRequest) {
    const category = safetyCategory(text); if (!category) return;
    const id = hash([babyId, source, sourceId]);
    if (await this.privacy.repository.get("safety-signals", id, req)) return;
    const value: SafetySignal = { id, babyId, category, source, sentAt, observedAt: new Date(this.privacy.identity.now()).toISOString(), status: "open" };
    await this.privacy.repository.put("safety-signals", id, value, { babyId }, req);
  }
  async acknowledge(principal: Principal, babyId: string, signalId: string) {
    return this.privacy.identity.executeAuthorized(principal, babyId, "records:read", async (_scope, req) => {
      const signal = await this.privacy.repository.get<SafetySignal>("safety-signals", signalId, req);
      if (!signal || signal.babyId !== babyId) throw new AppError(404, "SAFETY_NOTICE_NOT_FOUND", "提示不存在或不属于此宝宝。");
      await this.privacy.repository.put("privacy-state", `safety-seen:${hash([principal.subjectId, signalId])}`, { signalId, seenAt: new Date(this.privacy.identity.now()).toISOString() }, { identityId: principal.subjectId, babyId }, req);
      return { acknowledged: true };
    });
  }
  async notices(principal: Principal, babyId: string) {
    return this.privacy.identity.executeAuthorized(principal, babyId, "records:read", async (_scope, req) => {
      const rows = await this.privacy.repository.list<SafetySignal>("safety-signals", { babyId: { equals: babyId } }, req);
      const seen = await this.privacy.repository.list<{ signalId: string }>("privacy-state", { and: [{ babyId: { equals: babyId } }, { identityId: { equals: principal.subjectId } }, { key: { like: "safety-seen:" } }] }, req);
      const seenIds = new Set(seen.map(row => row.value.signalId));
      return rows.filter(row => !seenIds.has(row.value.id)).sort((a, b) => b.value.observedAt.localeCompare(a.value.observedAt)).slice(0, 50).map(({ value }) => ({ ...value, note: undefined, message: value.source === "group" ? `定时采集发现一条需要核实的描述。原消息时间：${value.sentAt}；采集时间：${value.observedAt}。这不代表当前仍在发生。请先向现场照护者核实；如现在仍有危险表现，立即寻求急救。` : safetyNotice }));
    });
  }
}
