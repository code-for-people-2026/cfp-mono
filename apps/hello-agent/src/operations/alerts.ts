import { randomUUID } from "node:crypto";
import type { Payload } from "payload";
import { z } from "zod";
import { audit } from "./audit";
import { feishuConfig, sendFeishu, type FeishuConfig, type FeishuResult } from "./feishu";
import { transaction } from "./service";

const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 5;
const retryMs = [15_000, 60_000, 180_000, 600_000];
const detailsSchema = z.object({ attempts: z.number().int().nonnegative().default(0), token: z.string().optional(), code: z.string().optional(), deliveredAt: z.string().optional() });
type Sender = (config: FeishuConfig, target: { caseId: number; receipt: string } | { testId: string }) => Promise<FeishuResult>;
const stateQuery = { key: { equals: "feishu" } };
export async function feishuAlertStatus(payload: Payload) {
  const config = feishuConfig();
  if (!config) return { ready: false, text: "飞书机器人尚未配置" };
  if (!config.enabled) return { ready: false, text: "飞书自动通知未启用" };
  try {
    const state = (await payload.find({ collection: "safety-alert-state", overrideAccess: true, where: stateQuery, limit: 1 })).docs[0];
    if (state?.fingerprint !== config.fingerprint || !state.verifiedAt) return { ready: false, text: "飞书通知尚未完成手机收件确认" };
    if (!state.heartbeatAt || Date.now() - Date.parse(state.heartbeatAt) > LEASE_MS || Date.parse(state.heartbeatAt) > Date.now() + LEASE_MS)
      return { ready: false, text: "飞书通知任务未运行或已失联" };
    if (state.lastError) return { ready: false, text: `飞书通知需检查（${state.lastError}）` };
    return { ready: true, text: "飞书通知已启用；平台接收与人工受理分别留痕" };
  } catch { return { ready: false, text: "飞书通知状态暂时无法核实" }; }
}

export class FeishuAlerts {
  constructor(readonly payload: Payload, readonly config: FeishuConfig, readonly send: Sender = sendFeishu, readonly clock = Date.now) {}
  private async ensureState() {
    const row = (await this.payload.find({ collection: "safety-alert-state", overrideAccess: true, where: stateQuery, limit: 1 })).docs[0];
    if (row) return row;
    return transaction(this.payload, async (req) => {
      const existing = (await this.payload.find({ collection: "safety-alert-state", overrideAccess: true, req, where: stateQuery, limit: 1 })).docs[0];
      return existing || this.payload.create({ collection: "safety-alert-state", overrideAccess: true, req, data: { key: "feishu" } });
    });
  }
  async test() {
    await this.ensureState();
    const testId = randomUUID();
    const result = await this.send(this.config, { testId });
    await transaction(this.payload, async (req) => {
      await this.payload.update({ collection: "safety-alert-state", overrideAccess: true, req, where: stateQuery, data: {
        fingerprint: this.config.fingerprint, testId: result.ok ? testId : null, testedAt: result.ok ? new Date(this.clock()).toISOString() : null,
        verifiedAt: null, heartbeatAt: null, lastError: result.ok ? null : result.code,
      } });
      await audit(this.payload, "system:feishu-test", "alert.test", "feishu", result.ok ? "platform_accepted_awaiting_human" : result.code, { testId }, req);
    });
    return { ...result, testId };
  }
  async confirmTest(testId: string) {
    z.string().uuid().parse(testId);
    await transaction(this.payload, async (req) => {
      const row = (await this.payload.find({ collection: "safety-alert-state", overrideAccess: true, req, where: stateQuery, limit: 1 })).docs[0];
      if (!row || row.fingerprint !== this.config.fingerprint || row.testId !== testId || !row.testedAt || this.clock() - Date.parse(row.testedAt) > 3600_000)
        throw new Error("需要当前配置一小时内的真实测试编号及本人收件确认");
      await this.payload.update({ collection: "safety-alert-state", id: row.id, overrideAccess: true, req, data: { verifiedAt: new Date(this.clock()).toISOString(), lastError: null } });
      await audit(this.payload, "operator:feishu-setup", "alert.verified", "feishu", "负责人声明已在手机收到指定测试消息", { testId }, req);
    });
  }
  async tick() {
    if (!this.config.enabled) return "disabled";
    await this.ensureState();
    const now = this.clock(), timestamp = new Date(now).toISOString(), token = randomUUID();
    const claimed = await transaction(this.payload, async (req) => {
      // Atomic, durable sender lease also bounds traffic from competing workers.
      const locked = await this.payload.update({ collection: "safety-alert-state", overrideAccess: true, req, where: { and: [stateQuery,
        { fingerprint: { equals: this.config.fingerprint } }, { verifiedAt: { exists: true } },
        { or: [{ leaseUntil: { exists: false } }, { leaseUntil: { less_than_equal: timestamp } }] },
        { or: [{ nextSendAt: { exists: false } }, { nextSendAt: { less_than_equal: timestamp } }] },
      ] }, data: { leaseToken: token, leaseUntil: new Date(now + LEASE_MS).toISOString(), heartbeatAt: timestamp } });
      if (!locked.docs.length || locked.errors.length) return null;
      const row = (await this.payload.find({ collection: "safety-cases", overrideAccess: true, req, limit: 1, sort: "alertNextAt", where: { and: [
        { alertStatus: { in: ["pending", "retry", "sending"] } }, { alertNextAt: { less_than_equal: timestamp } },
      ] } })).docs[0];
      if (!row) return { stateId: locked.docs[0].id, row: null };
      const details = detailsSchema.parse(row.alertDetails || {});
      if (row.status === "resolved" || row.acceptedAt || row.severity !== "urgent" || Date.parse(row.createdAt) < now - 86400_000 || details.attempts >= MAX_ATTEMPTS) {
        const status = row.status === "resolved" || row.acceptedAt || row.severity !== "urgent" ? "cancelled" : "failed";
        await this.payload.update({ collection: "safety-cases", id: row.id, overrideAccess: true, req, data: { alertStatus: status, alertNextAt: null, alertDetails: { ...details, code: status === "failed" ? "expired_or_exhausted" : "already_handled" } } });
        await audit(this.payload, "system:feishu", `alert.${status}`, `case:${row.id}`, "停止自动提醒，案件处理状态不变", undefined, req);
        return { stateId: locked.docs[0].id, row: null };
      }
      await this.payload.update({ collection: "safety-cases", id: row.id, overrideAccess: true, req, data: {
        alertStatus: "sending", alertNextAt: new Date(now + LEASE_MS).toISOString(), alertDetails: { attempts: details.attempts + 1, token },
      } });
      return { stateId: locked.docs[0].id, row, attempts: details.attempts + 1 };
    });
    if (!claimed) return "not_ready_or_busy";
    let result: FeishuResult | undefined;
    if (claimed.row) {
      // No network while holding a DB transaction. Only ID/receipt leave the server.
      try { result = await this.send(this.config, { caseId: claimed.row.id, receipt: claimed.row.receipt }); }
      catch { result = { ok: false, code: "sender_error", retryable: true }; }
    }
    const finalized = await transaction(this.payload, async (req) => {
      const current = (await this.payload.find({ collection: "safety-alert-state", overrideAccess: true, req, where: { and: [stateQuery, { fingerprint: { equals: this.config.fingerprint } }, { leaseToken: { equals: token } }, { leaseUntil: { greater_than: new Date(this.clock()).toISOString() } }] }, limit: 1 })).docs[0];
      if (!current) return false; // A stale worker must not overwrite its successor.
      if (claimed.row && result) {
        const row = await this.payload.findByID({ collection: "safety-cases", id: claimed.row.id, overrideAccess: true, req });
        if (detailsSchema.parse(row.alertDetails || {}).token === token && row.alertStatus === "sending") {
          const attempts = claimed.attempts!;
          const next = result.ok ? "delivered" : result.retryable && attempts < MAX_ATTEMPTS ? "retry" : "failed";
          await this.payload.update({ collection: "safety-cases", id: row.id, overrideAccess: true, req, data: { alertStatus: next,
            alertNextAt: next === "retry" ? new Date(this.clock() + retryMs[attempts - 1]).toISOString() : null,
            alertDetails: { attempts, code: result.ok ? "platform_accepted" : result.code, ...(result.ok ? { deliveredAt: new Date(this.clock()).toISOString() } : {}) },
          } });
          await audit(this.payload, "system:feishu", `alert.${next}`, `case:${row.id}`, result.ok ? "飞书平台已接收，不代表本人已读或受理" : result.code, { attempts }, req);
        }
      }
      await this.payload.update({ collection: "safety-alert-state", id: current.id, overrideAccess: true, req, data: {
        leaseToken: null, leaseUntil: null, heartbeatAt: new Date(this.clock()).toISOString(),
        nextSendAt: new Date(this.clock() + 2000).toISOString(), ...(result ? { lastError: result.ok ? null : result.code } : {}),
      } });
      return true;
    });
    if (!finalized) return "lease_lost";
    return result ? result.ok ? "delivered" : "failed_attempt" : "idle";
  }
}
