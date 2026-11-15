import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/contracts";
import { createHandler } from "../src/http";
import { CollectorService } from "../src/collector/service";
import { serializeDatabaseTransactions } from "../src/database-queue";
import { IdentityService } from "../src/identity";
import { privacyCollections } from "../src/privacy/persistence";
import { AttachmentService } from "../src/records/attachments";
import { recordCollections } from "../src/records/persistence";
import { RecordsService } from "../src/records/service";
import { openStore } from "../src/store";
import type { AttachmentObjectStore } from "../src/storage/attachment-objects";
import { identityFixture, type IdentityFixture, WechatFixture } from "./fixtures/identity";
import { RecordsLegacyFixture } from "./fixtures/records";

class DeferredHttpObjectStore implements AttachmentObjectStore {
  readonly kind = "oss" as const;
  readonly objects = new Map<string, Buffer>();
  private getGate?: Promise<void>;
  private releaseGet?: () => void;
  private getStarted?: Promise<void>;
  private resolveGetStarted?: () => void;
  private nextGetPauses = false;
  pauseNextGet() {
    this.nextGetPauses = true;
    this.getGate = new Promise(resolve => { this.releaseGet = resolve; });
    this.getStarted = new Promise(resolve => { this.resolveGetStarted = resolve; });
  }
  startedGet() { return this.getStarted ?? Promise.reject(new Error("Deferred GET was not armed")); }
  finishGet() { this.releaseGet?.(); this.releaseGet = undefined; }
  async put(key: string, bytes: Uint8Array) { this.objects.set(key, Buffer.from(bytes)); }
  async get(key: string, maxBytes: number) {
    if (this.nextGetPauses) {
      this.nextGetPauses = false;
      this.resolveGetStarted?.();
      await this.getGate;
    }
    const bytes = this.objects.get(key);
    if (!bytes || bytes.byteLength > maxBytes) throw new AppError(503, "ATTACHMENT_OBJECT_MISSING", "synthetic missing object");
    return Buffer.from(bytes);
  }
  async remove(key: string) { this.objects.delete(key); }
  async *list(prefix: string) {
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) yield { key, lastModified: 1 };
  }
}

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
  it("reads imported OSS photos outside the identity lock and denies a response revoked during GET", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bubu-http-oss-test-"));
    const store = await openStore({ directory, extensions: [...recordCollections, ...privacyCollections] });
    serializeDatabaseTransactions(store.payload);
    const legacy = new RecordsLegacyFixture();
    const identity = new IdentityService(store, legacy, new WechatFixture());
    const objects = new DeferredHttpObjectStore();
    const attachments = new AttachmentService(identity, { directory, objectStore: objects });
    const records = new RecordsService(identity, legacy, (scope, req, attachmentId) => attachments.validateAttachment(scope, req, attachmentId));
    const collector = new CollectorService(identity, async () => false);
    const operator = await identity.authenticate((await identity.provisionOperator("http-oss-operator", "baby-a", 60_000)).token, "bearer");
    const login = await identity.loginWechat("app:http-oss-revocation:code");
    const guest = await identity.authenticate(login.token, "bearer");
    await identity.setGrant(operator, "baby-a", guest.subjectId, "active", ["records:read", "records:write", "media:read", "media:write"]);
    const photo = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#7799bb" } }).png().toBuffer();
    const attachment = await attachments.upload(guest, "baby-a", photo, "image/png", "http-oss-revocation");
    const legacyBoundary: { read(babyId: string, resource: string, query: URLSearchParams): Promise<unknown> } = legacy;
    vi.spyOn(legacyBoundary, "read").mockResolvedValue({ id: "imported-photo", babyId: "baby-a", type: "DIAPER", poopPhotoUrl: `bubu-attachment:${attachment.id}` });
    const scoped = createHandler(identity, origin, { allowedOrigins: [] }, { records, attachments, collector });
    objects.pauseNextGet();
    const response = scoped(new Request(`${origin}/api/app/media/activities/imported-photo?babyId=baby-a`, { headers: bearer(login.token) }));
    try {
      const started = await Promise.race([
        objects.startedGet().then(() => "started"),
        response.then(async value => `finished:${value.status}:${JSON.stringify(await value.clone().json())}`),
      ]);
      expect(started).toBe("started");
      const revoked = identity.setGrant(operator, "baby-a", guest.subjectId, "revoked");
      expect(await Promise.race([revoked.then(() => true), delay(500).then(() => false)])).toBe(true);
      objects.finishGet();
      await code(await response, 403, "BABY_FORBIDDEN");
    } finally {
      objects.finishGet();
      await response.catch(() => undefined);
      vi.restoreAllMocks();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns a scoped baby profile and rejects mismatched or revoked access", async () => {
    const originalBaby = fixture.legacy.babies.get("baby-a")!;
    fixture.legacy.babies.set("baby-a", { ...originalBaby, birthDate: "2026-01-02T00:00:00.000Z" });
    try {
      const login = await legacyLogin(browser);
      const cookie = cookieHeader(login);
      const profile = await request("/api/app/baby-profile?babyId=baby-a", { headers: { cookie } });
      expect(profile.status).toBe(200);
      expect(await profile.json()).toMatchObject({ id: "baby-a", birthDate: "2026-01-02T00:00:00.000Z" });
      await code(await request("/api/app/baby-profile?babyId=baby-b", { headers: { cookie } }), 403, "BABY_FORBIDDEN");
      await code(await request("/api/app/baby-profile?babyId=baby-a", { headers: { cookie, "x-baby-id": "baby-b" } }), 400, "SCOPE_MISMATCH");

      const guest = await wxLogin("http-profile-revoked");
      const issuedOperator = await fixture.service.provisionOperator("profile-operator", "baby-b", 60_000);
      const operator = await fixture.service.authenticate(issuedOperator.token, "bearer");
      await fixture.service.setGrant(operator, "baby-b", guest.context.identityId, "active", ["records:read"]);
      expect((await request("/api/app/baby-profile?babyId=baby-b", { headers: bearer(guest.token) })).status).toBe(200);
      await fixture.service.setGrant(operator, "baby-b", guest.context.identityId, "revoked");
      await code(await request("/api/app/baby-profile?babyId=baby-b", { headers: bearer(guest.token) }), 403, "BABY_FORBIDDEN");
    } finally {
      fixture.legacy.babies.set("baby-a", originalBaby);
    }
  });

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
