import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "../src/http";
import { identityFixture, type IdentityFixture } from "./fixtures/identity";

const origin = "https://bubu.example.test";
let fixture: IdentityFixture;
let handle: ReturnType<typeof createHandler>;
beforeAll(async () => { fixture = await identityFixture(); handle = createHandler(fixture.service, origin); }, 30_000);
afterAll(async () => { await fixture?.close(); });
function request(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers = { ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...options.headers };
  return handle(new Request(`${origin}${path}`, { method: options.method || (options.body !== undefined ? "POST" : "GET"), headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) }));
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const browser = { origin, "x-bubu-client": "browser" };
const cookieHeader = (response: Response) => response.headers.get("set-cookie")!.split(";")[0]!;
const legacyLogin = (headers: Record<string, string> = {}) => request("/api/identity/legacy-login", { body: { username: "old-alice", password: "correct-password" }, headers });
const wxLogin = async (identity: string) => {
  const response = await request("/api/identity/wechat", { body: { code: `app:${identity}:code` } });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ token: string; context: { identityId: string; baby: null; hasBaby: boolean } }>;
};
const code = async (response: Response, status: number, error: string) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code: error });
};

describe("HTTP credential and origin boundaries", () => {
  it("returns HttpOnly secure same-site browser cookies without JSON tokens and clears them at logout", async () => {
    const login = await legacyLogin(browser);
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toMatch(/bubu_session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=60; Secure/);
    expect(await login.json()).not.toHaveProperty("token");
    const cookie = cookieHeader(login);
    const context = await request("/api/app/auth/context", { headers: { cookie } });
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({ hasBaby: true, baby: { id: "baby-a" } });
    const logout = await request("/api/identity/logout", { body: {}, headers: { ...browser, cookie } });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    await code(await request("/api/app/auth/context", { headers: { cookie } }), 401, "UNAUTHORIZED");
  });

  it("rejects cross-origin, absent-origin browser mutations and login CSRF before creating a session", async () => {
    const count = (await fixture.store.list("sessions")).length;
    await code(await legacyLogin({ origin: "https://evil.example" }), 403, "UNTRUSTED_ORIGIN");
    await code(await legacyLogin({ "x-bubu-client": "browser" }), 403, "UNTRUSTED_ORIGIN");
    await code(await legacyLogin({ cookie: "bubu_session=anything" }), 403, "UNTRUSTED_ORIGIN");
    expect((await fixture.store.list("sessions")).length).toBe(count);
    const login = await legacyLogin(browser);
    const cookie = cookieHeader(login);
    await code(await request("/api/identity/logout", { body: {}, headers: { cookie } }), 403, "UNTRUSTED_ORIGIN");
    await code(await request("/api/identity/logout", { body: {}, headers: { cookie, origin: "null" } }), 403, "UNTRUSTED_ORIGIN");
    expect((await request("/api/app/auth/context", { headers: { cookie } })).status).toBe(200);
  });

  it("keeps browser cookies, native bearer sessions and service credentials in their own transport", async () => {
    const native = await wxLogin("transport");
    const web = await legacyLogin(browser);
    const cookie = cookieHeader(web);
    const browserToken = cookie.split("=")[1]!;
    expect((await request("/api/app/auth/context", { headers: bearer(native.token) })).status).toBe(200);
    await code(await request("/api/app/auth/context", { headers: { cookie: `bubu_session=${native.token}` } }), 401, "UNAUTHORIZED");
    await code(await request("/api/app/auth/context", { headers: bearer(browserToken) }), 401, "UNAUTHORIZED");
    await code(await request("/api/app/auth/context", { headers: { ...bearer(native.token), cookie } }), 400, "AMBIGUOUS_CREDENTIAL");
    const operator = await fixture.service.provisionOperator("test-operator", "baby-a", 60_000);
    await code(await request("/api/app/auth/context", { headers: { cookie: `bubu_session=${operator.token}` } }), 401, "UNAUTHORIZED");
    expect((await request("/api/app/activities?babyId=baby-a", { headers: bearer(operator.token) })).status).toBe(200);
  });

  it("accepts only provider-verified code and rejects client-authored openid, identity and actor fields", async () => {
    const count = fixture.wechat.exchanges.length;
    await code(await request("/api/identity/wechat", { body: { code: "app:forged:code", openid: "someone-else" } }), 400, "INVALID_INPUT");
    await code(await request("/api/identity/wechat", { body: { code: "app:forged:code", actor: { kind: "operator" } } }), 400, "INVALID_INPUT");
    await code(await request("/api/identity/wechat", { body: { code: "app:browser:code" }, headers: browser }), 400, "NATIVE_REQUIRED");
    expect(fixture.wechat.exchanges).toHaveLength(count);
    const native = await wxLogin("forged-input");
    await code(await request("/api/identity/family", { body: { name: "宝宝", legacyUserId: "old-alice" }, headers: bearer(native.token) }), 400, "INVALID_INPUT");
    await code(await request("/api/identity/bind-legacy", { body: { username: "old-alice", password: "correct-password", identityId: "someone-else" }, headers: bearer(native.token) }), 400, "INVALID_INPUT");
    await code(await request("/api/identity/agent-credentials", { body: { babyId: "baby-a", kind: "operator" }, headers: bearer(native.token) }), 400, "INVALID_INPUT");
    await code(await request("/api/identity/grants", { body: { babyId: "baby-a", subjectId: native.context.identityId, state: "active", actor: { kind: "operator" } }, headers: bearer(native.token) }), 400, "INVALID_INPUT");
  });

  it("handles malformed credentials, JSON, content types and body limits without leaking internals", async () => {
    await code(await request("/api/app/auth/context"), 401, "UNAUTHORIZED");
    await code(await request("/api/app/auth/context", { headers: { authorization: "Basic anything" } }), 401, "UNAUTHORIZED");
    await code(await handle(new Request(`${origin}/api/identity/wechat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), 400, "INVALID_JSON");
    await code(await handle(new Request(`${origin}/api/identity/wechat`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })), 415, "JSON_REQUIRED");
    await code(await request("/api/identity/wechat", { body: { code: "x".repeat(17000) } }), 413, "BODY_TOO_LARGE");
    await code(await request("/api/identity/wechat", { body: { code: "invalid-code" } }), 401, "WECHAT_CODE_INVALID");
    const health = await request("/health");
    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("HTTP authorization and usable onboarding", () => {
  it("onboards a new family and requires authorization before touching legacy records", async () => {
    const native = await wxLogin("http-new-family");
    expect(native.context).toMatchObject({ hasBaby: false, baby: null });
    const created = await request("/api/identity/family", { body: { name: "新家庭" }, headers: bearer(native.token) });
    expect(created.status).toBe(200);
    const data = await created.json() as { context: { baby: { id: string } } };
    const babyId = data.context.baby.id;
    expect((await request(`/api/app/activities?babyId=${babyId}`, { headers: bearer(native.token) })).status).toBe(200);
    const reads = fixture.legacy.reads.length;
    await code(await request("/api/app/activities?babyId=baby-a", { headers: bearer(native.token) }), 403, "BABY_FORBIDDEN");
    await code(await request(`/api/app/activities?babyId=${babyId}`, { headers: { ...bearer(native.token), "x-baby-id": "baby-a" } }), 400, "SCOPE_MISMATCH");
    await code(await request("/api/app/auth/context?babyId=baby-a", { headers: bearer(native.token) }), 403, "BABY_FORBIDDEN");
    expect(fixture.legacy.reads).toHaveLength(reads);
    const renamed = await request(`/api/app/user-babies/${babyId}?babyId=${babyId}`, { method: "PATCH", body: { name: "新昵称", fullName: null }, headers: bearer(native.token) });
    expect(renamed.status).toBe(200);
    expect(fixture.legacy.babies.get(babyId)?.name).toBe("新昵称");
    await code(await request(`/api/app/user-babies/baby-a?babyId=${babyId}`, { method: "PATCH", body: { name: "越权", fullName: null }, headers: bearer(native.token) }), 403, "BABY_FORBIDDEN");
  });

  it("binds verified old credentials, rotates the native token and rejects arbitrary collector provisioning", async () => {
    const native = await wxLogin("http-bound");
    await code(await request("/api/identity/bind-legacy", { body: { username: "old-alice", password: "wrong-password" }, headers: bearer(native.token) }), 401, "LEGACY_CREDENTIALS_INVALID");
    const bound = await request("/api/identity/bind-legacy", { body: { username: "old-alice", password: "correct-password" }, headers: bearer(native.token) });
    expect(bound.status).toBe(200);
    const session = await bound.json() as { token: string; context: { baby: { id: string } } };
    expect(session.context.baby.id).toBe("baby-a");
    await code(await request("/api/app/auth/context", { headers: bearer(native.token) }), 401, "UNAUTHORIZED");
    expect((await request("/api/app/auth/context", { headers: bearer(session.token) })).status).toBe(200);
    await code(await request("/api/identity/agent-credentials", { body: { babyId: "baby-a", kind: "collector", groupId: "unapproved-group", agentId: "rogue" }, headers: bearer(session.token) }), 403, "BABY_FORBIDDEN");
    await code(await request("/api/identity/group-bindings", { body: { babyId: "baby-a", groupId: "unapproved-group", agentId: "rogue", active: true }, headers: bearer(session.token) }), 403, "BABY_FORBIDDEN");
    fixture.legacy.memberships.set("old-alice", []);
    const reads = fixture.legacy.reads.length;
    await code(await request("/api/app/activities?babyId=baby-a", { headers: bearer(session.token) }), 403, "BABY_FORBIDDEN");
    expect(fixture.legacy.reads).toHaveLength(reads);
    fixture.legacy.memberships.set("old-alice", ["baby-a"]);
  });

  it("applies a per-process login admission limit without trusting forwarding headers", async () => {
    const limited = createHandler(fixture.service, origin);
    for (let i = 0; i < 60; i++) {
      const response = await limited(new Request(`${origin}/api/identity/wechat`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${i}` }, body: JSON.stringify({ code: "invalid-code" }) }));
      expect(response.status).toBe(401);
    }
    await code(await limited(new Request(`${origin}/api/identity/wechat`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.1" }, body: JSON.stringify({ code: "invalid-code" }) })), 429, "LOGIN_RATE_LIMIT");
    fixture.advance(60_000);
    const response = await limited(new Request(`${origin}/api/identity/wechat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "invalid-code" }) }));
    expect(response.status).toBe(401);
  });
});
