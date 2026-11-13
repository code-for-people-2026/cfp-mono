import { describe, expect, it, vi } from "vitest";
import { HttpLegacyBackend } from "../src/legacy";

const origin = "https://legacy.example.test";
const tokenResponse = () => Response.json({ token: "cms-test-secret", exp: Math.floor(Date.now() / 1000) + 3600 });
const options = { origin, cmsEmail: "service@example.test", cmsPassword: "cms-password" };
const empty = () => Response.json({ docs: [] });
type Seen = { url: URL; init: RequestInit };
function fixture(handler: (request: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const request = { url: new URL(String(input)), init };
    seen.push(request);
    return handler(request);
  };
  return { backend: new HttpLegacyBackend({ ...options, fetch: fetcher }), seen };
}
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);
function cmsFixture(result: unknown) {
  return fixture(({ url }) => url.pathname === "/api/cms-admins/login" ? tokenResponse() : Response.json(result));
}

describe("legacy credential exchange", () => {
  it("proves the old identity with CSRF, new session cookies and the authoritative session endpoint", async () => {
    const { backend, seen } = fixture(({ url, init }) => {
      if (url.pathname === "/api/auth/csrf") return Response.json({ csrfToken: "csrf-proof" }, { headers: { "Set-Cookie": "__Host-authjs.csrf-token=csrf-cookie; Path=/; HttpOnly" } });
      if (url.pathname === "/api/auth/callback/credentials") {
        expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ username: "old-user", password: "old-password", csrfToken: "csrf-proof", callbackUrl: origin });
        expect(header(init, "cookie")).toBe("__Host-authjs.csrf-token=csrf-cookie");
        expect(header(init, "X-Auth-Return-Redirect")).toBe("1");
        const headers = new Headers();
        headers.append("Set-Cookie", "__Secure-authjs.session-token.0=first; Path=/; HttpOnly");
        headers.append("Set-Cookie", "__Secure-authjs.session-token.1=second; Path=/; HttpOnly");
        headers.append("Set-Cookie", "unrelated-secret=do-not-forward; Path=/");
        return Response.json({ url: origin }, { headers });
      }
      expect(url.pathname).toBe("/api/auth/session");
      expect(header(init, "cookie")).toContain("__Secure-authjs.session-token.0=first");
      expect(header(init, "cookie")).toContain("__Secure-authjs.session-token.1=second");
      expect(header(init, "cookie")).not.toContain("unrelated-secret");
      expect(header(init, "authorization")).toBeNull();
      return Response.json({ user: { id: "legacy-user-id", name: "昵称不用于匹配" }, expires: new Date(Date.now() + 60_000).toISOString() });
    });
    await expect(backend.verifyCredentials("old-user", "old-password")).resolves.toEqual({ id: "legacy-user-id" });
    await expect(backend.verifyCredentials("old-user", "old-password")).resolves.toEqual({ id: "legacy-user-id" });
    expect(seen).toHaveLength(6);
    expect(header(seen[3]!.init, "cookie")).toBeNull();
    expect(seen.every(({ init }) => init.redirect === "error" && init.cache === "no-store" && init.signal)).toBe(true);
  });

  it.each(["CredentialsSignin", "AccessDenied"])("rejects callback errors (%s) without reading a session", async (error) => {
    const { backend, seen } = fixture(({ url }) => url.pathname.endsWith("csrf")
      ? Response.json({ csrfToken: "csrf" }, { headers: { "Set-Cookie": "authjs.csrf-token=value" } })
      : Response.json({ url: `${origin}/login?error=${error}` }));
    await expect(backend.verifyCredentials("someone", "wrong-password")).rejects.toMatchObject({ status: 401, code: "LEGACY_CREDENTIALS_INVALID" });
    expect(seen).toHaveLength(2);
  });

  it("does not accept a matching nickname without an authenticated user ID", async () => {
    const { backend } = fixture(({ url }) => {
      if (url.pathname.endsWith("csrf")) return Response.json({ csrfToken: "csrf" }, { headers: { "Set-Cookie": "authjs.csrf-token=value" } });
      if (url.pathname.includes("callback")) return Response.json({ url: origin }, { headers: { "Set-Cookie": "authjs.session-token=opaque" } });
      return Response.json({ user: { name: "old-user" }, expires: new Date(Date.now() + 60_000).toISOString() });
    });
    await expect(backend.verifyCredentials("old-user", "password")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an expired authenticated session", async () => {
    const { backend } = fixture(({ url }) => {
      if (url.pathname.endsWith("csrf")) return Response.json({ csrfToken: "csrf" }, { headers: { "Set-Cookie": "authjs.csrf-token=value" } });
      if (url.pathname.includes("callback")) return Response.json({ url: origin }, { headers: { "Set-Cookie": "authjs.session-token=opaque" } });
      return Response.json({ user: { id: "old-user" }, expires: "2000-01-01T00:00:00Z" });
    });
    await expect(backend.verifyCredentials("old-user", "password")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects callback redirects outside the configured origin and never discloses provider errors", async () => {
    const { backend, seen } = fixture(({ url }) => url.pathname.endsWith("csrf")
      ? Response.json({ csrfToken: "csrf" }, { headers: { "Set-Cookie": "authjs.csrf-token=value" } })
      : Response.json({ url: "https://evil.example/?password=private" }));
    await expect(backend.verifyCredentials("old-user", "private-password")).rejects.toMatchObject({ status: 502, message: "旧版服务暂时不可用，请稍后重试" });
    expect(seen).toHaveLength(2);
    const failed = new HttpLegacyBackend({ ...options, fetch: vi.fn().mockRejectedValue(new Error("password=private-password")) });
    await expect(failed.verifyCredentials("old-user", "private-password")).rejects.toThrow("旧版服务暂时不可用");
  });
});

describe("legacy CMS boundary", () => {
  it.each(["http://public.example", "https://user:secret@example.test", "https://example.test/path", "file:///tmp/private", "https://example.test?token=secret"])("rejects unsafe origin %s", (value) => {
    expect(() => new HttpLegacyBackend({ ...options, origin: value })).toThrow();
  });
  it.each(["http://127.0.0.1:1030", "http://localhost:1030", "http://[::1]:1030"])("allows explicit loopback development origin %s", (value) => {
    expect(() => new HttpLegacyBackend({ ...options, origin: value })).not.toThrow();
  });
  it("logs into the real CMS auth collection and refreshes a rejected token once", async () => {
    let logins = 0; let reads = 0;
    const { backend, seen } = fixture(({ url, init }) => {
      if (url.pathname === "/api/cms-admins/login") {
        logins++;
        expect(JSON.parse(String(init.body))).toEqual({ email: options.cmsEmail, password: options.cmsPassword });
        expect(header(init, "authorization")).toBeNull();
        return Response.json({ token: `token-${logins}`, exp: Math.floor(Date.now() / 1000) + 3600 });
      }
      reads++;
      expect(header(init, "authorization")).toBe(`JWT token-${logins}`);
      return reads === 1 ? Response.json({ errors: [] }, { status: 401 }) : Response.json({ id: "user-1" });
    });
    await expect(backend.userExists("user-1")).resolves.toBe(true);
    await expect(backend.userExists("user-1")).resolves.toBe(true);
    expect(logins).toBe(2);
    expect(reads).toBe(3);
    expect(seen.every(({ url }) => url.origin === origin)).toBe(true);
  });
  it("lists only the current user's memberships and rejects wrong-user results", async () => {
    let bad = false;
    const { backend, seen } = fixture(({ url }) => {
      if (url.pathname === "/api/cms-admins/login") return tokenResponse();
      if (url.pathname === "/api/baby-users") return Response.json({ docs: [{ id: "binding-1", user: bad ? "other-user" : "user-1", baby: "baby-1", isDefault: true }] });
      return Response.json({ id: "baby-1", name: "宝宝", fullName: null });
    });
    await expect(backend.listBabies("user-1")).resolves.toMatchObject([{ id: "baby-1", name: "宝宝", isDefault: true }]);
    const request = seen.find(({ url }) => url.pathname === "/api/baby-users")!;
    expect(request.url.searchParams.get("where[user][equals]")).toBe("user-1");
    expect(request.url.searchParams.get("depth")).toBe("0");
    bad = true;
    await expect(backend.listBabies("user-1")).rejects.toMatchObject({ code: "LEGACY_SCOPE_INVALID" });
  });
  it("sends only name fields and extracts Payload's mutation document", async () => {
    const { backend, seen } = cmsFixture({ doc: { id: "baby-1", name: "新昵称", fullName: "姓名", gender: "OTHER" } });
    await expect(backend.updateBabyNames("baby-1", { name: " 新昵称 ", fullName: " 姓名 " })).resolves.toMatchObject({ id: "baby-1", name: "新昵称" });
    expect(JSON.parse(String(seen[1]!.init.body))).toEqual({ name: "新昵称", fullName: "姓名" });
    expect(seen[1]!.init.method).toBe("PATCH");
  });
});

describe("authorized legacy reads preserve old GET semantics", () => {
  it("combines the fixed baby boundary with type and crossing ranges without forwarding arbitrary filters", async () => {
    const original = { id: "a-1", babyId: "baby-1", type: "SLEEP", startTime: "2026-10-21T20:00:00Z", endTime: null, notes: "原字段", customField: "preserved" };
    const { backend, seen } = cmsFixture({ docs: [original] });
    const query = new URLSearchParams({ babyId: "other-baby", "where[babyId][equals]": "other-baby", type: "SLEEP", types: "BOTTLE", startTimeGte: "2026-10-22T00:00:00+08:00", startTimeLt: "2026-10-23T00:00:00+08:00", crossStartTime: "true", crossEndTime: "true", limit: "100" });
    await expect(backend.read("baby-1", "activities", query)).resolves.toEqual([original]);
    const values = seen[1]!.url.searchParams;
    expect(values.get("where[and][0][babyId][equals]")).toBe("baby-1");
    expect(values.get("where[and][1][type][equals]")).toBe("SLEEP");
    expect(values.get("where[and][2][or][0][startTime][greater_than_equal]")).toBe("2026-10-21T16:00:00.000Z");
    expect(values.get("where[and][2][or][1][and][1][or][1][endTime][exists]")).toBe("false");
    expect(values.get("where[and][2][or][2][and][0][startTime][less_than]")).toBe("2026-10-22T16:00:00.000Z");
    expect(values.get("sort")).toBe("-startTime");
    expect(values.toString()).not.toContain("other-baby");
  });
  it("keeps the old date overlap and China day boundary", async () => {
    const { backend, seen } = cmsFixture({ docs: [] });
    await backend.read("baby-1", "activities", new URLSearchParams({ date: "2026-10-22" }));
    const values = seen[1]!.url.searchParams;
    expect(values.get("where[and][1][and][0][startTime][less_than_equal]")).toBe("2026-10-22T15:59:59.999Z");
    expect(values.get("where[and][1][and][1][or][0][endTime][greater_than_equal]")).toBe("2026-10-21T16:00:00.000Z");
  });
  it("reads saved daily stats directly and uses the legacy inclusive date range", async () => {
    const stats = { id: "s-1", babyId: "baby-1", date: "2026-10-21T16:00:00Z", sleepCount: 8, totalSleepMinutes: 430 };
    const { backend, seen } = cmsFixture({ docs: [stats] });
    await expect(backend.read("baby-1", "daily-stats", new URLSearchParams({ startDate: "2026-10-20", endDate: "2026-10-22" }))).resolves.toEqual([stats]);
    const values = seen[1]!.url.searchParams;
    expect(values.get("where[and][0][babyId][equals]")).toBe("baby-1");
    expect(values.get("where[and][1][date][greater_than_equal]")).toBe("2026-10-19T16:00:00.000Z");
    expect(values.get("where[and][2][date][less_than_equal]")).toBe("2026-10-22T15:59:59.999Z");
    expect(values.get("sort")).toBe("date");
    expect(values.get("limit")).toBe("500");
    expect(seen[1]!.init.method).toBeUndefined();
  });
  it("handles latest/null and detail/404 as the original API", async () => {
    const { backend } = cmsFixture({ docs: [] });
    await expect(backend.read("baby-1", "activities/latest", new URLSearchParams({ types: "BOTTLE,BREASTFEED" }))).resolves.toBeNull();
    await expect(backend.read("baby-1", "activities/missing", new URLSearchParams())).rejects.toMatchObject({ status: 404 });
    await expect(backend.read("baby-1", "daily-stats/2026-10-22", new URLSearchParams())).rejects.toMatchObject({ status: 404 });
    await expect(backend.read("baby-1", "activities/latest", new URLSearchParams())).rejects.toMatchObject({ status: 400 });
  });
  it.each(["activities", "activities/a-1", "activities/latest", "daily-stats", "daily-stats/2026-10-22"])("rejects an upstream cross-baby row from %s", async (path) => {
    const { backend } = cmsFixture({ docs: [{ id: "a-1", babyId: "other-baby" }] });
    await expect(backend.read("baby-1", path, new URLSearchParams({ types: "SLEEP" }))).rejects.toMatchObject({ code: "LEGACY_SCOPE_INVALID" });
  });
  it.each(["cms-admins", "activities/a-1/nested", "../app-users", "activities%2Fanything", "https://evil.example/activities"])("does not proxy unknown path %s", async (path) => {
    const { backend, seen } = fixture(empty);
    await expect(backend.read("baby-1", path, new URLSearchParams())).rejects.toMatchObject({ status: 404 });
    expect(seen).toHaveLength(0);
  });
});

describe("new family provisioning", () => {
  it("uses original collections and stable IDs, resumes partial creation, and never returns the random legacy password", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const writes: { collection: string; value: Record<string, unknown> }[] = [];
    let failBaby = true;
    const { backend } = fixture(({ url, init }) => {
      if (url.pathname === "/api/cms-admins/login") return tokenResponse();
      const parts = url.pathname.split("/");
      const collection = parts[2]!;
      const key = parts[3];
      if (init.method === "POST") {
        const value = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (collection === "babies" && failBaby) { failBaby = false; return Response.json({ error: "temporary" }, { status: 503 }); }
        rows.set(`${collection}/${value.id}`, value);
        writes.push({ collection, value });
        return Response.json({ doc: value }, { status: 201 });
      }
      const existing = rows.get(`${collection}/${key}`);
      return existing ? Response.json(existing) : Response.json({}, { status: 404 });
    });
    await expect(backend.createFamily("server-generated-identity", { name: "宝宝" })).rejects.toMatchObject({ status: 502 });
    const family = await backend.createFamily("server-generated-identity", { name: "宝宝" });
    const replay = await backend.createFamily("server-generated-identity", { name: "不应覆盖原昵称" });
    expect(replay).toEqual(family);
    expect(writes.map(({ collection }) => collection)).toEqual(["app-users", "babies", "baby-users"]);
    expect(writes[0]!.value).toMatchObject({ id: family.userId, role: "OTHER", name: "微信照护者" });
    expect(String(writes[0]!.value.username)).toMatch(/^bubu_[0-9a-f]{24}$/);
    expect(String(writes[0]!.value.password).length).toBeGreaterThanOrEqual(43);
    expect(writes[1]!.value).toMatchObject({ id: family.baby.id, name: "宝宝", gender: "OTHER" });
    expect(writes[2]!.value).toMatchObject({ user: family.userId, baby: family.baby.id, isDefault: true });
    expect(JSON.stringify(family)).not.toContain(String(writes[0]!.value.password));
    expect(family.baby.isDefault).toBe(true);
  });

  it.each(["app-users", "babies", "baby-users"])("recovers a committed %s write whose HTTP response is lost without issuing it again", async (lostCollection) => {
    const rows = new Map<string, Record<string, unknown>>();
    const writes: string[] = [];
    let loseResponse = true;
    const { backend } = fixture(({ url, init }) => {
      if (url.pathname === "/api/cms-admins/login") return tokenResponse();
      const parts = url.pathname.split("/");
      const collection = parts[2]!;
      const key = parts[3];
      if (init.method === "POST") {
        const value = JSON.parse(String(init.body)) as Record<string, unknown>;
        rows.set(`${collection}/${value.id}`, value);
        writes.push(collection);
        if (collection === lostCollection && loseResponse) { loseResponse = false; throw new Error("connection reset after commit"); }
        return Response.json({ doc: value }, { status: 201 });
      }
      const existing = rows.get(`${collection}/${key}`);
      return existing ? Response.json(existing) : Response.json({}, { status: 404 });
    });
    const family = await backend.createFamily("response-loss-identity", { name: "原昵称" });
    const replay = await backend.createFamily("response-loss-identity", { name: "不能覆盖" });
    expect(family).toEqual(replay);
    expect(family.baby.name).toBe("原昵称");
    expect(writes).toEqual(["app-users", "babies", "baby-users"]);
  });

  it("rejects conflicting preexisting stable user IDs before provisioning a baby", async () => {
    const { backend, seen } = fixture(({ url }) => {
      if (url.pathname === "/api/cms-admins/login") return tokenResponse();
      return Response.json({ id: url.pathname.split("/").at(-1), username: "unrelated-account" });
    });
    await expect(backend.createFamily("server-identity", { name: "宝宝" })).rejects.toMatchObject({ code: "LEGACY_SCOPE_INVALID" });
    expect(seen.filter(({ url }) => url.pathname.startsWith("/api/babies"))).toHaveLength(0);
    expect(seen.filter(({ init }) => init.method === "POST")).toHaveLength(1); // CMS authentication only.
  });

  it("rejects a stable binding whose returned user or baby does not match the provisioned family", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const { backend } = fixture(({ url, init }) => {
      if (url.pathname === "/api/cms-admins/login") return tokenResponse();
      const parts = url.pathname.split("/");
      const collection = parts[2]!;
      const key = parts[3];
      if (init.method === "POST") {
        const value = JSON.parse(String(init.body)) as Record<string, unknown>;
        rows.set(`${collection}/${value.id}`, value);
        return Response.json({ doc: value }, { status: 201 });
      }
      const existing = rows.get(`${collection}/${key}`);
      if (collection === "baby-users" && existing) return Response.json({ ...existing, user: "another-user" });
      return existing ? Response.json(existing) : Response.json({}, { status: 404 });
    });
    await expect(backend.createFamily("server-identity", { name: "宝宝" })).rejects.toMatchObject({ code: "LEGACY_SCOPE_INVALID" });
  });
});
