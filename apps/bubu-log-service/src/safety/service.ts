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
  async notices(principal: Principal, babyId: string) {
    return this.privacy.identity.executeAuthorized(principal, babyId, "records:read", async (_scope, req) => {
      const rows = await this.privacy.repository.list<SafetySignal>("safety-signals", { babyId: { equals: babyId } }, req);
      return rows.map(({ value }) => ({ ...value, note: undefined, message: value.source === "group" ? `定时采集发现一条需要核实的描述。原消息时间：${value.sentAt}；采集时间：${value.observedAt}。这不代表当前仍在发生。请先向现场照护者核实；如现在仍有危险表现，立即寻求急救。` : safetyNotice }));
    });
  }
}
