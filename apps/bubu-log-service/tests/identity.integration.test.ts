import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { digest, type Principal } from "../src/identity";
import { identityFixture, type IdentityFixture } from "./fixtures/identity";

let fixture: IdentityFixture;
beforeAll(async () => { fixture = await identityFixture(); }, 30_000);
afterAll(async () => { await fixture?.close(); });
const login = async (who: string) => {
  const result = await fixture.service.loginWechat(`app:${who}:one-use-code`);
  return { ...result, principal: await fixture.service.authenticate(result.token, "native") };
};
const operator = async (babyId = "baby-a") => {
  const result = await fixture.service.provisionOperator("operator-1", babyId, 60_000);
  return fixture.service.authenticate(result.token, "service");
};
const forbidden = { status: 403, code: "BABY_FORBIDDEN" };
const unauthorized = { status: 401, code: "UNAUTHORIZED" };

describe("durable identity and session lifecycle", () => {
  it("exchanges each wx.login code and scopes stable identities by app ID", async () => {
    const first = await login("stable");
    const again = await fixture.service.loginWechat("app:stable:fresh-code");
    const otherApp = await fixture.service.loginWechat("other-app:stable:another-code");
    expect(again.context.identityId).toBe(first.context.identityId);
    expect(again.token).not.toBe(first.token);
    expect(otherApp.context.identityId).not.toBe(first.context.identityId);
    expect(first.context).toMatchObject({ authenticated: true, legacyLinked: false, hasBaby: false, baby: null, babies: [] });
    expect(fixture.wechat.exchanges).toContain("app:stable:fresh-code");
    await expect(fixture.service.loginWechat("invalid-code")).rejects.toMatchObject({ status: 401 });
  });

  it("persists only session hashes and restores real SQLite state after service restart", async () => {
    const account = await login("restart");
    const family = await fixture.service.createFamily(account.principal, "重启宝宝");
    expect((await fixture.store.get("sessions", digest(account.token)))?.key).toBe(digest(account.token));
    const persisted = JSON.stringify(await fixture.store.list("sessions"));
    expect(persisted).not.toContain(account.token);
    await fixture.restart();
    const restored = await fixture.service.authenticate(account.token, "native");
    expect((await fixture.service.context(restored)).baby).toEqual(family.context.baby);
    const relogin = await fixture.service.loginWechat("app:restart:after-restart");
    expect(relogin.context.identityId).toBe(account.context.identityId);
    await fixture.service.logout(restored);
    await fixture.restart();
    await expect(fixture.service.authenticate(account.token)).rejects.toMatchObject(unauthorized);
    await expect(fixture.service.authenticate(relogin.token)).resolves.toMatchObject({ subjectId: account.context.identityId });
  });

  it("rejects malformed, expired and wrong-channel credentials and old principal reuse", async () => {
    const account = await login("expiry");
    await expect(fixture.service.authenticate(account.token, "browser")).rejects.toMatchObject(unauthorized);
    await expect(fixture.service.authenticate("guessed-user-id")).rejects.toMatchObject(unauthorized);
    fixture.advance(60_000);
    await expect(fixture.service.authenticate(account.token)).rejects.toMatchObject(unauthorized);
    await expect(fixture.service.context(account.principal)).rejects.toMatchObject(unauthorized);
    const fresh = await login("expiry");
    expect(fresh.context.identityId).toBe(account.context.identityId);
  });
});

describe("legacy proof and canonical account binding", () => {
  it("never binds a nickname or failed old password, and keeps secrets out of persistence", async () => {
    const account = await login("bad-binding");
    await expect(fixture.service.bindLegacy(account.principal, "old-alice", "wrong-password")).rejects.toMatchObject({ status: 401 });
    await expect(fixture.service.bindLegacy(account.principal, "小一", "correct-password")).rejects.toMatchObject({ status: 401 });
    expect(await fixture.service.context(account.principal)).toMatchObject({ legacyLinked: false, hasBaby: false });
    expect(await fixture.store.get("identities", "legacy:old-alice")).toBeUndefined();
    for (const table of ["identities", "sessions", "audit"] as const) {
      const text = JSON.stringify(await fixture.store.list(table));
      expect(text).not.toContain("correct-password");
      expect(text).not.toContain("wrong-password");
    }
  });

  it("merges wx into the established H5 identity only after proof, rotating the wx session", async () => {
    const browser = await fixture.service.loginLegacy("old-alice", "correct-password", "browser");
    const account = await login("binding");
    const bound = await fixture.service.bindLegacy(account.principal, "old-alice", "correct-password");
    expect(bound.context).toMatchObject({ identityId: browser.context.identityId, legacyLinked: true, baby: { id: "baby-a" } });
    await expect(fixture.service.authenticate(account.token)).rejects.toMatchObject(unauthorized);
    const native = await fixture.service.authenticate(bound.token, "native");
    await expect(fixture.service.authorize(native, "baby-a", "records:read")).resolves.toMatchObject({ actor: { kind: "caregiver", id: browser.context.identityId }, babyId: "baby-a" });
    await expect(fixture.service.authenticate(browser.token, "browser")).resolves.toMatchObject({ subjectId: browser.context.identityId });
    const subsequent = await fixture.service.loginWechat("app:binding:subsequent-code");
    expect(subsequent.context.identityId).toBe(browser.context.identityId);
    await expect(fixture.service.bindLegacy(native, "old-bob", "correct-password")).rejects.toMatchObject({ status: 409, code: "ALREADY_LINKED" });
    expect((await fixture.service.context(native)).baby?.id).toBe("baby-a");
  });

  it("allows H5 login after a wx-first binding without changing the canonical identity", async () => {
    const account = await login("wx-first");
    const bound = await fixture.service.bindLegacy(account.principal, "old-bob", "correct-password");
    const browser = await fixture.service.loginLegacy("old-bob", "correct-password", "browser");
    expect(browser.context.identityId).toBe(bound.context.identityId);
    expect(browser.context.baby?.id).toBe("baby-b");
  });

  it("rolls back old-session revocation and wx mapping if a binding transaction fails", async () => {
    const browser = await fixture.service.loginLegacy("old-alice", "correct-password", "browser");
    const account = await login("bind-rollback");
    const originalPut = fixture.store.put.bind(fixture.store);
    const spy = vi.spyOn(fixture.store, "put").mockImplementation(async (table, key, value) => {
      if (table === "audit" && value.action === "legacy.bind") throw new Error("Injected audit storage failure");
      return originalPut(table, key, value);
    });
    try { await expect(fixture.service.bindLegacy(account.principal, "old-alice", "correct-password")).rejects.toThrow("Injected audit storage failure"); }
    finally { spy.mockRestore(); }
    await expect(fixture.service.authenticate(account.token)).resolves.toMatchObject({ subjectId: account.context.identityId });
    expect((await fixture.service.context(account.principal)).legacyLinked).toBe(false);
    const freshLogin = await fixture.service.loginWechat("app:bind-rollback:after-failure");
    expect(freshLogin.context.identityId).toBe(account.context.identityId);
    const retried = await fixture.service.bindLegacy(account.principal, "old-alice", "correct-password");
    expect(retried.context.identityId).toBe(browser.context.identityId);
    await expect(fixture.service.authenticate(account.token)).rejects.toMatchObject(unauthorized);
    await expect(fixture.service.authenticate(freshLogin.token)).rejects.toMatchObject(unauthorized);
  });

  it("rechecks authoritative BabyUser and user existence for every operation", async () => {
    const result = await fixture.service.loginLegacy("old-alice", "correct-password", "native");
    const principal = await fixture.service.authenticate(result.token);
    await expect(fixture.service.authorize(principal, "baby-a", "records:read")).resolves.toBeDefined();
    fixture.legacy.memberships.set("old-alice", []);
    await expect(fixture.service.authorize(principal, "baby-a", "records:read")).rejects.toMatchObject(forbidden);
    expect((await fixture.service.context(principal)).hasBaby).toBe(false);
    fixture.legacy.memberships.set("old-alice", ["baby-a"]);
    await expect(fixture.service.authorize(principal, "baby-a", "records:read")).resolves.toBeDefined();
    fixture.legacy.users.delete("old-alice");
    await expect(fixture.service.authorize(principal, "baby-a", "records:read")).rejects.toMatchObject(forbidden);
    fixture.legacy.users.add("old-alice");
    await expect(fixture.service.authorize(principal, "baby-b", "records:read")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.context(principal, "baby-b")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(principal, "baby-a", "caregivers:manage")).rejects.toMatchObject(forbidden);
  });
});

describe("new families and caregiver grants", () => {
  it("creates a usable family without old credentials and retries an upstream committed response loss idempotently", async () => {
    const account = await login("new-family");
    fixture.legacy.failFamilyOnce = true;
    await expect(fixture.service.createFamily(account.principal, "初始昵称")).rejects.toMatchObject({ status: 502 });
    const created = await fixture.service.createFamily(account.principal, "重试不能覆盖");
    const replay = await fixture.service.createFamily(account.principal, "再次重试");
    expect(created.context).toEqual(replay.context);
    expect(created.context.baby?.name).toBe("初始昵称");
    expect(fixture.legacy.families.get(account.context.identityId)?.baby.id).toBe(created.context.baby?.id);
    expect(fixture.legacy.familyCalls.filter(call => call.identityId === account.context.identityId)).toHaveLength(2);
    await expect(fixture.service.authorize(account.principal, created.context.baby!.id, "caregivers:manage")).resolves.toBeDefined();
    const userId = fixture.legacy.families.get(account.context.identityId)!.userId;
    fixture.legacy.memberships.set(userId, []);
    await expect(fixture.service.authorize(account.principal, created.context.baby!.id, "records:write")).rejects.toMatchObject(forbidden);
  });

  it("never replays completed provisioning to recreate a legacy membership removed by an administrator", async () => {
    const owner = await login("family-revoked-retry");
    const family = await fixture.service.createFamily(owner.principal, "不可重建撤销关系");
    const babyId = family.context.baby!.id;
    const upstream = fixture.legacy.families.get(owner.context.identityId)!;
    fixture.legacy.memberships.set(upstream.userId, []);
    await expect(fixture.service.authorize(owner.principal, babyId, "records:write")).rejects.toMatchObject(forbidden);
    const originalCreate = fixture.legacy.createFamily.bind(fixture.legacy);
    // HttpLegacyBackend.ensure creates a missing stable BabyUser ID. Completed
    // provisioning must never call that repair path after deliberate removal.
    const retry = vi.spyOn(fixture.legacy, "createFamily").mockImplementation(async (identityId, input) => {
      const result = await originalCreate(identityId, input);
      fixture.legacy.memberships.set(result.userId, [result.baby.id]);
      return result;
    });
    try {
      await fixture.service.createFamily(owner.principal, "重复提交").catch(() => undefined);
      expect(retry).not.toHaveBeenCalled();
      await expect(fixture.service.authorize(owner.principal, babyId, "records:write")).rejects.toMatchObject(forbidden);
    } finally { retry.mockRestore(); }
  });

  it("serializes concurrent family creation through the completed journal before repeating any remote provisioning", async () => {
    const owner = await login("family-concurrent");
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const originalCreate = fixture.legacy.createFamily.bind(fixture.legacy);
    const spy = vi.spyOn(fixture.legacy, "createFamily").mockImplementation(async (identityId, input) => {
      started!();
      await gate;
      return originalCreate(identityId, input);
    });
    try {
      const first = fixture.service.createFamily(owner.principal, "首次昵称");
      const second = fixture.service.createFamily(owner.principal, "并发昵称");
      await entered;
      expect(spy).toHaveBeenCalledTimes(1);
      release!();
      const results = await Promise.all([first, second]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]!.context.baby?.name).toBe("首次昵称");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { release!(); spy.mockRestore(); }
  });

  it("consumes an invite once under concurrent acceptance, enforces read scope and immediately revokes", async () => {
    const owner = await login("invite-owner");
    const created = await fixture.service.createFamily(owner.principal, "邀请宝宝");
    const babyId = created.context.baby!.id;
    const first = await login("invite-first");
    const second = await login("invite-second");
    const invite = await fixture.service.invite(owner.principal, babyId, "read");
    const results = await Promise.allSettled([fixture.service.acceptInvite(first.principal, invite.code), fixture.service.acceptInvite(second.principal, invite.code)]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    await expect(fixture.service.authorize(first.principal, babyId, "records:read")).resolves.toBeDefined();
    await expect(fixture.service.authorize(first.principal, babyId, "records:write")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(first.principal, babyId, "caregivers:manage")).rejects.toMatchObject(forbidden);
    expect((await fixture.service.acceptInvite(first.principal, invite.code)).context.baby?.id).toBe(babyId);
    await fixture.service.setGrant(owner.principal, babyId, first.context.identityId, "revoked");
    await expect(fixture.service.authorize(first.principal, babyId, "records:read")).rejects.toMatchObject(forbidden);
    expect((await fixture.service.context(first.principal)).hasBaby).toBe(false);
    expect((await fixture.service.acceptInvite(first.principal, invite.code)).context.hasBaby).toBe(false);
    await expect(fixture.service.authorize(first.principal, babyId, "records:read")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.setGrant(owner.principal, babyId, second.context.identityId, "active", ["records:read"])).rejects.toMatchObject({ status: 403, code: "INVITE_REQUIRED" });
  });

  it("rolls back invitation consumption when the grant write fails, then accepts a safe retry", async () => {
    const owner = await login("atomic-invite-owner");
    const family = await fixture.service.createFamily(owner.principal, "原子邀请");
    const babyId = family.context.baby!.id;
    const guest = await login("atomic-invite-guest");
    const invite = await fixture.service.invite(owner.principal, babyId, "write");
    const originalPut = fixture.store.put.bind(fixture.store);
    const spy = vi.spyOn(fixture.store, "put").mockImplementation(async (table, key, value) => {
      if (table === "grants" && key === `${guest.context.identityId}:${babyId}`) throw new Error("Injected grant storage failure");
      return originalPut(table, key, value);
    });
    try { await expect(fixture.service.acceptInvite(guest.principal, invite.code)).rejects.toThrow("Injected grant storage failure"); }
    finally { spy.mockRestore(); }
    expect((await fixture.store.get("invitations", digest(invite.code)))?.value.state).toBe("pending");
    expect(await fixture.store.get("grants", `${guest.context.identityId}:${babyId}`)).toBeUndefined();
    expect((await fixture.service.acceptInvite(guest.principal, invite.code)).context.baby?.id).toBe(babyId);
    await expect(fixture.service.authorize(guest.principal, babyId, "records:write")).resolves.toBeDefined();
  });

  it("supplies an authorized actor and shared Payload transaction to downstream writes", async () => {
    const owner = await login("atomic-tool-owner");
    const family = await fixture.service.createFamily(owner.principal, "原子工具");
    const babyId = family.context.baby!.id;
    await expect(fixture.service.executeAuthorized(owner.principal, babyId, "records:write", async (scope, req) => {
      expect(req.transactionID).toBeTruthy();
      expect(scope).toMatchObject({ babyId, actor: { kind: "caregiver", id: owner.context.identityId } });
      await fixture.store.put("audit", "downstream-rollback", { action: "tool.write", actorId: scope.actor.id });
      throw new Error("downstream mutation failed");
    })).rejects.toThrow("downstream mutation failed");
    expect(await fixture.store.get("audit", "downstream-rollback")).toBeUndefined();
    const mutation = vi.fn(async () => "not-reached");
    await expect(fixture.service.executeAuthorized(owner.principal, "baby-b", "records:write", mutation)).rejects.toMatchObject(forbidden);
    expect(mutation).not.toHaveBeenCalled();
    await expect(fixture.service.executeAuthorized(owner.principal, babyId, "records:write", async (scope) => {
      await fixture.store.put("audit", "downstream-commit", { action: "tool.write", actorId: scope.actor.id });
      return "committed";
    })).resolves.toBe("committed");
    expect((await fixture.store.get("audit", "downstream-commit"))?.value.actorId).toBe(owner.context.identityId);
  });

  it("rejects expired invitations and invitations whose issuer lost access or logged out", async () => {
    const owner = await login("invalid-invite-owner");
    const family = await fixture.service.createFamily(owner.principal, "邀请失效宝宝");
    const babyId = family.context.baby!.id;
    const guest = await login("invalid-invite-guest");
    const expired = await fixture.service.invite(owner.principal, babyId, "write", 1);
    fixture.advance(1);
    await expect(fixture.service.acceptInvite(guest.principal, expired.code)).rejects.toMatchObject({ status: 410 });
    const revoked = await fixture.service.invite(owner.principal, babyId, "write");
    const userId = fixture.legacy.families.get(owner.context.identityId)!.userId;
    fixture.legacy.memberships.set(userId, []);
    await expect(fixture.service.acceptInvite(guest.principal, revoked.code)).rejects.toMatchObject(forbidden);
    fixture.legacy.memberships.set(userId, [babyId]);
    await fixture.service.logout(owner.principal);
    await expect(fixture.service.acceptInvite(guest.principal, revoked.code)).rejects.toMatchObject(unauthorized);
  });

  it("does not let an invitation replace authoritative existing BabyUser membership with a permanent sidecar grant", async () => {
    fixture.legacy.users.add("old-invited");
    fixture.legacy.memberships.set("old-invited", ["baby-a"]);
    const session = await fixture.service.loginLegacy("old-invited", "correct-password", "native");
    const principal = await fixture.service.authenticate(session.token);
    const op = await operator();
    const invite = await fixture.service.invite(op, "baby-a", "write");
    await fixture.service.acceptInvite(principal, invite.code);
    fixture.legacy.memberships.set("old-invited", []);
    await expect(fixture.service.authorize(principal, "baby-a", "records:read")).rejects.toMatchObject(forbidden);
  });

  it("does not allow an invitation issued before revocation to silently restore the revoked caregiver", async () => {
    const owner = await login("pre-revoke-owner");
    const family = await fixture.service.createFamily(owner.principal, "撤权后旧邀请无效");
    const babyId = family.context.baby!.id;
    const guest = await login("pre-revoke-guest");
    const first = await fixture.service.invite(owner.principal, babyId, "write");
    const outstanding = await fixture.service.invite(owner.principal, babyId, "write");
    await fixture.service.acceptInvite(guest.principal, first.code);
    fixture.advance(1);
    await fixture.service.setGrant(owner.principal, babyId, guest.context.identityId, "revoked");
    await expect(fixture.service.acceptInvite(guest.principal, outstanding.code)).rejects.toMatchObject({ status: 410 });
    await expect(fixture.service.authorize(guest.principal, babyId, "records:read")).rejects.toMatchObject(forbidden);
    fixture.advance(1);
    const explicitlyRenewed = await fixture.service.invite(owner.principal, babyId, "write");
    await fixture.service.acceptInvite(guest.principal, explicitlyRenewed.code);
    await expect(fixture.service.authorize(guest.principal, babyId, "records:read")).resolves.toBeDefined();
  });
});

describe("trusted agent and operator boundaries", () => {
  it("allows explicit operator grants for a different baby without inventing an absent legacy membership", async () => {
    fixture.legacy.users.add("old-operator-grantee");
    fixture.legacy.memberships.set("old-operator-grantee", ["baby-a"]);
    const session = await fixture.service.loginLegacy("old-operator-grantee", "correct-password", "native");
    const grantee = await fixture.service.authenticate(session.token);
    const op = await operator("baby-b");
    await fixture.service.setGrant(op, "baby-b", session.context.identityId, "active", ["records:read"]);
    await expect(fixture.service.authorize(grantee, "baby-b", "records:read")).resolves.toMatchObject({ babyId: "baby-b" });
    await expect(fixture.service.authorize(grantee, "baby-b", "records:write")).rejects.toMatchObject(forbidden);
    expect(fixture.legacy.memberships.get("old-operator-grantee")).toEqual(["baby-a"]);
    await fixture.service.setGrant(op, "baby-b", session.context.identityId, "revoked");
    await expect(fixture.service.authorize(grantee, "baby-b", "records:read")).rejects.toMatchObject(forbidden);
  });

  it("confines chat delegation to its parent baby, permissions and live parent session", async () => {
    const account = await fixture.service.loginLegacy("old-alice", "correct-password", "native");
    const parent = await fixture.service.authenticate(account.token);
    const issued = await fixture.service.issueAgent(parent, "baby-a", "chat-agent");
    const chat = await fixture.service.authenticate(issued.token, "service");
    expect(await fixture.service.authorize(chat, "baby-a", "records:write")).toMatchObject({ actor: { kind: "chat-agent", id: "bubu-chat", onBehalfOf: parent.subjectId } });
    await expect(fixture.service.authorize(chat, "baby-b", "records:write")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(chat, "baby-a", "baby:manage")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(chat, "baby-a", "records:read", "group-a")).rejects.toMatchObject(forbidden);
    fixture.legacy.memberships.set("old-alice", []);
    await expect(fixture.service.authorize(chat, "baby-a", "records:write")).rejects.toMatchObject(forbidden);
    fixture.legacy.memberships.set("old-alice", ["baby-a"]);
    await fixture.service.logout(parent);
    await expect(fixture.service.authorize(chat, "baby-a", "records:read")).rejects.toMatchObject(unauthorized);
  });

  it("allows collector only in a matching active stored group binding and preserves its own actor", async () => {
    const op = await operator();
    await fixture.service.bindGroup(op, "baby-a", "group-a", "collector-1", true);
    const result = await fixture.service.issueAgent(op, "baby-a", "collector", { groupId: "group-a", agentId: "collector-1" });
    const collector = await fixture.service.authenticate(result.token, "service");
    expect(await fixture.service.authorize(collector, "baby-a", "records:write", "group-a")).toMatchObject({ actor: { kind: "collector", id: "collector-1" }, babyId: "baby-a", groupId: "group-a" });
    expect((await fixture.service.authorize(collector, "baby-a", "records:read", "group-a")).actor).not.toHaveProperty("onBehalfOf");
    await expect(fixture.service.authorize(collector, "baby-b", "records:read", "group-a")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(collector, "baby-a", "records:read", "group-b")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(collector, "baby-a", "records:read")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(collector, "baby-a", "caregivers:manage", "group-a")).rejects.toMatchObject(forbidden);
    await fixture.service.bindGroup(op, "baby-a", "group-a", "collector-1", false);
    await expect(fixture.service.authorize(collector, "baby-a", "records:write", "group-a")).rejects.toMatchObject(forbidden);
    await fixture.service.bindGroup(op, "baby-a", "group-a", "collector-2", true);
    await expect(fixture.service.authorize(collector, "baby-a", "records:write", "group-a")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.issueAgent(op, "baby-a", "collector", { groupId: "group-a", agentId: "collector-1" })).rejects.toMatchObject(forbidden);
    const otherOp = await operator("baby-b");
    await expect(fixture.service.bindGroup(otherOp, "baby-b", "group-a", "collector-2", true)).rejects.toMatchObject({ status: 409, code: "GROUP_BOUND" });
  });

  it("does not let a caregiver manufacture an operator by changing the passed principal kind", async () => {
    const owner = await login("forged-operator");
    const family = await fixture.service.createFamily(owner.principal, "不能冒充运营");
    const babyId = family.context.baby!.id;
    const forged: Principal = { ...owner.principal, kind: "operator" };
    await expect(fixture.service.bindGroup(forged, babyId, "forged-group", "collector-rogue", true)).rejects.toMatchObject(forbidden);
    const guest = await login("forged-guest");
    await expect(fixture.service.setGrant(forged, babyId, guest.context.identityId, "active", ["records:read"])).rejects.toMatchObject(forbidden);
  });

  it("keeps operator scope, expiry and audit identity separate from a caregiver", async () => {
    const op = await operator();
    expect(await fixture.service.authorize(op, "baby-a", "caregivers:manage")).toMatchObject({ actor: { kind: "operator", id: "operator-1" } });
    await expect(fixture.service.context(op)).rejects.toMatchObject(forbidden);
    await expect(fixture.service.authorize(op, "baby-b", "records:read")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.issueAgent(op, "baby-a", "chat-agent")).rejects.toMatchObject(forbidden);
    await expect(fixture.service.provisionOperator("", "baby-a", 60_000)).rejects.toMatchObject({ status: 400 });
    await expect(fixture.service.provisionOperator("operator", "missing", 60_000)).rejects.toMatchObject({ status: 400 });
    await expect(fixture.service.provisionOperator("operator", "baby-a", 86400_001)).rejects.toMatchObject({ status: 400 });
    const audit = await fixture.store.list("audit");
    expect(audit.some(row => row.value.action === "operator.provision" && row.value.actorId === "operator-1")).toBe(true);
    fixture.advance(60_000);
    await expect(fixture.service.authorize(op, "baby-a", "records:read")).rejects.toMatchObject(unauthorized);
  });
});
