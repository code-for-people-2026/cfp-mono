import { constants } from "node:fs";
import { open, statfs } from "node:fs/promises";
import { z } from "zod";
import type { PrivacyService } from "../privacy/service";
import type { DeletionJob } from "../privacy/deletion";
import type { CollectorJob } from "../collector/service";
import type { ImageReviewService } from "../images/review";

export type HealthLevel = "ok" | "warning" | "critical" | "unconfigured";
export interface HealthCheck { id: string; label: string; level: HealthLevel; message: string; at?: string }
export interface OperationsHealthReport { at: string; checks: HealthCheck[] }
const time = z.iso.datetime();
// This file is written by the host timer, mounted read-only, and contains no paths or customer identifiers.
const hostReportSchema = z.object({
  version: z.literal(1),
  backup: z.object({ state: z.enum(["running", "verified", "failed"]), at: time, lastVerifiedAt: time.optional() }).strict().optional(),
  certificate: z.object({ state: z.enum(["verified", "failed"]), at: time, expiresAt: time.optional() }).strict().optional(),
}).strict();
const age = (at: string | undefined, now: number) => at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now + 60_000 ? Math.max(0, now - Date.parse(at)) : Infinity;

export async function readHostReport(file: string | undefined) {
  if (!file) return undefined;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o022)) throw new Error("Invalid host report");
    return hostReportSchema.parse(JSON.parse(await handle.readFile("utf8")));
  } finally { await handle.close(); }
}

/** Only low-cardinality operational counts leave this module; never facts, messages, IDs, or errors. */
export class OperationsHealth {
  constructor(private readonly privacy: PrivacyService, private readonly directory: string, private readonly hostReportFile?: string, private readonly imageReview?: ImageReviewService) {}
  async read(): Promise<OperationsHealthReport> {
    const now = this.privacy.identity.now(), checks: HealthCheck[] = [];
    const add = (id: string, label: string, level: HealthLevel, message: string, at?: string) => checks.push({ id, label, level, message, ...(at ? { at } : {}) });
    const policyReady = this.privacy.policy().ready;
    add("policy", "隐私配置", policyReady ? "ok" : "unconfigured", policyReady ? "必要配置已填写，仍需单独核对平台审核与供应商约定。" : "运营主体、期限或供应商说明尚未完整配置。到期清理未启用。");
    add("image-review", "图片安全检测", this.imageReview?.configured ? "warning" : "unconfigured", this.imageReview?.configured ? "本地凭证及披露已配置；不代表供应商已开通、额度充足或真实图片检测已验收。" : "图片上传和图片交给 AI 保持关闭，等待检测服务及处理说明配置。");
    try {
      if (!this.privacy.ledger) throw new Error("Missing ledger");
      this.privacy.ledger.read();
      add("ledger", "独立删除清单", "ok", "完整性检查通过；异地保管情况需单独核实。");
    } catch { add("ledger", "独立删除清单", "critical", "清单缺失或校验失败。保持数据处理关闭，先恢复最新清单。"); }
    try {
      const { maintenance, jobs } = await this.privacy.identity.exclusive(async () => ({
        maintenance: await this.privacy.repository.get<{ at: string; failed?: boolean; report?: { deferredTasks?: number } }>("privacy-state", "maintenance:last"),
        jobs: (await this.privacy.repository.list<DeletionJob>("privacy-state", { key: { like: "deletion:" } })).filter(row => row.key.startsWith("deletion:")).map(row => row.value),
      }));
      const failed = jobs.filter(job => job.status === "retry").length, pending = jobs.filter(job => job.status !== "completed").length;
      add("deletion", "删除任务", failed ? "critical" : pending ? "warning" : "ok", `${pending} 项未完成，${failed} 项需要重试。`);
      const stale = age(maintenance?.at, now) > 180_000;
      const deferred = maintenance?.report?.deferredTasks || 0;
      add("maintenance", "原文与孤立图片清理", !policyReady ? "unconfigured" : maintenance?.failed ? "critical" : stale || deferred ? "warning" : "ok",
        !policyReady ? "等待隐私保留期限确认。" : maintenance?.failed ? "最近一次清理失败，请核对隐私队列。" : stale ? "超过三个运行周期未确认清理结果。" : deferred ? `${deferred} 项未完成任务暂停清理，需要核对保存结果。` : "最近清理已完成，无暂停事项。", maintenance?.at);
    } catch { add("maintenance", "隐私任务", "critical", "无法读取任务状态，不能确认清理或删除是否完成。"); }
    try {
      const disk = await statfs(this.directory), available = disk.bavail * disk.bsize, ratio = disk.blocks ? disk.bavail / disk.blocks : 0;
      add("disk", "数据磁盘", ratio < .05 || available < 256 * 1024 ** 2 ? "critical" : ratio < .1 || available < 1024 ** 3 ? "warning" : "ok", `可用 ${Math.floor(available / 1024 ** 2)} MiB（${Math.floor(ratio * 100)}%）。`);
    } catch { add("disk", "数据磁盘", "critical", "无法读取剩余空间。"); }
    try {
      const host = await readHostReport(this.hostReportFile), backup = host?.backup, cert = host?.certificate;
      add("backup", "加密备份", !backup ? "unconfigured" : backup.state === "failed" ? "critical" : age(backup.lastVerifiedAt, now) > 30 * 3600_000 || backup.state === "running" ? "warning" : "ok",
        !backup ? "未收到宿主机备份结果。" : backup.state === "failed" ? "最近备份失败，上一份可用备份不会被覆盖。" : backup.state === "running" ? "备份正在运行；中断或长时间无结果需要核对宿主机。" : age(backup.lastVerifiedAt, now) > 30 * 3600_000 ? "超过 30 小时未确认有效备份。" : "最近备份已通过加密完整性与内容清单校验。", backup?.lastVerifiedAt);
      const remaining = cert?.expiresAt ? Date.parse(cert.expiresAt) - now : 0;
      add("certificate", "HTTPS 证书", !cert ? "unconfigured" : cert.state === "failed" || age(cert.at, now) > 2 * 3600_000 || remaining < 7 * 86400_000 ? "critical" : remaining < 20 * 86400_000 ? "warning" : "ok",
        !cert ? "未收到证书验证结果。" : cert.state === "failed" ? "公网证书或域名验证失败。" : age(cert.at, now) > 2 * 3600_000 ? "证书检查超过两小时未更新。" : `证书剩余 ${Math.max(0, Math.floor(remaining / 86400_000))} 天。`, cert?.at);
    } catch { add("host-report", "宿主机监测", "critical", "运行报告缺失、不可读或格式不正确。备份和证书状态均未确认。"); }
    add("recovery", "异地恢复与通知", "unconfigured", "此页面不代表异地备份、恢复演练或外部通知已配置；正式开放前需逐项验收。");
    return { at: new Date(now).toISOString(), checks };
  }
}

/** A scoped view only, evaluated against this server's clock; no missing care record is a safety signal. */
export function collectorHealth(jobs: CollectorJob[], now: number): HealthCheck {
  const enabled = jobs.filter(job => job.enabled), failed = enabled.filter(job => job.failure).length;
  const late = enabled.filter(job => Date.parse(job.nextRunAt) + Math.max(180_000, job.intervalMs * 3) < now && age(job.heartbeatAt, now) > Math.max(180_000, job.intervalMs * 3)).length;
  return { id: "collector", label: "本家庭群采集", level: !enabled.length ? "unconfigured" : failed ? "critical" : late ? "warning" : "ok",
    message: !enabled.length ? "尚未启用采集任务。" : `${enabled.length} 项启用，${failed} 项失败，${late} 项逾期且无近期心跳。此状态不代表群内发生了健康异常。` };
}
