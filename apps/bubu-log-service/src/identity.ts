import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError, permissions, type ActorKind, type Baby, type LegacyBackend, type Permission, type WechatProvider } from "./contracts";
import { Store } from "./store";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
const forbidden = () => fail(403, "BABY_FORBIDDEN", "没有此宝宝的访问权限，请刷新宝宝列表。");
const unauthorized = () => fail(401, "UNAUTHORIZED", "登录已失效，请重新登录。");
interface Identity { id: string; legacyUserId?: string; currentBabyId?: string; mergedIdentityIds?: string[]; mergedInto?: string }
export interface Principal {
  kind: ActorKind; subjectId: string; sessionId: string;
  babyId?: string; groupId?: string; bindingId?: string; parentSessionId?: string;
  permissions: Permission[]; expiresAt: string;
  /** Present only on credentials delegated by an authenticated Payload operator. */
  operatorUserId?: string;
  /** Internal history delegation, never accepted from an HTTP request. */
  purpose?: "history";
}
interface Session extends Principal { revoked?: boolean; channel: "native" | "browser" | "service" }
interface Grant { subjectId: string; babyId: string; state: "active" | "revoked"; permissions: Permission[]; source: "legacy" | "managed" }
/** @public Authorized actor and baby scope passed to downstream recording services. */
export interface ActorScope {
  actor: { kind: ActorKind; id: string; sessionId: string; onBehalfOf?: string; purpose?: "history" };
  babyId: string; groupId?: string; permissions: Permission[];
}
export class IdentityService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly familyRuns = new Map<string, Promise<unknown>>();
  private readonly executing = new AsyncLocalStorage<boolean>();
  private processingGuard?: (scope: ActorScope, permission: Permission) => Promise<void>;
  private operatorGuard?: (userId: string, babyId: string, permission: Permission) => Promise<void>;
  private serviceGuard?: (babyId: string, capability: "chat" | "collection", req?: import("payload").PayloadRequest) => Promise<void>;
  constructor(readonly store: Store, readonly legacy: LegacyBackend, readonly wechat: WechatProvider,
    readonly now: () => number = Date.now, readonly sessionTtlMs = 7 * 86400_000) {}
  /** One process owns the SQLite sidecar. All state transitions use this queue. */
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.executing.getStore()) return this.store.transaction(action);
    const run = () => this.executing.run(true, () => this.store.transaction(action));
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private legacyAccountGuard?: (userId: string) => Promise<void>;
  setLegacyAccountGuard(guard: (userId: string) => Promise<void>) { this.legacyAccountGuard = guard; }
  private accountChangeGuard?: (identityId: string) => Promise<void>;
  setAccountChangeGuard(guard: (identityId: string) => Promise<void>) { this.accountChangeGuard = guard; }
  private contextGuard?: (identityId: string) => Promise<boolean>;
  setContextGuard(guard: (identityId: string) => Promise<boolean>) { this.contextGuard = guard; }
  setProcessingGuard(guard: (scope: ActorScope, permission: Permission) => Promise<void>) { this.processingGuard = guard; }
  async privacyIdentity(principal: Principal) { return this.caregiver(principal); }
  /** Proof-backed aliases survive snapshot restoration through the deletion ledger. */
  async accountIdentityIds(identityId: string): Promise<string[]> {
    const row = await this.store.get("identities", `subject:${identityId}`);
    const aliases = Array.isArray(row?.value.mergedIdentityIds) ? row.value.mergedIdentityIds.filter((id): id is string => typeof id === "string") : [];
    return [...new Set([identityId, ...aliases])].sort();
  }
  /** Resolve only server-proven mappings, including aliases; callers cannot supply deletion targets. */
  async accountLegacyUserIds(identityId: string): Promise<string[]> {
    const ids = await this.accountIdentityIds(identityId), result = new Set<string>();
    for (const row of await this.store.list("identities")) {
      if (row.key.startsWith("legacy:") && ids.includes(String(row.value.subjectId))) result.add(row.key.slice(7));
      if (ids.some(id => row.key === `subject:${id}`) && typeof row.value.legacyUserId === "string") result.add(row.value.legacyUserId);
      const provisioningId = ids.find(id => row.key === `family:${id}`);
      if (provisioningId) {
        if (row.value.state === "completed" && typeof row.value.legacyUserId === "string") result.add(row.value.legacyUserId);
        else {
          // A failed response does not prove that the upstream write failed. Recover by exact ownership,
          // without creating data or deleting an unrelated account at a colliding stable ID.
          const recovered = await this.legacy.findFamilyAccount(provisioningId);
          if (!recovered) fail(409, "FAMILY_PROVISIONING_UNRESOLVED", "家庭创建尚未核实完成，请重试创建或联系运营核对后再注销或导出。");
          result.add(recovered!.id);
        }
      }
    }
    return [...result].sort();
  }
  /** Data rights check existing ownership without requiring renewed consent. Never grants new access. */
  async authorizeForPrivacy(principal: Principal, babyId: string, permission: Permission) {
    if (principal.kind !== "caregiver") return forbidden();
    return this.authorizeScope(principal, babyId, permission, undefined, false);
  }
  /** Installed by the composition root, never selected by a request or model. */
  setOperatorGuard(guard: (userId: string, babyId: string, permission: Permission) => Promise<void>) { this.operatorGuard = guard; }
  /** Installed once by the shared runtime. Service eligibility never replaces baby authorization. */
  setServiceGuard(guard: (babyId: string, capability: "chat" | "collection", req?: import("payload").PayloadRequest) => Promise<void>) { this.serviceGuard = guard; }
  async assertService(babyId: string, capability: "chat" | "collection", req?: import("payload").PayloadRequest) {
    await this.serviceGuard?.(babyId, capability, req);
  }
  /** Record and attachment effects share one actor-to-capability rule. Authorization remains the caller's first step. */
  async assertRecordingService(principal: Principal, babyId: string, req?: import("payload").PayloadRequest) {
    await this.assertService(babyId, principal.kind === "collector" ? "collection" : "chat", req);
  }
  private async audit(action: string, actorId: string, target: Record<string, unknown>) {
    await this.store.put("audit", randomUUID(), { action, actorId, ...target, at: new Date(this.now()).toISOString() });
  }
  private async identity(id: string): Promise<Identity> {
    const row = await this.store.get("identities", `subject:${id}`);
    if (!row) return unauthorized();
    return row.value as unknown as Identity;
  }
  private async saveIdentity(value: Identity) { await this.store.put("identities", `subject:${value.id}`, { ...value }); }
  private async resolve(key: string): Promise<Identity> {
    const existing = await this.store.get("identities", key);
    if (existing) return this.identity(String(existing.value.subjectId));
    const identity = { id: randomUUID() };
    await this.saveIdentity(identity);
    await this.store.put("identities", key, { subjectId: identity.id });
    return identity;
  }
  private async mint(subjectId: string, channel: Session["channel"], props: Partial<Session> = {}) {
    const token = secret();
    const sessionId = digest(token);
    const session: Session = { kind: "caregiver", subjectId, sessionId, channel, permissions: [],
      expiresAt: new Date(this.now() + this.sessionTtlMs).toISOString(), ...props };
    await this.store.put("sessions", sessionId, { ...session });
    return { token, expiresAt: session.expiresAt };
  }
  async authenticate(token: string, channel?: Session["channel"] | "bearer"): Promise<Principal> {
    if (!/^[\w-]{43}$/.test(token)) return unauthorized();
    const session = await this.sessionById(digest(token), channel === "bearer" ? undefined : channel);
    if (channel === "bearer" && session.channel === "browser") return unauthorized();
    return session;
  }
  private async sessionById(sessionId: string, channel?: Session["channel"]): Promise<Session> {
    const row = await this.store.get("sessions", sessionId);
    if (!row) return unauthorized();
    const session = row.value as unknown as Session;
    if (session.revoked || Date.parse(session.expiresAt) <= this.now() || (channel && channel !== session.channel)) return unauthorized();
    if (session.kind === "caregiver") await this.identity(session.subjectId);
    return session;
  }
  async loginWechat(code: string) {
    const verified = await this.wechat.exchange(code);
    return this.exclusive(async () => {
      const identity = await this.resolve(`wx:${digest(`${verified.appId}:${verified.openId}`)}`);
      return { ...await this.mint(identity.id, "native"), context: await this.contextFor(identity) };
    });
  }
  async loginLegacy(username: string, password: string, channel: "native" | "browser") {
    const user = await this.legacy.verifyCredentials(username, password);
    return this.exclusive(async () => {
      await this.legacyAccountGuard?.(user.id);
      const identity = await this.resolve(`legacy:${user.id}`);
      identity.legacyUserId = user.id;
      await this.saveIdentity(identity);
      return { ...await this.mint(identity.id, channel), context: await this.contextFor(identity) };
    });
  }
  private async fresh(principal: Principal): Promise<Session> {
    const current = await this.sessionById(principal.sessionId);
    if (current.subjectId !== principal.subjectId || current.kind !== principal.kind) return forbidden();
    return current;
  }
  private async caregiver(principal: Principal): Promise<Identity> {
    const current = await this.fresh(principal);
    if (current.subjectId !== principal.subjectId || current.kind !== "caregiver") return forbidden();
    return this.identity(current.subjectId);
  }
  async bindLegacy(principal: Principal, username: string, password: string) {
    await this.caregiver(principal);
    return this.exclusive(async () => {
      const identity = await this.caregiver(principal);
      await this.accountChangeGuard?.(identity.id);
      const user = await this.legacy.verifyCredentials(username, password);
      await this.legacyAccountGuard?.(user.id);
      if (identity.legacyUserId && identity.legacyUserId !== user.id) fail(409, "ALREADY_LINKED", "此微信已关联其他旧账号，请联系运营核对。");
      const mapping = await this.store.get("identities", `legacy:${user.id}`);
      const target = mapping ? await this.identity(String(mapping.value.subjectId)) : identity;
      await this.accountChangeGuard?.(target.id);
      // Proof of both identities permits merging an unlinked WeChat identity into the canonical legacy account.
      // Session revocation, grants and mappings commit in the same sidecar transaction.
      if (identity.id !== target.id) {
        const targetAccess = await this.access(target);
        target.mergedIdentityIds = [...new Set([...(target.mergedIdentityIds || []), ...await this.accountIdentityIds(identity.id)])].filter(id => id !== target.id).sort();
        await this.saveIdentity({ ...identity, mergedInto: target.id });
        for (const row of await this.store.list("sessions")) if (row.value.subjectId === identity.id) await this.store.put("sessions", row.key, { ...row.value, revoked: true });
        for (const row of await this.store.list("grants")) if (row.value.subjectId === identity.id) {
          const key = `${target.id}:${String(row.value.babyId)}`;
          const previous = await this.store.get("grants", key);
          if (!previous) await this.store.put("grants", key, { ...row.value, subjectId: target.id, permissions: [...new Set([...(targetAccess.grants.get(String(row.value.babyId)) || []), ...(row.value.permissions as Permission[])])] });
          await this.store.put("grants", row.key, { ...row.value, state: "revoked" });
        }
        for (const row of await this.store.list("identities")) if (row.key.startsWith("wx:") && row.value.subjectId === identity.id) await this.store.put("identities", row.key, { subjectId: target.id });
      }
      target.legacyUserId = user.id;
      await this.saveIdentity(target);
      await this.store.put("identities", `legacy:${user.id}`, { subjectId: target.id });
      const session = await this.store.get("sessions", principal.sessionId);
      if (session) await this.store.put("sessions", session.key, { ...session.value, revoked: true });
      await this.audit("legacy.bind", target.id, { legacyUserId: user.id });
      return { ...await this.mint(target.id, (session?.value.channel as "native" | "browser") || "native"), context: await this.contextFor(target) };
    });
  }
  async createFamily(principal: Principal, name: string) {
    const previous = this.familyRuns.get(principal.subjectId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.provisionFamily(principal, name));
    this.familyRuns.set(principal.subjectId, run);
    try { return await run; }
    finally { if (this.familyRuns.get(principal.subjectId) === run) this.familyRuns.delete(principal.subjectId); }
  }
  private async provisionFamily(principal: Principal, name: string) {
    const pending = await this.exclusive(async () => {
      const identity = await this.caregiver(principal);
      await this.accountChangeGuard?.(identity.id);
      if (!name.trim() || name.trim().length > 30) fail(400, "INVALID_NAME", "请输入 1 到 30 字的宝宝昵称。");
      const key = `family:${identity.id}`;
      const provisioning = await this.store.get("identities", key);
      if (identity.legacyUserId && !provisioning) fail(409, "ALREADY_LINKED", "已有账号请通过运营添加宝宝。");
      if (provisioning?.value.state === "completed") return { identityId: identity.id, name: String(provisioning.value.name), completed: true };
      const requestedName = String(provisioning?.value.name || name.trim());
      await this.store.put("identities", key, { name: requestedName });
      return { identityId: identity.id, name: requestedName, completed: false };
    });
    if (pending.completed) return { context: await this.context(principal) };
    // A durable journal + stable legacy IDs bridge two databases. This is not a distributed transaction.
    return this.exclusive(async () => {
      const identity = await this.caregiver(principal);
      await this.accountChangeGuard?.(pending.identityId);
      if (identity.id !== pending.identityId || identity.legacyUserId) fail(409, "IDENTITY_CHANGED", "身份已变化，请重新登录后核对。");
      const result = await this.legacy.createFamily(pending.identityId, { name: pending.name });
      if (identity.id !== pending.identityId || (identity.legacyUserId && identity.legacyUserId !== result.userId)) fail(409, "IDENTITY_CHANGED", "身份已变化，请重新登录后核对。");
      identity.legacyUserId = result.userId;
      identity.currentBabyId = result.baby.id;
      await this.saveIdentity(identity);
      await this.store.put("identities", `legacy:${result.userId}`, { subjectId: identity.id });
      const grantKey = `${identity.id}:${result.baby.id}`;
      if (!await this.store.get("grants", grantKey)) await this.store.put("grants", grantKey, { subjectId: identity.id, babyId: result.baby.id, state: "active", source: "legacy", permissions });
      await this.store.put("identities", `family:${identity.id}`, { name: pending.name, state: "completed", legacyUserId: result.userId, babyId: result.baby.id });
      await this.audit("family.create", identity.id, { babyId: result.baby.id });
      return { context: await this.contextFor(identity) };
    });
  }
  private async access(identity: Identity): Promise<{ babies: Baby[]; grants: Map<string, Permission[]> }> {
    const inherited = identity.legacyUserId ? (await this.legacy.userExists(identity.legacyUserId) ? await this.legacy.listBabies(identity.legacyUserId) : []) : [];
    const babies = new Map(inherited.map(baby => [baby.id, { ...baby, avatarUrl: null }]));
    const grants = new Map<string, Permission[]>(inherited.map(baby => [baby.id, permissions.filter(p => p !== "caregivers:manage")]));
    for (const row of await this.store.list("grants")) {
      const grant = row.value as unknown as Grant;
      if (grant.subjectId !== identity.id) continue;
      if (grant.state !== "active" || (grant.source === "legacy" && !babies.has(grant.babyId))) {
        babies.delete(grant.babyId); grants.delete(grant.babyId); continue;
      }
      const baby = babies.get(grant.babyId) || await this.legacy.getBaby(grant.babyId);
      if (baby) { babies.set(grant.babyId, { ...baby, avatarUrl: null }); grants.set(grant.babyId, grant.permissions); }
    }
    return { babies: [...babies.values()].filter(baby => grants.get(baby.id)?.includes("records:read")), grants };
  }
  private async contextFor(identity: Identity, requestedBabyId?: string) {
    if (this.contextGuard && !await this.contextGuard(identity.id)) return { authenticated: true, hasBaby: false, baby: null, babies: [] as Baby[], defaultBabyId: null, identityId: identity.id, legacyLinked: !!identity.legacyUserId };
    const { babies } = await this.access(identity);
    if (requestedBabyId && !babies.some(baby => baby.id === requestedBabyId)) return forbidden();
    const baby = babies.find(baby => baby.id === (requestedBabyId || identity.currentBabyId)) || babies.find(baby => baby.isDefault) || babies[0] || null;
    if (identity.currentBabyId !== baby?.id) { identity.currentBabyId = baby?.id; await this.saveIdentity(identity); }
    return { authenticated: true, hasBaby: !!baby, baby, babies, defaultBabyId: baby?.id || null,
      identityId: identity.id, legacyLinked: !!identity.legacyUserId };
  }
  async context(principal: Principal, requestedBabyId?: string) { return this.exclusive(async () => this.contextFor(await this.caregiver(principal), requestedBabyId)); }
  /** Authorize each tool/HTTP operation, not just connection setup. Resource babyId must come from the stored resource. */
  async authorize(principal: Principal, babyId: string, permission: Permission, groupId?: string): Promise<ActorScope> {
    return this.authorizeScope(principal, babyId, permission, groupId, true);
  }
  private async authorizeScope(principal: Principal, babyId: string, permission: Permission, groupId: string | undefined, process: boolean): Promise<ActorScope> {
    const current = await this.fresh(principal);
    if (current.subjectId !== principal.subjectId || !babyId) return forbidden();
    let allowed: Permission[];
    let onBehalfOf: string | undefined;
    if (current.kind === "caregiver") {
      const identity = await this.identity(current.subjectId);
      allowed = (await this.access(identity)).grants.get(babyId) || [];
      if (groupId) return forbidden();
    } else {
      if (current.babyId !== babyId) return forbidden();
      allowed = current.permissions;
      if (current.kind === "chat-agent") {
        if (!current.parentSessionId || groupId) return forbidden();
        const parent = await this.sessionById(current.parentSessionId);
        if (parent.kind !== "caregiver") return forbidden();
        await this.authorize(parent, babyId, permission);
        onBehalfOf = parent.subjectId;
      } else if (current.kind === "collector") {
        const binding = current.bindingId && await this.store.get("group-bindings", current.bindingId);
        if (!binding || binding.value.active !== true || binding.value.babyId !== babyId || binding.value.groupId !== groupId || binding.value.agentId !== current.subjectId) return forbidden();
      } else {
        if (groupId) return forbidden();
        if (current.operatorUserId) {
          if (!this.operatorGuard) return forbidden();
          await this.operatorGuard(current.operatorUserId, babyId, permission);
        }
      }
    }
    if (!allowed.includes(permission)) return forbidden();
    const scope: ActorScope = { actor: { kind: current.kind, id: current.subjectId, sessionId: current.sessionId, ...(onBehalfOf ? { onBehalfOf } : {}), ...(current.purpose ? { purpose: current.purpose } : {}) }, babyId, ...(groupId ? { groupId } : {}), permissions: allowed };
    if (process) await this.processingGuard?.(scope, permission);
    return scope;
  }
  async executeAuthorized<T>(principal: Principal, babyId: string, permission: Permission,
    action: (scope: ActorScope, req: import("payload").PayloadRequest) => Promise<T>, groupId?: string): Promise<T> {
    return this.exclusive(async () => {
      const scope = await this.authorize(principal, babyId, permission, groupId);
      return this.store.transaction(req => action(scope, req));
    });
  }
  async logout(principal: Principal) {
    return this.exclusive(async () => {
      const current = await this.fresh(principal);
      await this.store.put("sessions", current.sessionId, { ...current, revoked: true });
    });
  }
  async invite(principal: Principal, babyId: string, access: "read" | "write", ttlMs = 86400_000) {
    return this.exclusive(async () => {
      await this.authorize(principal, babyId, "caregivers:manage");
      const code = secret();
      const granted = permissions.filter(p => access === "read" ? p === "records:read" || p === "media:read" : !p.endsWith(":manage"));
      const expiresAt = new Date(this.now() + Math.min(ttlMs, 7 * 86400_000)).toISOString();
      await this.store.put("invitations", digest(code), { babyId, permissions: granted, createdBy: principal.subjectId, issuerSessionId: principal.sessionId, expiresAt, state: "pending" });
      await this.audit("caregiver.invite", principal.subjectId, { babyId, permissions: granted });
      return { code, expiresAt };
    });
  }
  async acceptInvite(principal: Principal, code: string) {
    return this.exclusive(async () => {
      const identity = await this.caregiver(principal);
      const row = await this.store.get("invitations", digest(code));
      if (row?.value.state === "accepted" && row.value.acceptedBy === identity.id) return { context: await this.contextFor(identity) };
      if (!row || row.value.state !== "pending" || Date.parse(String(row.value.expiresAt)) <= this.now()) fail(410, "INVITE_EXPIRED", "邀请已失效，请联系宝宝管理者重新邀请。");
      const invitation = row!.value;
      const issuer = await this.sessionById(String(invitation.issuerSessionId));
      await this.authorize(issuer, String(invitation.babyId), "caregivers:manage");
      // Invitation consumption, grant and audit commit atomically in the sidecar transaction.
      await this.store.put("invitations", row!.key, { ...invitation, state: "accepted", acceptedBy: identity.id });
      const key = `${identity.id}:${String(invitation.babyId)}`;
      const previous = await this.store.get("grants", key);
      const inheritsLegacy = identity.legacyUserId && (await this.legacy.listBabies(identity.legacyUserId)).some(baby => baby.id === invitation.babyId);
      if (!previous || previous.value.state !== "active") await this.store.put("grants", key, { subjectId: identity.id, babyId: invitation.babyId, state: "active", source: previous?.value.source === "legacy" || inheritsLegacy ? "legacy" : "managed", permissions: invitation.permissions });
      await this.audit("caregiver.accept", identity.id, { babyId: invitation.babyId });
      return { context: await this.contextFor(identity) };
    });
  }
  async setGrant(principal: Principal, babyId: string, subjectId: string, state: "active" | "revoked", granted: Permission[] = []) {
    return this.exclusive(async () => {
      await this.authorize(principal, babyId, "caregivers:manage");
      await this.identity(subjectId);
      if (subjectId === principal.subjectId) fail(409, "SELF_GRANT", "不能修改自己的管理权限。");
      if (state === "active" && (await this.fresh(principal)).kind !== "operator") fail(403, "INVITE_REQUIRED", "请通过邀请授予照护权限。");
      const previous = await this.store.get("grants", `${subjectId}:${babyId}`);
      const target = await this.identity(subjectId);
      const inheritsLegacy = target.legacyUserId && (await this.legacy.listBabies(target.legacyUserId)).some(baby => baby.id === babyId);
      await this.store.put("grants", `${subjectId}:${babyId}`, { subjectId, babyId, state, source: previous?.value.source || (inheritsLegacy ? "legacy" : "managed"), permissions: granted });
      if (state === "revoked") {
        // Invitations are bearer proofs until accepted, so revoke outstanding invitations for this baby too.
        for (const invitation of await this.store.list("invitations")) if (invitation.value.babyId === babyId && invitation.value.state === "pending")
          await this.store.put("invitations", invitation.key, { ...invitation.value, state: "revoked" });
      }
      await this.audit(`caregiver.${state}`, principal.subjectId, { babyId, subjectId, permissions: granted });
      return {};
    });
  }
  /** Local CLI provisioning only. No HTTP endpoint can mint an operator. */
  async provisionOperator(operatorId: string, babyId: string, ttlMs: number, authority?: { userId: string; permissions: Permission[] }) {
    return this.exclusive(async () => {
    if (!operatorId.trim() || !await this.legacy.getBaby(babyId) || ttlMs <= 0 || ttlMs > 86400_000) fail(400, "INVALID_OPERATOR", "运营身份、宝宝和不超过一天的期限必填。");
    if (authority) {
      if (!this.operatorGuard) return forbidden();
      for (const permission of authority.permissions) await this.operatorGuard(authority.userId, babyId, permission);
    }
    const issued = await this.mint(operatorId, "service", { kind: "operator", babyId, permissions: authority?.permissions || permissions,
      ...(authority ? { operatorUserId: authority.userId } : {}), expiresAt: new Date(this.now() + ttlMs).toISOString() });
    await this.audit("operator.provision", operatorId, { babyId });
    return issued;
    });
  }
  async bindGroup(principal: Principal, babyId: string, groupId: string, agentId: string, active: boolean) {
    return this.exclusive(async () => {
      if ((await this.fresh(principal)).kind !== "operator") return forbidden();
      await this.authorize(principal, babyId, "caregivers:manage");
      const key = digest(groupId);
      const existing = await this.store.get("group-bindings", key);
      if (existing && existing.value.babyId !== babyId) fail(409, "GROUP_BOUND", "此群已绑定其他宝宝。");
      await this.store.put("group-bindings", key, { babyId, groupId, agentId, active });
      await this.audit("group.bind", principal.subjectId, { babyId, groupId, active });
      return { bindingId: key };
    });
  }
  async issueAgent(principal: Principal, babyId: string, kind: "collector" | "chat-agent", options: { groupId?: string; agentId?: string; readOnly?: boolean } = {}) {
    return this.exclusive(async () => {
      const readOnly = kind === "chat-agent" && options.readOnly === true;
      await this.authorize(principal, babyId, readOnly ? "records:read" : "records:write");
      const granted = permissions.filter(p => readOnly ? p === "records:read" || p === "media:read" : !p.endsWith(":manage"));
      if (kind === "chat-agent") {
        await this.caregiver(principal);
        await this.processingGuard?.({ actor: { kind, id: "bubu-chat", sessionId: principal.sessionId, onBehalfOf: principal.subjectId, ...(readOnly ? { purpose: "history" as const } : {}) }, babyId, permissions: granted }, readOnly ? "records:read" : "records:write");
        return this.mint("bubu-chat", "service", { kind, babyId, parentSessionId: principal.sessionId, permissions: granted, ...(readOnly ? { purpose: "history" as const } : {}),
          expiresAt: new Date(Math.min(Date.parse(principal.expiresAt), this.now() + 15 * 60000)).toISOString() });
      }
      if ((await this.fresh(principal)).kind !== "operator" || !options.groupId) return forbidden();
      const bindingId = digest(options.groupId);
      const binding = await this.store.get("group-bindings", bindingId);
      if (!binding || binding.value.active !== true || binding.value.babyId !== babyId || binding.value.agentId !== options.agentId) return forbidden();
      const issued = await this.mint(String(binding.value.agentId), "service", { kind, babyId, groupId: options.groupId, bindingId, permissions: granted,
        expiresAt: new Date(this.now() + 3600_000).toISOString() });
      await this.audit("agent.issue", principal.subjectId, { babyId, kind, agentId: binding.value.agentId });
      return issued;
    });
  }
}
