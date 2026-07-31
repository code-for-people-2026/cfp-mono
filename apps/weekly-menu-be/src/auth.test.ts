import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  SessionService,
  createWechatCodeExchanger,
  type SessionStore
} from "./auth";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function fakeStore(): SessionStore {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    findActiveSession: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn().mockResolvedValue(true),
    upsertWechatIdentity: vi.fn().mockResolvedValue({
      id: "existing-owner",
      wechatOpenId: "openid-sensitive"
    })
  };
}

describe("createWechatCodeExchanger", () => {
  it("uses the official code exchange and returns only openid", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({ openid: "openid-sensitive", session_key: "never-return-this" })
    );
    const exchanger = createWechatCodeExchanger({
      appId: "appid-sensitive",
      appSecret: "secret-sensitive",
      fetcher
    });

    await expect(exchanger.exchange("code-sensitive")).resolves.toEqual({
      openId: "openid-sensitive"
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe(
      "https://api.weixin.qq.com/sns/jscode2session"
    );
    expect(url.searchParams.get("grant_type")).toBe("authorization_code");
  });

  it.each([
    response({ errcode: 40029, errmsg: "invalid code" }),
    response({ openid: "" }),
    response({ internal: "secret details" }, 503)
  ])("maps every upstream failure to one safe error", async (upstream) => {
    const exchanger = createWechatCodeExchanger({
      appId: "appid-sensitive",
      appSecret: "secret-sensitive",
      fetcher: async () => upstream
    });
    await expect(exchanger.exchange("code-sensitive")).rejects.toEqual(
      new AuthenticationError("WECHAT_LOGIN_FAILED")
    );
  });
});

describe("SessionService", () => {
  it("stores only a SHA-256 token hash and reuses the persisted identity", async () => {
    const store = fakeStore();
    const token = "a".repeat(43);
    const service = new SessionService(
      store,
      { exchange: vi.fn().mockResolvedValue({ openId: "openid-sensitive" }) },
      () => new Date("2026-08-01T00:00:00Z"),
      vi.fn().mockReturnValueOnce("new-owner-candidate").mockReturnValueOnce("session-1"),
      () => token
    );

    await expect(service.login("code-sensitive")).resolves.toEqual({
      token,
      expiresAt: "2026-08-31T00:00:00.000Z"
    });
    expect(store.upsertWechatIdentity).toHaveBeenCalledWith({
      id: "new-owner-candidate",
      wechatOpenId: "openid-sensitive"
    });
    expect(store.createSession).toHaveBeenCalledWith({
      id: "session-1",
      identityId: "existing-owner",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: "2026-08-31T00:00:00.000Z"
    });
    expect(JSON.stringify(vi.mocked(store.createSession).mock.calls)).not.toContain(token);
  });

  it("accepts only an active opaque token and revokes its own session", async () => {
    const store = fakeStore();
    const token = "b".repeat(43);
    const active = {
      id: "session-1",
      identityId: "owner-1",
      expiresAt: "2026-09-01T00:00:00.000Z"
    };
    vi.mocked(store.findActiveSession).mockResolvedValue(active);
    const now = new Date("2026-08-01T00:00:00Z");
    const service = new SessionService(
      store,
      { exchange: vi.fn() },
      () => now
    );

    await expect(service.authenticate(token)).resolves.toEqual(active);
    expect(store.findActiveSession).toHaveBeenCalledWith(
      createHash("sha256").update(token).digest("hex"),
      now
    );
    await service.revoke(active);
    expect(store.revokeSession).toHaveBeenCalledWith("owner-1", "session-1", now);
  });

  it("rejects malformed, expired and already-revoked sessions uniformly", async () => {
    const store = fakeStore();
    const service = new SessionService(store, { exchange: vi.fn() });
    await expect(service.authenticate("not-a-token")).rejects.toMatchObject({
      code: "INVALID_TOKEN"
    });
    await expect(service.authenticate("c".repeat(43))).rejects.toMatchObject({
      code: "INVALID_TOKEN"
    });
    vi.mocked(store.revokeSession).mockResolvedValue(false);
    await expect(
      service.revoke({
        id: "revoked",
        identityId: "owner-1",
        expiresAt: "2026-09-01T00:00:00.000Z"
      })
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });
});
