import { eraseOperationsEvidence } from "../operations/retention";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrivacyProfile } from "../payload-types";
import type { Payload } from "payload";
import { Repository, type OwnedCollection } from "../cms/repository";
import { AppError, type Owner } from "../domain/contracts";
import { MediaService } from "../domain/media";
import { privacyPolicy } from "./policy";
import { writeDeletionLedger } from "./deletion-ledger";
import { aiMetadata } from "../labeling/metadata";
import { ExportBudget } from "./export-limits";
import { updateProfile } from "./profile-store";
import { withCredentialLock } from "../server/credential-lock";
import { revokeCredentials } from "../server/auth";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const consentSchema = z.object({ version: z.string(), core: z.literal(true), model: z.literal(true), sensitive: z.boolean(), external: z.boolean(), externalRecipient: z.object({ name: z.string().trim().min(2).max(200), contact: z.string().trim().min(3).max(200), region: z.string().trim().min(2).max(100), privacyUrl: z.string().url().max(500) }).strict().optional() }).strict().refine((value) => !value.external || !!value.externalRecipient, "外部授权需要先填写实际接收方、联系方式、地域和政策链接");
const contentCollections = ["adk-sessions", "greetings", "sessions", "session-locks"] as const;
// Keep the latest consent evidence plus bounded recent lifecycle events. This
// is a local account history, not an unlimited content-safety audit archive.
function consentEvents(previous: PrivacyProfile["events"], next: { action: string; at: string; consent?: PrivacyProfile["consent"]; policySnapshot?: ReturnType<typeof privacyPolicy>["documents"] }) {
  const events = Array.isArray(previous) ? previous : [];
  const latestConsent = events.findLast((event) => event && typeof event === "object" && "action" in event && event.action === "consent");
  const recent = events.slice(-63);
  if (latestConsent && !recent.includes(latestConsent)) recent.unshift(latestConsent);
  const candidates = [...recent, next];
  const pinned = next.consent ? candidates.length - 1 : latestConsent ? candidates.indexOf(latestConsent) : -1;
  const kept = new Set([candidates.length - 1, ...(pinned >= 0 ? [pinned] : [])]);
  const size = (event: unknown) => Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
  let bytes = 2 + [...kept].reduce((sum, index) => sum + size(candidates[index]), 0);
  if (bytes > 128 * 1024) throw new AppError(503, "隐私授权凭据超出存储上限，请联系管理员核实政策配置");
  for (let index = candidates.length - 2; index >= 0 && kept.size < 64; index--) {
    if (kept.has(index)) continue;
    const added = size(candidates[index]);
    if (bytes + added <= 128 * 1024) { kept.add(index); bytes += added; }
  }
  return candidates.filter((_, index) => kept.has(index));
}
/** @public Privacy state lookup shared with identity integrations. */
export async function profileFor(payload: Payload, owner: string) {
  return (await payload.find({ collection: "privacy-profiles", overrideAccess: true, limit: 1, where: { owner: { equals: owner } } })).docs[0];
}
export class PrivacyService {
  constructor(readonly repo: Repository, readonly media = new MediaService(repo)) {}
  async status() {
    const profile = await profileFor(this.repo.payload, this.repo.owner.id);
    return { policy: privacyPolicy(), state: profile?.state || "unaccepted", consent: profile?.consent || null, expiresAt: profile?.expiresAt || null, hasRecoveryCode: !!profile?.recoveryDigest };
  }
  private async save(data: Partial<Pick<PrivacyProfile, "state" | "consent" | "expiresAt" | "recoveryDigest">>, event: string, profile: PrivacyProfile | undefined) {
    if (!profile && !data.state) throw new AppError(409, "请先完成隐私设置");
    const next = { ...data, state: data.state || profile!.state, owner: this.repo.owner.id, events: consentEvents(profile?.events, { action: event, at: new Date().toISOString(), ...(data.consent ? { consent: data.consent, policySnapshot: privacyPolicy().documents } : {}) }) };
    return profile
      ? updateProfile(this.repo.payload, profile, next)
      : this.repo.payload.create({ collection: "privacy-profiles", overrideAccess: true, data: { ...next, revision: 0 } });
  }
  async consent(value: unknown) {
    if (this.repo.owner.auth === "bearer") throw new AppError(403, "请本人在隐私与数据页面确认授权");
    const consent = consentSchema.parse(value);
    const policy = privacyPolicy();
    if (consent.version !== policy.version) throw new AppError(409, "政策已更新，请重新阅读当前版本");
    if (process.env.HELLO_DEPLOYED === "true" && !policy.ready) throw new AppError(503, "隐私运营资料尚未确认，暂不开放新的处理授权");
    const profile = await profileFor(this.repo.payload, this.repo.owner.id);
    if (profile?.state === "deleting" || profile?.state === "deleted") throw new AppError(409, "此身份正在删除或已删除，不能重新授权");
    const previous = consentSchema.safeParse(profile?.consent);
    const unexpired = profile?.expiresAt ? Date.parse(profile.expiresAt) > Date.now() : !policy.retentionDays;
    if (profile?.state === "active" && unexpired && previous.success && JSON.stringify(previous.data) === JSON.stringify(consent)) return this.status();
    await withCredentialLock(this.repo.owner.id, async () => {
      // Revoke before recording new scopes/recipients. Partial cleanup must
      // leave the prior consent intact, so surviving tokens never inherit a
      // recipient authorization the user has not granted to them.
      await this.revoke("bearer");
      await this.save({ state: "active", consent, expiresAt: policy.retentionDays ? new Date(Date.now() + policy.retentionDays * 86400_000).toISOString() : null }, "consent", profile);
    });
    return this.status();
  }
  async require(scope: "core" | "sensitive" | "external" = "core") {
    if (process.env.HELLO_DEPLOYED === "true" && !privacyPolicy().ready) throw new AppError(503, "隐私运营配置尚未核实，暂不开放新的数据处理");
    const profile = await profileFor(this.repo.payload, this.repo.owner.id);
    const parsed = consentSchema.safeParse(profile?.consent);
    if (profile?.state !== "active" || !parsed.success || parsed.data.version !== privacyPolicy().version || (profile.expiresAt && Date.parse(String(profile.expiresAt)) <= Date.now()))
      throw new AppError(403, "请先在隐私与数据中阅读并同意当前政策；撤回或到期后仅可查阅、导出和删除");
    if (!parsed.data[scope]) throw new AppError(403, scope === "sensitive" ? "图片、情绪练习或敏感内容需要单独同意；可在隐私与数据中设置" : "请先本人确认外部 Agent 可读取全部对话和图片");
  }
  async requireImageInput() {
    await this.require("sensitive");
    if (!privacyPolicy().imageReviewDisclosed) throw new AppError(503, "图片审核接收方告知尚未配置完整，请稍后重试");
  }
  async requireInput(input: unknown) {
    await this.require();
    // Conservative guard, not a claim to classify all sensitive information.
    const hasSensitiveContent = (value: unknown) => /formResponse|clientEvent|mediaIds":\[[^\]]+|抑郁|焦虑|病历|诊断|药物|自杀|自伤|身份证|银行卡|健康|心理|情绪/.test(JSON.stringify(value));
    // Once prior records may contain sensitive material, even an ordinary new
    // prompt/summary can disclose that history. Withdrawal stops that reuse.
    const profile = await profileFor(this.repo.payload, this.repo.owner.id);
    let usesSensitiveContent = hasSensitiveContent(input) || profile?.sensitiveHistory === true;
    // Legacy history has not necessarily passed through this marker. Bounded
    // input-only pages avoid both full materialization and one query per turn.
    const historyPageSize = 32;
    let cursor = 0;
    while (!usesSensitiveContent && !profile?.historyInspected) {
      const rows = (await this.repo.payload.find({ collection: "greetings", overrideAccess: false, context: { helloOwner: this.repo.owner.id }, depth: 0, limit: historyPageSize, pagination: false, sort: "id", select: { id: true, input: true }, where: { and: [{ owner: { equals: this.repo.owner.id } }, { id: { greater_than: cursor } }] } })).docs;
      usesSensitiveContent = rows.some((row) => hasSensitiveContent(row.input));
      if (usesSensitiveContent || rows.length < historyPageSize) break;
      cursor = rows[rows.length - 1].id;
    }
    if (usesSensitiveContent) {
      await this.require("sensitive");
      if (!profile?.sensitiveHistory) await this.markHistory(profile!, true);
    } else if (!profile?.historyInspected) {
      // Ordinary legacy history is also cached, so later requests do not
      // repeatedly scan it. New inputs are still checked on every request.
      await this.markHistory(profile!, false);
    }
  }
  private async markHistory(profile: PrivacyProfile, sensitive: boolean) {
    let expected = profile;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await updateProfile(this.repo.payload, expected, { historyInspected: true, ...(sensitive ? { sensitiveHistory: true } : {}) });
        return;
      } catch (error) {
        if (!(error instanceof AppError && error.status === 409)) throw error;
        const current = await profileFor(this.repo.payload, this.repo.owner.id);
        // Only merge monotonic inspection markers under the same authorization.
        // Never turn a withdrawal, deletion or changed consent into success.
        if (!current || current.state !== "active" || current.state !== profile.state || current.expiresAt !== profile.expiresAt || JSON.stringify(current.consent) !== JSON.stringify(profile.consent)) throw error;
        await this.require(sensitive || current.sensitiveHistory ? "sensitive" : "core");
        if (current.historyInspected && (!sensitive || current.sensitiveHistory)) return;
        expected = current;
      }
    }
    throw new AppError(409, "隐私设置已在其他页面变更，请刷新后重新确认");
  }
  async revoke(kind?: Owner["auth"]) {
    await revokeCredentials(this.repo.payload, this.repo.owner.id, kind);
  }
  async withdraw() {
    const profile = await profileFor(this.repo.payload, this.repo.owner.id);
    if (profile?.state === "deleting" || profile?.state === "deleted") throw new AppError(409, "删除已开始，请继续删除流程");
    await withCredentialLock(this.repo.owner.id, async () => {
      await this.save({ state: "withdrawn", expiresAt: new Date().toISOString() }, "withdraw", profile);
      await this.revoke("bearer");
    });
    return this.status();
  }
  async recoveryCode() {
    const current = await profileFor(this.repo.payload, this.repo.owner.id);
    if (!current || current.state === "deleted" || current.state === "deleting") throw new AppError(409, "请先完成隐私设置");
    const code = randomBytes(32).toString("base64url");
    await withCredentialLock(this.repo.owner.id, () => this.save({ recoveryDigest: digest(code) }, "rotate-recovery", current));
    return { code };
  }
  private async *exportRows<C extends OwnedCollection>(collection: C) {
    let cursor = 0;
    while (true) {
      const [row] = await this.repo.list(collection, { id: { greater_than: cursor } }, 1, "id");
      if (!row) return;
      yield row;
      cursor = row.id;
    }
  }
  async exportData() {
    const profile = await profileFor(this.repo.payload, this.repo.owner.id);
    const budget = new ExportBudget();
    const records: Record<string, unknown[]> = {};
    const media: { id: number; createdAt?: string; mimeType?: string; source?: string; base64?: string; withheld?: boolean; notice?: string }[] = [];
    const credentials: { kind: string; expiresAt: string; createdAt: string }[] = [];
    const safetyCases: unknown[] = [];
    const result = { retainedSafetyRecords: safetyCases, format: "hello-agent-personal-data-v1", exportedAt: new Date().toISOString(), notice: "已隔离内容不通过自动导出重新传播，可通过隐私权利请求申请复核；用户输入与上传图片保持原始归属；greetings 中的回应和 artifacts 为 AI 生成，外部来源由客户端声明。内部执行快照可能含后台参考资料，不纳入自助导出；如需其他本人数据，可通过隐私权利请求申请核验副本。", metadata: aiMetadata(`personal-export:${this.repo.owner.id}`), records, media, credentials, privacy: profile ? { state: profile.state, consent: profile.consent, events: profile.events, expiresAt: profile.expiresAt } : null };
    budget.add(result, false);
    // ADK snapshots mix visitor input with admin-only knowledgeContext and
    // tool state. The visitor-facing conversation is exported below instead.
    for (const collection of ["sessions", "greetings"] as const) {
      records[collection] = [];
      for await (const row of this.exportRows(collection)) {
        if (collection === "greetings" && "status" in row && row.status === "completed") {
          records[collection].push(budget.add({ ...row, aiLabel: row.mode === "external" ? "AI 生成（外部客户端声明）" : "AI 生成", metadata: aiMetadata(`${this.repo.owner.id}:${row.id}:${row.fingerprint}`, row.mode === "external") }));
        } else records[collection].push(budget.add(row));
      }
    }
    for await (const row of this.exportRows("media")) {
      try {
        const image = await this.media.read(row.id);
        // Check the base64 expansion before allocating that string.
        budget.requireRoom(4 * Math.ceil(image.bytes.length / 3));
        media.push(budget.add({ id: row.id, createdAt: row.createdAt, mimeType: image.mimeType, source: "用户上传，来源未核验，不声明由平台生成", base64: image.bytes.toString("base64") }));
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 404) throw error;
        media.push(budget.add({ id: row.id, createdAt: row.createdAt, withheld: true, notice: "图片已隔离或内容缺失；其余数据继续导出，可通过权利请求申请复核。" }));
      }
    }
    let cursor = 0;
    while (true) {
      const [row] = (await this.repo.payload.find({ collection: "credentials", overrideAccess: true, limit: 1, sort: "id", depth: 0, select: { id: true, kind: true, expiresAt: true, createdAt: true }, where: { and: [{ owner: { equals: this.repo.owner.id } }, { id: { greater_than: cursor } }] } })).docs;
      if (!row) break;
      const { kind, expiresAt, createdAt } = row;
      credentials.push(budget.add({ kind, expiresAt, createdAt }));
      cursor = row.id;
    }
    cursor = 0;
    while (true) {
      const [row] = (await this.repo.payload.find({ collection: "safety-cases", overrideAccess: true, limit: 1, sort: "id", depth: 0, select: { id: true, receipt: true, source: true, category: true, status: true, createdAt: true, reply: true, feedbackAt: true, retainUntil: true, retentionBasis: true }, where: { and: [{ owner: { equals: this.repo.owner.id } }, { id: { greater_than: cursor } }] } })).docs;
      if (!row) break;
      const { receipt, source, category, status, createdAt, reply, feedbackAt, retainUntil, retentionBasis } = row;
      safetyCases.push(budget.add({ receipt, source, category, status, createdAt, reply: feedbackAt ? reply : undefined, retainUntil, retentionBasis }));
      cursor = row.id;
    }
    budget.verify(result);
    return result;
  }
  async deleteData() {
    return withCredentialLock(this.repo.owner.id, () => this.eraseData());
  }
  private async eraseData() {
    let profile = await profileFor(this.repo.payload, this.repo.owner.id);
    if (profile?.state !== "deleting" && profile?.state !== "deleted") {
      await this.save({ state: "deleting" }, "delete-requested", profile);
      profile = await profileFor(this.repo.payload, this.repo.owner.id);
    }
    await this.revoke("bearer");
    // Existing requests may finish their network operation but their later writes
    // are denied by collection hooks. Keep references until all leases finish.
    const active = await this.repo.list("session-locks", { expiresAt: { greater_than: new Date().toISOString() } }, 1);
    if (active.length) throw new AppError(409, "已停止新处理，正在等待本轮结束；请稍后再次点击删除");
    await writeDeletionLedger(this.repo.owner.id);
    const operations = await eraseOperationsEvidence(this.repo.payload, this.repo.owner.id);
    await this.media.deleteAll();
    for (const collection of contentCollections) {
      const result = await this.repo.payload.delete({ collection, overrideAccess: true, where: { owner: { equals: this.repo.owner.id } } });
      if (result.errors.length) throw new AppError(503, "部分数据尚未删除，请稍后重试");
    }
    // Credential cleanup must succeed before committing the terminal state.
    await this.revoke();
    // Replays preserve an existing deleted tombstone while clearing leftovers.
    await updateProfile(this.repo.payload, profile!, { state: "deleted", deletedAt: profile!.deletedAt || new Date().toISOString(), consent: null, events: null, recoveryDigest: null, sensitiveHistory: null, historyInspected: null, expiresAt: null });
    return { deleted: true, operations, backupNotice: privacyPolicy().documents[0].paragraphs[7] };
  }
}
export async function withRecoveredOwner<T>(payload: Payload, code: unknown, issue: (owner: string) => Promise<T>): Promise<T> {
  const value = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(code);
  const lookup = async () => {
    const rows = await payload.find({ collection: "privacy-profiles", overrideAccess: true, limit: 1, where: { and: [{ recoveryDigest: { equals: digest(value) } }, { state: { in: ["active", "withdrawn"] } }] } });
    if (!rows.docs[0]) throw new AppError(401, "恢复码无效或对应数据正在删除、已删除");
    return String(rows.docs[0].owner);
  };
  const owner = await lookup();
  return withCredentialLock(owner, async () => {
    // Recheck after acquiring the owner gate: deletion or code rotation may
    // have completed while the first lookup was in flight.
    if (await lookup() !== owner) throw new AppError(401, "恢复码已变更，请重新确认");
    await revokeCredentials(payload, owner);
    return issue(owner);
  });
}
export async function recoverOwner(payload: Payload, code: unknown): Promise<string> {
  return withRecoveredOwner(payload, code, async (owner) => owner);
}
export function privacyService(payload: Payload, owner: Owner) { return new PrivacyService(new Repository(payload, owner)); }
