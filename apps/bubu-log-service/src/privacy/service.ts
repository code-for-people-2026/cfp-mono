import type { DeletionLedger } from "./deletion-ledger";
import { randomUUID } from "node:crypto";
import type { PayloadRequest } from "payload";
import { z } from "zod";
import { AppError, type Permission } from "../contracts";
import type { ActorScope, IdentityService, Principal } from "../identity";
import { PrivacyRepository } from "./persistence";
import { privacyPolicy, type PrivacyConfig } from "./policy";

const choices = z.object({ policyVersion: z.string().min(1).max(100), accepted: z.literal(true), adultCaregiver: z.literal(true), sensitive: z.literal(true), ai: z.boolean(), images: z.boolean() }).strict();
const guardianChoices = z.object({ policyVersion: z.string().min(1).max(100), guardian: z.literal(true), sensitive: z.literal(true), ai: z.boolean(), images: z.boolean(), collection: z.boolean(), groupMembersInformed: z.boolean() }).strict();
export type Consent = z.infer<typeof choices> & { identityId: string; updatedAt: string; revokedAt?: string };
export type GuardianConsent = z.infer<typeof guardianChoices> & { identityId: string; babyId: string; updatedAt: string; revokedAt?: string };
export interface PrivacyRequest { id: string; identityId: string; babyId?: string; kind: "privacy" | "complaint" | "appeal"; message: string; createdAt: string; status: "open" | "reviewing" | "resolved"; reply?: string; updatedAt: string }
const fail = (code: string, message: string, status = 403): never => { throw new AppError(status, code, message); };

/** Privacy choices supplement identity authorization; they never grant access to a baby. */
export class PrivacyService {
  readonly repository: PrivacyRepository;
  constructor(readonly identity: IdentityService, readonly config: PrivacyConfig, readonly ledger?: DeletionLedger) { this.repository = new PrivacyRepository(identity.store.payload, () => identity.store.currentRequest()); }
  policy() { return privacyPolicy(this.config); }
  async contextAllowed(identityId: string) { try { await this.requirePerson(identityId); return true; } catch { return false; } }
  checkLoginNotice(version?: string) { this.ready(version || ""); }
  async createFamily(principal: Principal, name: string, input: unknown) {
    const parsed = guardianChoices.parse(input); this.ready(parsed.policyVersion);
    await this.requirePerson(principal.subjectId);
    if (parsed.collection && !parsed.groupMembersInformed) fail("GROUP_NOTICE_REQUIRED", "请先取得群成员的必要同意。");
    // Record an explicit guardian declaration before even the nickname is sent upstream.
    await this.identity.exclusive(() => this.repository.put("privacy-state", `new-family:${principal.subjectId}`, { ...parsed, updatedAt: this.now() }, { identityId: principal.subjectId }));
    const result = await this.identity.createFamily(principal, name);
    if (!result.context.baby) fail("FAMILY_UNCONFIRMED", "宝宝创建结果尚未确认，请保留原操作重试。", 503);
    await this.guardian(principal, result.context.baby!.id, parsed);
    return result;
  }
  private current(value: { policyVersion: string; revokedAt?: string } | undefined) { return !!value && !value.revokedAt && value.policyVersion === this.policy().version; }
  /** Storage migration is not model processing, but may never restore a frozen family's data. */
  async requireLegacyAccount(userId: string) {
    if (this.ledger?.legacyAccountFrozen(userId)) fail("LEGACY_ACCOUNT_DELETED", "这个旧账号已申请注销，不能恢复原家庭权限。可以用微信重新开始，或联系隐私渠道。", 403);
  }
  async requireLegacyStorage(babyId: string) {
    if (this.ledger?.frozen("family", babyId) || await this.repository.get("privacy-state", `frozen-baby:${babyId}`)) fail("PRIVACY_PROCESSING_FROZEN", "宝宝数据已申请删除，不能重新导入或读取历史照片。");
  }
  private guardianCurrent(value: GuardianConsent | undefined) { return this.current(value) && !this.ledger?.frozen("account", value!.identityId); }
  private now() { return new Date(this.identity.now()).toISOString(); }
  private ready(version?: string) {
    const policy = this.policy();
    if (!policy.ready) fail("PRIVACY_NOT_READY", "隐私处理说明尚未配置完整，暂时不能开启数据处理。", 503);
    if (version !== undefined && version !== policy.version) fail("PRIVACY_VERSION_CHANGED", "隐私说明已更新，请重新阅读后选择。", 409);
  }
  async status(principal: Principal, babyId?: string) {
    await this.identity.privacyIdentity(principal);
    if (babyId) await this.identity.authorizeForPrivacy(principal, babyId, "records:read");
    const consent = await this.repository.get<Consent>("privacy-state", `consent:${principal.subjectId}`);
    const guardian = babyId ? await this.repository.get<GuardianConsent>("privacy-state", `guardian:${babyId}`) : undefined;
    const ownIds = await this.identity.accountIdentityIds(principal.subjectId);
    return { policy: this.policy(), consent: consent ? { ...consent, identityId: undefined } : null,
      consentCurrent: this.current(consent), guardian: guardian ? { ...guardian, identityId: undefined, isOwn: ownIds.includes(guardian.identityId), replaceable: !!this.ledger?.frozen("account", guardian.identityId) } : null,
      guardianCurrent: this.guardianCurrent(guardian), canManage: babyId ? await this.canManage(principal, babyId) : false };
  }
  private async canManage(principal: Principal, babyId: string) { try { await this.identity.authorizeForPrivacy(principal, babyId, "baby:manage"); return true; } catch { return false; } }
  async consent(principal: Principal, input: unknown) {
    const parsed = choices.parse(input); this.ready(parsed.policyVersion);
    await this.identity.privacyIdentity(principal);
    return this.identity.exclusive(async () => {
      if (this.ledger?.frozen("account", principal.subjectId)) fail("PRIVACY_PROCESSING_FROZEN", "账号已申请注销，不能重新开启处理。");
      const value: Consent = { ...parsed, identityId: principal.subjectId, updatedAt: this.now() };
      await this.repository.put("privacy-state", `consent:${principal.subjectId}`, value, { identityId: principal.subjectId });
      await this.revokeDelegations(principal.subjectId);
      return { updatedAt: value.updatedAt };
    });
  }
  async guardian(principal: Principal, babyId: string, input: unknown) {
    const parsed = guardianChoices.parse(input); this.ready(parsed.policyVersion);
    await this.requirePerson(principal.subjectId);
    if (parsed.collection && !parsed.groupMembersInformed) fail("GROUP_NOTICE_REQUIRED", "请先向群成员说明采集范围并取得必要同意。");
    return this.identity.exclusive(async () => {
      await this.requirePerson(principal.subjectId);
      await this.identity.authorizeForPrivacy(principal, babyId, "baby:manage");
      if (this.ledger?.frozen("family", babyId)) fail("PRIVACY_PROCESSING_FROZEN", "宝宝数据已申请删除，不能重新开启处理。");
      const old = await this.repository.get<GuardianConsent>("privacy-state", `guardian:${babyId}`);
      if (old && !(await this.identity.accountIdentityIds(principal.subjectId)).includes(old.identityId) && !this.ledger?.frozen("account", old.identityId)) fail("GUARDIAN_CHANGE_REQUIRES_REVIEW", "此宝宝已有监护授权，请由原监护人或运营核实后处理。");
      const value: GuardianConsent = { ...parsed, babyId, identityId: principal.subjectId, updatedAt: this.now() };
      await this.repository.put("privacy-state", `guardian:${babyId}`, value, { babyId });
      await this.revokeDelegations(undefined, babyId);
      return { updatedAt: value.updatedAt };
    });
  }
  async withdraw(principal: Principal, babyId?: string) {
    await this.identity.privacyIdentity(principal);
    return this.identity.exclusive(async () => {
      const key = babyId ? `guardian:${babyId}` : `consent:${principal.subjectId}`;
      const previous = await this.repository.get<Consent | GuardianConsent>("privacy-state", key);
      if (babyId) {
        await this.identity.authorizeForPrivacy(principal, babyId, "baby:manage");
        if (!previous || !(await this.identity.accountIdentityIds(principal.subjectId)).includes(previous.identityId)) fail("GUARDIAN_REQUIRED", "请由此宝宝的授权监护人撤回。");
      }
      if (previous) await this.repository.put("privacy-state", key, { ...previous, revokedAt: this.now() }, babyId ? { babyId } : { identityId: principal.subjectId });
      await this.revokeDelegations(babyId ? undefined : principal.subjectId, babyId);
      return { withdrawn: true };
    });
  }
  private async revokeDelegations(identityId?: string, babyId?: string) {
    const sessions = await this.identity.store.list("sessions");
    const own = new Set(sessions.filter(row => row.value.subjectId === identityId).map(row => row.key));
    for (const row of sessions) if (row.value.kind !== "caregiver" && (babyId ? row.value.babyId === babyId : own.has(String(row.value.parentSessionId)))) await this.identity.store.put("sessions", row.key, { ...row.value, revoked: true });
  }
  async requireIdentityChange(identityId: string) {
    if (this.ledger?.frozen("account", identityId)) fail("PRIVACY_PROCESSING_FROZEN", "账号已申请注销，不能关联或创建新的家庭数据。");
    const consent = await this.repository.get<Consent>("privacy-state", `consent:${identityId}`);
    if (consent?.revokedAt) fail("PRIVACY_CONSENT_REQUIRED", "账号已撤回授权，请先重新确认处理选择。");
  }
  async requirePerson(identityId: string) {
    if (this.ledger?.frozen("account", identityId)) fail("PRIVACY_PROCESSING_FROZEN", "账号已申请注销，已暂停处理。");
    this.ready();
    const consent = await this.repository.get<Consent>("privacy-state", `consent:${identityId}`);
    if (!this.current(consent)) fail("PRIVACY_CONSENT_REQUIRED", "请先阅读隐私说明并确认处理选择。");
    return consent!;
  }
  async guard(scope: ActorScope, permission: Permission, req?: PayloadRequest) {
    if (this.ledger?.frozen("family", scope.babyId) || this.ledger?.frozen("account", scope.actor.onBehalfOf || scope.actor.id)) fail("PRIVACY_PROCESSING_FROZEN", "数据已申请删除，已暂停访问与写入。");
    if (await this.repository.get("privacy-state", `frozen-baby:${scope.babyId}`, req) || await this.repository.get("privacy-state", `frozen-identity:${scope.actor.onBehalfOf || scope.actor.id}`, req)) fail("PRIVACY_PROCESSING_FROZEN", "数据正在删除或处理隐私请求，已暂停访问与写入。");
    this.ready();
    const guardian = await this.repository.get<GuardianConsent>("privacy-state", `guardian:${scope.babyId}`, req);
    if (!this.guardianCurrent(guardian)) fail("GUARDIAN_CONSENT_REQUIRED", "请先由宝宝的监护人确认儿童信息处理授权。");
    const agentImageRead = permission === "media:read" && (scope.actor.kind === "collector" || scope.actor.kind === "chat-agent" && scope.actor.purpose !== "history");
    if ((permission === "media:write" || agentImageRead) && !guardian!.images) fail("IMAGE_CONSENT_REQUIRED", "监护人尚未开启此宝宝的图片处理。");
    if (scope.actor.kind === "operator") return;
    if (scope.actor.kind === "collector") {
      if (!guardian!.collection || !guardian!.groupMembersInformed || !guardian!.ai) fail("COLLECTION_CONSENT_REQUIRED", "监护人尚未开通此宝宝的群采集授权。");
    } else {
      const person = await this.requirePerson(scope.actor.onBehalfOf || scope.actor.id);
      if (scope.actor.kind === "chat-agent" && scope.actor.purpose !== "history" && (!person.ai || !guardian!.ai)) fail("AI_CONSENT_REQUIRED", "请由本人和监护人分别开启 AI 整理授权。");
      if ((permission === "media:write" || agentImageRead) && !person.images) fail("IMAGE_CONSENT_REQUIRED", "请在隐私设置中单独开启图片处理。");
    }
  }
  async requireModel(principal: Principal, babyId: string, images: boolean) {
    const scope = await this.identity.authorize(principal, babyId, "records:write");
    await this.guard(scope, "records:write");
    const person = await this.requirePerson(principal.subjectId), guardian = await this.repository.get<GuardianConsent>("privacy-state", `guardian:${babyId}`);
    if (!person.ai || !guardian?.ai) fail("AI_CONSENT_REQUIRED", "请由本人和监护人分别开启 AI 整理授权。");
    if (images && (!person.images || !guardian?.images)) fail("IMAGE_CONSENT_REQUIRED", "照片发送给 AI 前需要单独的图片处理授权。");
  }
  async request(principal: Principal, input: unknown) {
    await this.identity.privacyIdentity(principal);
    const parsed = z.object({ kind: z.enum(["privacy", "complaint", "appeal"]), message: z.string().trim().min(1).max(2000), babyId: z.string().min(1).max(200).optional() }).strict().parse(input);
    if (parsed.babyId) await this.identity.authorizeForPrivacy(principal, parsed.babyId, "records:read");
    return this.identity.exclusive(async () => {
      const open = await this.repository.list<PrivacyRequest>("privacy-requests", { identityId: { equals: principal.subjectId } });
      if (open.filter(row => row.value.status !== "resolved").length >= 10) fail("PRIVACY_REQUEST_LIMIT", "已有待处理请求，请在原请求中查询进度或联系隐私邮箱。", 429);
      const id = randomUUID();
      const value: PrivacyRequest = { id, identityId: principal.subjectId, ...parsed, createdAt: this.now(), updatedAt: this.now(), status: "open" };
      await this.repository.put("privacy-requests", id, value, { identityId: principal.subjectId, babyId: parsed.babyId });
      return { id, status: value.status, createdAt: value.createdAt };
    });
  }
  async requests(principal: Principal) {
    await this.identity.privacyIdentity(principal);
    return (await this.repository.list<PrivacyRequest>("privacy-requests", { identityId: { equals: principal.subjectId } })).map(row => ({ ...row.value, identityId: undefined }));
  }
}
