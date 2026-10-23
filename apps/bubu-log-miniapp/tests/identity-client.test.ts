import { describe, expect, it, vi } from "vitest";
import { createBubuApi, type ClientOptions, type Transport, type TransportRequest, type TransportResponse } from "../src/api/client";
import { ResponseFormatError } from "../src/api/contracts";
import { IdentitySession } from "../src/api/identity-session";
import type { SessionStorage } from "../src/api/session";
import type { AuthContext } from "../src/model";

const now = Date.parse("2026-10-23T01:00:00Z");
const expiresAt = "2026-10-24T01:00:00Z";
const baby = { id: "baby-1", name: "小满" };
const unbound = { authenticated: true, identityId: "identity-1", legacyLinked: false, hasBaby: false, baby: null, babies: [], defaultBabyId: null };
const context = { ...unbound, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id };
const exchange = (value: AuthContext = context, token = "identity-token") => ({ token, expiresAt, context: value });
const response = (data: unknown, status = 200): TransportResponse => ({ status, data });
function memory() {
  const values = new Map<string, unknown>();
  const storage: SessionStorage = { get: (key) => values.get(key), set: (key, value) => values.set(key, value), remove: (key) => { values.delete(key); } };
  return { storage, values };
}
function fixture(transport: Transport, options: Partial<ClientOptions> = {}) {
  const saved = memory();
  const client = createBubuApi({ native: true, origin: "https://identity.example.test", authMode: "sidecar", transport,
    storage: saved.storage, now: () => now, wechatLogin: async () => "real-platform-code", ...options });
  return { client, ...saved };
}

describe("independent identity sessions", () => {
  it("exchanges the platform code and restores only an origin-scoped Bearer token", async () => {
    const requests: TransportRequest[] = [];
    const transport: Transport = async (request) => {
      requests.push(request);
      expect(request.headers.Cookie).toBeUndefined();
      expect(request.headers["X-Bubu-Client"]).toBe("native");
      if (request.url.endsWith("/wechat")) {
        expect(JSON.parse(request.body!)).toEqual({ code: "real-platform-code" });
        return response(exchange());
      }
      expect(request.headers.Authorization).toBe("Bearer identity-token");
      return response(context);
    };
    const setup = fixture(transport);
    expect(await setup.client.loginWithWechat()).toMatchObject(context);
    expect([...setup.values.keys()]).toEqual(["bubu-identity:https://identity.example.test"]);
    expect(JSON.stringify([...setup.values])).not.toContain("real-platform-code");
    const resumed = fixture(transport, { storage: setup.storage });
    expect(await resumed.client.getContext()).toMatchObject(context);
    const other = fixture(async (request) => {
      expect(request.headers.Authorization).toBeUndefined();
      return response({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    }, { storage: setup.storage, origin: "https://other.example.test" });
    expect((await other.client.getContext()).authenticated).toBe(false);
    expect(requests.map((request) => request.url)).toEqual(["https://identity.example.test/api/identity/wechat", "https://identity.example.test/api/app/auth/context"]);
  });

  it("keeps H5 same-origin and never stores tokens or passwords from the exchange", async () => {
    const setup = fixture(async (request) => {
      expect(request.url).toBe("/api/identity/legacy-login");
      expect(request.headers["X-Bubu-Client"]).toBe("browser");
      expect(request.headers.Authorization).toBeUndefined();
      expect(request.credentials).toBe("include");
      expect(JSON.parse(request.body!)).toEqual({ username: "parent", password: "password" });
      return response(exchange());
    }, { native: false });
    expect(await setup.client.login({ username: " parent ", password: "password" })).toMatchObject(context);
    expect(setup.values.size).toBe(0);
    await expect(setup.client.loginWithWechat()).rejects.toMatchObject({ status: 400 });
  });

  it("rejects invalid or expired persisted native credentials without sending them", () => {
    for (const stored of [{ token: "token\r\nforged", expiresAt }, { token: "token", expiresAt: "invalid" }, { token: "token", expiresAt: "2026-10-22T00:00:00Z" }, "bad"]) {
      const saved = memory();
      saved.values.set("bubu-identity:https://identity.example.test", stored);
      const session = new IdentitySession("https://identity.example.test", saved.storage, () => now);
      expect(session.header()).toBeUndefined();
      expect(saved.values.size).toBe(0);
    }
    let clock = now;
    const saved = memory();
    const session = new IdentitySession("https://identity.example.test", saved.storage, () => clock);
    session.save({ token: "token", expiresAt });
    clock = Date.parse(expiresAt);
    expect(session.header()).toBeUndefined();
    expect(saved.values.size).toBe(0);
  });

  it("does not request a server exchange when wx.login fails or returns an empty code", async () => {
    for (const wechatLogin of [async () => { throw new Error("platform failure"); }, async () => ""]) {
      const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>();
      const { client } = fixture(transport, { wechatLogin });
      await expect(client.loginWithWechat()).rejects.toMatchObject({ code: "WECHAT_LOGIN_FAILED" });
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it("clears expired sessions once and rejects concurrent late successful data", async () => {
    const resolvers: Array<(value: TransportResponse) => void> = [];
    const expired = vi.fn();
    const setup = fixture(async (request) => request.url.endsWith("/wechat") ? response(exchange())
      : new Promise((resolve) => { resolvers.push(resolve); }), { onSessionExpired: expired });
    await setup.client.loginWithWechat();
    const first = setup.client.getContext().catch((error: unknown) => error);
    const second = setup.client.getDailyStats({ babyId: baby.id, startDate: "2026-10-23", endDate: "2026-10-23" }).catch((error: unknown) => error);
    resolvers[0](response({ code: "UNAUTHORIZED" }, 401));
    expect(await first).toMatchObject({ authenticated: false });
    resolvers[1](response([]));
    expect(await second).toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(setup.values.size).toBe(0);
  });

  it("rejects revoked baby access without erasing the user's valid identity", async () => {
    const setup = fixture(async (request) => request.url.endsWith("/wechat") ? response(exchange())
      : request.url.includes("daily-stats") ? response({ code: "BABY_FORBIDDEN", error: "已撤销照护权限" }, 403) : response(unbound));
    await setup.client.loginWithWechat();
    await expect(setup.client.getDailyStats({ babyId: baby.id, startDate: "2026-10-23", endDate: "2026-10-23" })).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    expect(await setup.client.getContext()).toMatchObject(unbound);
    expect(setup.values.size).toBe(1);
  });

  it("treats only a sidecar missing daily-stat snapshot as absent while preserving scope errors", async () => {
    const absent = fixture(async () => response({ error: "暂无统计快照", code: "NOT_FOUND" }, 404));
    expect(await absent.client.getDailyStat(baby.id, "2026-10-23")).toBeNull();
    const legacy = fixture(async () => response({ code: "NOT_FOUND" }, 404), { authMode: "legacy" });
    await expect(legacy.client.getDailyStat(baby.id, "2026-10-23")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    for (const [status, code] of [[403, "BABY_FORBIDDEN"], [404, "BABY_NOT_FOUND"]] as const) {
      const denied = fixture(async () => response({ code }, status));
      await expect(denied.client.getDailyStat(baby.id, "2026-10-23")).rejects.toMatchObject({ status, code });
    }
    await expect(absent.client.getActivity(baby.id, "missing-record")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("binds only with old credentials, preserves identity on a bad password and rotates the successful token", async () => {
    let valid = false;
    const setup = fixture(async (request) => {
      if (request.url.endsWith("/wechat")) return response(exchange());
      if (request.url.endsWith("/bind-legacy")) {
        expect(request.headers.Authorization).toBe("Bearer identity-token");
        expect(JSON.parse(request.body!)).toEqual({ username: "parent", password: "old-password" });
        return valid ? response(exchange({ ...context, legacyLinked: true }, "rotated-token")) : response({ error: "原账号凭证错误", code: "LEGACY_LOGIN_FAILED" }, 401);
      }
      expect(request.headers.Authorization).toBe("Bearer rotated-token");
      return response({ ...context, legacyLinked: true });
    });
    await setup.client.loginWithWechat();
    await expect(setup.client.bindLegacy({ username: "parent", password: "old-password" })).rejects.toMatchObject({ code: "LEGACY_LOGIN_FAILED" });
    expect(JSON.stringify([...setup.values])).toContain("identity-token");
    valid = true;
    expect((await setup.client.bindLegacy({ username: "parent", password: "old-password" })).legacyLinked).toBe(true);
    await setup.client.getContext();
    expect(JSON.stringify([...setup.values])).not.toContain("old-password");
  });

  it("creates a new family from only a nickname and accepts an invitation without requiring a legacy binding", async () => {
    const setup = fixture(async (request) => {
      if (request.url.endsWith("/wechat")) return response(exchange(unbound));
      if (request.url.endsWith("/family")) expect(JSON.parse(request.body!)).toEqual({ name: "小满" });
      else {
        expect(request.url).toContain("/api/identity/invitations/accept");
        expect(JSON.parse(request.body!)).toEqual({ code: "invitation-code" });
      }
      return response({ context });
    });
    await setup.client.loginWithWechat();
    expect(await setup.client.createFamily({ name: " 小满 " })).toMatchObject(context);
    expect(await setup.client.acceptInvitation({ code: " invitation-code " })).toMatchObject({ hasBaby: true, legacyLinked: false });
  });

  it("rejects incomplete identity exchange/context responses and a foreign selected baby", async () => {
    const { client } = fixture(async () => response(exchange({ ...context, identityId: "" })));
    await expect(client.loginWithWechat()).rejects.toBeInstanceOf(ResponseFormatError);
    const missingToken = fixture(async () => response({ context, expiresAt }));
    await expect(missingToken.client.loginWithWechat()).rejects.toBeInstanceOf(ResponseFormatError);
    const foreign = fixture(async () => response(context));
    await expect(foreign.client.getContext("another-baby")).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it.each(["legacy-login", "bind-legacy"])("waits for in-flight %s before signing out and never restores its late result", async (endpoint) => {
    const requests: string[] = [];
    let resolvePending: ((value: TransportResponse) => void) | undefined;
    const setup = fixture(async (request) => {
      requests.push(request.url);
      if (request.url.endsWith(`/${endpoint}`)) return new Promise((resolve) => { resolvePending = resolve; });
      expect(request.url).toContain("/api/identity/logout");
      return response({});
    }, { native: false });
    const pending = (endpoint === "legacy-login" ? setup.client.login({ username: "parent", password: "password" }) : setup.client.bindLegacy({ username: "parent", password: "password" })).catch((error: unknown) => error);
    const logout = setup.client.logout();
    expect(requests).toHaveLength(1);
    resolvePending?.(response(exchange()));
    expect(await pending).toMatchObject({ code: "SESSION_CHANGED" });
    await logout;
    expect(requests[1]).toContain("/api/identity/logout");
    expect(setup.values.size).toBe(0);
  });

  it("invalidates an unfinished wx.login before it can exchange a platform code", async () => {
    let resolveCode: ((code: string) => void) | undefined;
    const requests: string[] = [];
    const setup = fixture(async (request) => { requests.push(request.url); return response({}); }, {
      wechatLogin: () => new Promise((resolve) => { resolveCode = resolve; }),
    });
    const pending = setup.client.loginWithWechat().catch((error: unknown) => error);
    const logout = setup.client.logout();
    resolveCode?.("old-code");
    expect(await pending).toMatchObject({ code: "SESSION_CHANGED" });
    await logout;
    expect(requests).toEqual(["https://identity.example.test/api/identity/logout"]);
  });

  it("revokes a token rotated by an in-flight native bind during logout without persisting it", async () => {
    let finishBind: ((value: TransportResponse) => void) | undefined;
    const setup = fixture(async (request) => {
      if (request.url.endsWith("/bind-legacy")) return new Promise((resolve) => { finishBind = resolve; });
      expect(request.url).toContain("/api/identity/logout");
      expect(request.headers.Authorization).toBe("Bearer rotated-during-logout");
      return response({});
    });
    const bind = setup.client.bindLegacy({ username: "parent", password: "password" }).catch((error: unknown) => error);
    const logout = setup.client.logout();
    finishBind?.(response(exchange({ ...context, legacyLinked: true }, "rotated-during-logout")));
    expect(await bind).toMatchObject({ code: "SESSION_CHANGED" });
    await logout;
    expect(setup.values.size).toBe(0);
  });

  it("downloads protected native photos with the current identity and removes them on baby changes", async () => {
    const removed: string[] = [];
    const download = vi.fn(async (request: { url: string; headers: Record<string, string> }) => {
      expect(request.url).toBe("https://identity.example.test/api/app/media/activities/photo-1?babyId=baby-1");
      expect(request.headers.Authorization).toBe("Bearer identity-token");
      expect(request.headers["x-baby-id"]).toBe(baby.id);
      return { status: 200, path: "/tmp/photo-1" };
    });
    const setup = fixture(async (request) => request.url.endsWith("/wechat") ? response(exchange()) : response(context), {
      download, removeDownloadedFile: (path) => { removed.push(path); },
    });
    await setup.client.loginWithWechat();
    expect(await setup.client.resolvePhotoUrl("/api/app/media/activities/photo-1?babyId=baby-1", baby.id)).toBe("/tmp/photo-1");
    await setup.client.getContext(baby.id);
    expect(removed).toEqual(["/tmp/photo-1"]);
    for (const url of ["https://foreign.test/photo", "/api/app/media/activities/photo-1?babyId=other", "/api/admin?babyId=baby-1"]) {
      await expect(setup.client.resolvePhotoUrl(url, baby.id)).rejects.toBeInstanceOf(ResponseFormatError);
    }
    expect(download).toHaveBeenCalledTimes(1);
  });

  it.each(["media/activities/photo-1", `attachments/att_${"a".repeat(64)}`])("discards a late native %s download after logout without exposing its local file", async route => {
    let finishDownload: ((value: { status: number; path: string }) => void) | undefined;
    const remove = vi.fn();
    const setup = fixture(async (request) => request.url.endsWith("/wechat") ? response(exchange()) : response({}), {
      download: () => new Promise((resolve) => { finishDownload = resolve; }), removeDownloadedFile: remove,
    });
    await setup.client.loginWithWechat();
    const photo = setup.client.resolvePhotoUrl(`/api/app/${route}?babyId=baby-1`, baby.id).catch((error: unknown) => error);
    await setup.client.logout();
    finishDownload?.({ status: 200, path: "/tmp/old-photo" });
    expect(await photo).toMatchObject({ code: "SESSION_CHANGED" });
    expect(remove).toHaveBeenCalledWith("/tmp/old-photo");
  });

  it("uses protected same-origin photo URLs in H5 and keeps legacy photo URLs unchanged", async () => {
    const download = vi.fn();
    const setup = fixture(async () => response(context), { native: false, download });
    const protectedUrl = "/api/app/media/activities/photo-1?babyId=baby-1";
    expect(await setup.client.resolvePhotoUrl(protectedUrl, baby.id)).toBe(protectedUrl);
    const attachmentUrl = `/api/app/attachments/att_${"a".repeat(64)}?babyId=baby-1`;
    expect(await setup.client.resolvePhotoUrl(attachmentUrl, baby.id)).toBe(attachmentUrl);
    await expect(setup.client.resolvePhotoUrl(attachmentUrl.replace("baby-1", "other"), baby.id)).rejects.toBeInstanceOf(ResponseFormatError);
    const legacy = fixture(async () => response(context), { authMode: "legacy", download });
    expect(await legacy.client.resolvePhotoUrl("https://old-blob.test/photo", baby.id)).toBe("https://old-blob.test/photo");
    expect(download).not.toHaveBeenCalled();
  });
});
