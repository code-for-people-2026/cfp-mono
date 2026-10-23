import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_LIMIT, ApiError, ConfigurationError, createBubuApi, type Transport, type TransportRequest, type TransportResponse } from "../src/api/client";
import { ResponseFormatError } from "../src/api/contracts";
import type { SessionStorage } from "../src/api/session";

function storage() {
  const values = new Map<string, unknown>();
  const store: SessionStorage = { get: (key) => values.get(key), set: (key, value) => values.set(key, value), remove: (key) => { values.delete(key); } };
  return { store, values };
}
const baby = { id: "baby-1", name: "宝宝", fullName: null, avatarUrl: null, isDefault: true };
const context = { authenticated: true, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id };
const event = { id: "event-1", babyId: baby.id, type: "BOTTLE", startTime: "2026-10-23T01:00:00.000Z", milkAmount: 0, hasPoop: false, notes: null };
const response = (data: unknown, status = 200, cookies?: string[]): TransportResponse => ({ status, data, cookies });
function fixture(transport: Transport, native = true, origin = "https://baby.example.test", saved = storage()) {
  return { client: createBubuApi({ native, origin, transport, storage: saved.store }), store: saved.store, values: saved.values };
}

describe("existing account session protocol", () => {
  it("exchanges CSRF + credentials, persists only origin-scoped Auth.js cookies and verifies the account", async () => {
    const requests: TransportRequest[] = [];
    const transport: Transport = async (request) => {
      requests.push(request);
      if (request.url.endsWith("/csrf")) return response({ csrfToken: "csrf" }, 200, ["__Host-authjs.csrf-token=csrf%7Csignature; Path=/; Secure; HttpOnly"]);
      if (request.url.endsWith("/credentials")) {
        expect(request.headers.Cookie).toContain("__Host-authjs.csrf-token=csrf%7Csignature");
        expect(request.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
        expect(request.headers["X-Auth-Return-Redirect"]).toBe("1");
        expect(request.body).toContain("password=p%26%3D%20%2B");
        return response({ url: "https://baby.example.test/" }, 200, ["__Secure-authjs.session-token.0=first; Path=/; Secure; HttpOnly", "__Secure-authjs.session-token.1=second; Path=/; Secure; HttpOnly"]);
      }
      expect(request.headers.Cookie).toContain("__Secure-authjs.session-token.0=first");
      expect(request.headers.Cookie).toContain("__Secure-authjs.session-token.1=second");
      return response(context);
    };
    const setup = fixture(transport);
    expect(await setup.client.login({ username: " parent ", password: "p&= +" })).toMatchObject(context);
    expect(requests.map((item) => item.url)).toEqual(["https://baby.example.test/api/auth/csrf", "https://baby.example.test/api/auth/callback/credentials", "https://baby.example.test/api/app/auth/context"]);
    expect(JSON.stringify([...setup.values])).not.toContain("password");
    expect(JSON.stringify([...setup.values])).not.toContain("parent");
    expect([...setup.values.keys()]).toEqual(["bubu-session:https://baby.example.test"]);
    const resumed = fixture(transport, true, "https://baby.example.test", setup);
    expect((await resumed.client.getContext()).authenticated).toBe(true);
    const isolated = fixture(async (request) => { expect(request.headers.Cookie).toBeUndefined(); return response({ authenticated: false, hasBaby: false }, 401); }, true, "https://other.example.test", setup);
    expect((await isolated.client.getContext()).authenticated).toBe(false);
  });

  it("does not treat HTTP 200 login error redirects as success", async () => {
    let count = 0;
    const setup = fixture(async () => ++count === 1 ? response({ csrfToken: "csrf" }, 200, ["authjs.csrf-token=csrf; Path=/"]) : response({ url: "https://baby.example.test/login?error=CredentialsSignin&code=credentials" }));
    await expect(setup.client.login({ username: "parent", password: "bad" })).rejects.toMatchObject({ code: "LOGIN_FAILED", status: 401 });
    expect(count).toBe(2);
    expect(setup.values.size).toBe(0);
  });

  it("verifies auth/context after the callback instead of accepting a redirect alone", async () => {
    const setup = fixture(async (request) => request.url.endsWith("/csrf") ? response({ csrfToken: "csrf" }) : request.url.endsWith("/credentials") ? response({ url: "/" }) : response({ authenticated: false, hasBaby: false }, 401));
    await expect(setup.client.login({ username: "parent", password: "password" })).rejects.toMatchObject({ code: "LOGIN_FAILED" });
  });

  it("returns the no-baby state after a valid login, rather than inventing a binding", async () => {
    const noBaby = { authenticated: true, hasBaby: false, baby: null, babies: [], defaultBabyId: null };
    const setup = fixture(async (request) => request.url.endsWith("/csrf") ? response({ csrfToken: "csrf" }) : request.url.endsWith("/credentials") ? response({ url: "/" }) : response(noBaby));
    expect(await setup.client.login({ username: "parent", password: "password" })).toEqual(noBaby);
  });

  it("keeps H5 same-origin and lets the browser manage HttpOnly cookies", async () => {
    const { client, values } = fixture(async (request) => {
      expect(request.url).toBe("/api/app/auth/context");
      expect(request.credentials).toBe("include");
      expect(request.headers.Cookie).toBeUndefined();
      return response(context, 200, ["authjs.session-token=browser-only; Path=/"]);
    }, false, "https://ignored-other-backend.test");
    await client.getContext();
    expect(values.size).toBe(0);
  });

  it("requires a configured native server and never sends a password to an invalid origin", async () => {
    for (const origin of ["", "https://host.test/path", "https://user:password@host.test", "http://remote.test"]) {
      const { client } = fixture(async () => { throw new Error("must not request"); }, true, origin);
      await expect(client.login({ username: "parent", password: "password" })).rejects.toBeInstanceOf(ConfigurationError);
    }
  });

  it("runs native login without browser URL or URLSearchParams globals", async () => {
    vi.stubGlobal("URL", undefined);
    vi.stubGlobal("URLSearchParams", undefined);
    try {
      const { client } = fixture(async (request) => request.url.endsWith("/csrf") ? response({ csrfToken: "csrf" }) : request.url.endsWith("/credentials") ? response({ url: "https://baby.example.test/" }) : response(context));
      expect((await client.login({ username: "parent", password: "password" })).authenticated).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([200, 401])("keeps late HTTP %i responses invalidated after logout", async (status) => {
    let resolvePending: ((value: TransportResponse) => void) | undefined;
    const setup = fixture(async (request) => {
      if (request.url.includes("/activities?")) return new Promise<TransportResponse>((resolve) => { resolvePending = resolve; });
      if (request.url.endsWith("/csrf")) return response({ csrfToken: "csrf" }, 200, ["authjs.csrf-token=csrf; Path=/"]);
      expect(request.url).toContain("/api/auth/signout");
      expect(request.body).toContain("csrfToken=csrf");
      return response({ url: "/" }, 200, ["authjs.session-token=; Path=/; Max-Age=0"]);
    });
    const pending = setup.client.getActivities({ babyId: baby.id, date: "2026-10-23" });
    await setup.client.logout();
    resolvePending?.(response([event], status, ["authjs.session-token=stale; Path=/"]));
    await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(setup.values.size).toBe(0);
  });

  it("normalizes expired auth context and reports unauthorized data requests", async () => {
    const { client } = fixture(async () => response({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401));
    expect(await client.getContext()).toEqual({ authenticated: false, hasBaby: false, baby: null, babies: [] });
    await expect(client.getActivity(baby.id, event.id)).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it.each([200, 401])("reports the current date as unauthorized after an earlier date expires, even if its late response is HTTP %i", async (lateStatus) => {
    const pending: Array<(value: TransportResponse) => void> = [];
    const setup = fixture(() => new Promise<TransportResponse>((resolve) => { pending.push(resolve); }));
    const oldDate = setup.client.getActivities({ babyId: baby.id, date: "2026-10-22" }).catch((error: unknown) => error);
    const currentDate = setup.client.getActivities({ babyId: baby.id, date: "2026-10-23" }).catch((error: unknown) => error);
    pending[0](response({ error: "Unauthorized" }, 401));
    expect(await oldDate).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    pending[1](response(lateStatus === 200 ? [event] : { error: "Unauthorized" }, lateStatus, ["authjs.session-token=expired-response; Path=/"]));
    expect(await currentDate).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(setup.values.size).toBe(0);
  });

  it("does not let an old unauthorized response clear the newly logged-in account", async () => {
    let resolveOld: ((value: TransportResponse) => void) | undefined;
    const setup = fixture(async (request) => {
      if (request.url.includes("/activities?")) return new Promise<TransportResponse>((resolve) => { resolveOld = resolve; });
      if (request.url.endsWith("/csrf")) return response({ csrfToken: "csrf" }, 200, ["authjs.csrf-token=csrf; Path=/"]);
      if (request.url.endsWith("/credentials")) return response({ url: "/" }, 200, ["authjs.session-token=new-account; Path=/"]);
      expect(request.headers.Cookie).toContain("authjs.session-token=new-account");
      return response(context);
    });
    const oldRequest = setup.client.getActivities({ babyId: baby.id, date: "2026-10-22" }).catch((error: unknown) => error);
    await setup.client.login({ username: "parent", password: "password" });
    resolveOld?.(response({ error: "Unauthorized" }, 401, ["authjs.session-token=; Path=/; Max-Age=0"]));
    expect(await oldRequest).toMatchObject({ status: 409, code: "SESSION_CHANGED" });
    expect((await setup.client.getContext()).authenticated).toBe(true);
    expect(JSON.stringify([...setup.values])).toContain("new-account");
  });
});

describe("read API and data boundaries", () => {
  it("scopes queries and headers, requests overlaps and flags the result cap", async () => {
    const { client } = fixture(async (request) => {
      expect(request.headers["x-baby-id"]).toBe("baby /二");
      expect(request.url).toContain("babyId=baby%20%2F%E4%BA%8C");
      expect(request.url).toContain("limit=1000");
      expect(request.url).toContain("crossStartTime=true");
      expect(request.url).toContain("crossEndTime=true");
      expect(request.url).toContain("types=SLEEP%2CBOTTLE");
      return response(Array.from({ length: ACTIVITY_LIMIT }, (_, index) => ({ ...event, id: String(index), babyId: "baby /二" })));
    });
    const result = await client.getActivities({ babyId: "baby /二", startTimeGte: "2026-10-22T16:00:00Z", startTimeLt: "2026-10-29T16:00:00Z", crossEndTime: true, types: ["SLEEP", "BOTTLE"] });
    expect(result.complete).toBe(false);
    expect(result.limit).toBe(1000);
    expect(result.activities).toHaveLength(1000);
  });

  it("keeps known zeros, nulls and false intact without manufacturing fields", async () => {
    const { client } = fixture(async () => response([event]));
    const result = await client.getActivities({ babyId: baby.id, date: "2026-10-23" });
    expect(result.complete).toBe(true);
    expect(result.activities[0]).toMatchObject({ milkAmount: 0, hasPoop: false, notes: null });
    expect(result.activities[0].endTime).toBeUndefined();
  });

  it("rejects a non-array, invalid activity type and foreign baby record", async () => {
    for (const data of [{ docs: [] }, [{ ...event, type: "UNKNOWN" }], [{ ...event, babyId: "other" }], [{ ...event, startTime: "not a date" }]]) {
      const { client } = fixture(async () => response(data));
      await expect(client.getActivities({ babyId: baby.id, date: "2026-10-23" })).rejects.toBeInstanceOf(ResponseFormatError);
    }
  });

  it("reads details and latest activity through scoped endpoints", async () => {
    const { client } = fixture(async (request) => {
      expect(request.headers["x-baby-id"]).toBe(baby.id);
      if (request.url.includes("/latest?")) {
        expect(request.url).toContain("types=SLEEP");
        return response(null);
      }
      expect(request.url).toContain("/activities/event%2F1?");
      return response(event);
    });
    expect((await client.getActivity(baby.id, "event/1")).id).toBe(event.id);
    expect(await client.getLatestActivity(baby.id, ["SLEEP"])).toBeNull();
  });

  it("preserves missing summary dates and never writes/recomputes them", async () => {
    const requests: TransportRequest[] = [];
    const { client } = fixture(async (request) => { requests.push(request); return request.url.includes("/daily-stats/2026") ? response({ error: "未找到该日期的统计数据" }, 404) : response([]); });
    expect(await client.getDailyStats({ babyId: baby.id, startDate: "2026-10-01", endDate: "2026-10-23" })).toEqual([]);
    expect(await client.getDailyStat(baby.id, "2026-10-23")).toBeNull();
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("does not misreport forbidden scope or a missing baby as an absent statistic", async () => {
    for (const [status, code] of [[403, "BABY_FORBIDDEN"], [404, "BABY_NOT_FOUND"]] as const) {
      const { client } = fixture(async () => response({ error: "Baby not found", code }, status));
      await expect(client.getDailyStat(baby.id, "2026-10-23")).rejects.toMatchObject({ status, code });
    }
  });

  it("reads full existing summary fields, including known zero counts", async () => {
    const stat = { id: "summary-1", babyId: baby.id, date: "2026-10-22T16:00:00.000Z", sleepCount: 0, totalSleepMinutes: 0, totalMilkAmount: 100, totalPumpMilkAmount: 0, diaperCount: 2, peeCount: 0, projectileSpitUpCount: 0 };
    const { client } = fixture(async () => response([stat]));
    expect(await client.getDailyStats({ babyId: baby.id, startDate: "2026-10-23", endDate: "2026-10-23" })).toEqual([stat]);
  });

  it("validates bounded date ranges before requesting truncated or unbounded data", async () => {
    const { client } = fixture(async () => { throw new Error("must not request"); });
    await expect(client.getActivities({ babyId: baby.id })).rejects.toBeInstanceOf(ApiError);
    await expect(client.getActivities({ babyId: baby.id, date: "2026-02-30" })).rejects.toMatchObject({ status: 400 });
    await expect(client.getDailyStats({ babyId: baby.id, startDate: "2020-01-01", endDate: "2026-10-23" })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps the user-babies response wrapper and default/current choices", async () => {
    const { client } = fixture(async () => response({ data: [{ ...baby, birthDate: "2026-01-01T00:00:00Z", gender: "OTHER" }], defaultBabyId: baby.id, currentBabyId: baby.id }));
    expect(await client.getBabies(baby.id)).toMatchObject({ data: [{ id: baby.id, birthDate: "2026-01-01T00:00:00Z" }], currentBabyId: baby.id });
  });
});
