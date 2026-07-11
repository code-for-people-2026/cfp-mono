import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCustomerToken, verifyOperatorSelectionToken, verifyOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CmsAuthError } from "../lib/cms/auth";
import { Code2SessionError } from "../lib/wx/code2session";
import { authRoutes, customerAuthRoutes, type AuthDeps, type CustomerAuthDeps } from "./auth";

const SECRET = "v1-secret";
const NOW = 1_800_000_000;
const originalEnv = { ...process.env };
const memberships = [
  { operatorId: 1, sellerId: 7, sellerName: "桃子", active: true as const },
  { operatorId: 2, sellerId: 8, sellerName: "邻居", active: true as const }
];

const deps = (lookup: AuthDeps["findOperatorMemberships"] = vi.fn(async () => memberships.slice(0, 1))): AuthDeps => ({
  code2session: vi.fn(async () => "wx-openid"),
  findOperatorMemberships: lookup,
  now: () => NOW
});

const post = (app: ReturnType<typeof authRoutes>, path: string, body?: unknown) => app.request(path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

const customerBootstrap = {
  seller: { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" as const },
  batch: {
    id: 31,
    sellerId: 7,
    publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
    title: "一周预订",
    status: "open" as const,
    mealSlotIds: [11],
    createdById: 1
  }
};

const customerDeps = (overrides: Partial<CustomerAuthDeps> = {}): CustomerAuthDeps => ({
  code2session: vi.fn(async () => "wx-customer"),
  findCustomerSessionBootstrap: vi.fn(async () => customerBootstrap),
  now: () => NOW,
  ...overrides
});

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.KITH_INN_V1_ALLOW_DEV_LOGIN = "1";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("operator login", () => {
  it("authenticates the only active seller without exposing openid", async () => {
    const injected = deps();
    const response = await post(authRoutes(SECRET, injected), "/wx-login", { code: "wx-code" });
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; token: string; session: Record<string, unknown> };
    expect(body).toMatchObject({
      status: "authenticated",
      session: { operatorId: 1, sellerId: 7, sellerName: "桃子", role: "operator" }
    });
    expect(JSON.stringify(body)).not.toContain("openid");
    await expect(verifyOperatorToken(body.token, SECRET, NOW)).resolves.toMatchObject({ operatorId: 1, sellerId: 7 });
    expect(injected.code2session).toHaveBeenCalledWith("wx-code");
    expect(injected.findOperatorMemberships).toHaveBeenCalledWith({ openid: "wx-openid" });
  });

  it("requires explicit seller selection for multiple memberships", async () => {
    const response = await post(authRoutes(SECRET, deps(vi.fn(async () => memberships))), "/wx-login", { code: "wx-code" });
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; selectionToken: string; sellers: unknown[] };
    expect(body.status).toBe("seller-selection-required");
    expect(body.sellers).toEqual([
      { sellerId: 7, sellerName: "桃子" },
      { sellerId: 8, sellerName: "邻居" }
    ]);
    await expect(verifyOperatorSelectionToken(body.selectionToken, SECRET, NOW)).resolves.toMatchObject({
      choices: [{ operatorId: 1, sellerId: 7 }, { operatorId: 2, sellerId: 8 }]
    });
  });

  it("rejects unprovisioned identities and maps exchange/CMS failures", async () => {
    expect((await post(authRoutes(SECRET, deps(vi.fn(async () => []))), "/wx-login", { code: "wx-code" })).status).toBe(401);
    const exchangeFailure = deps();
    exchangeFailure.code2session = vi.fn(async () => { throw new Error("wechat down"); });
    expect((await post(authRoutes(SECRET, exchangeFailure), "/wx-login", { code: "wx-code" })).status).toBe(502);
    const cmsFailure = deps(vi.fn(async () => { throw new Error("cms down"); }));
    expect((await post(authRoutes(SECRET, cmsFailure), "/wx-login", { code: "wx-code" })).status).toBe(502);
  });

  it("validates JSON and code", async () => {
    const app = authRoutes(SECRET, deps());
    expect((await post(app, "/wx-login")).status).toBe(422);
    expect((await post(app, "/wx-login", { code: "" })).status).toBe(422);
    expect((await post(app, "/wx-login", { code: "x", openid: "leak" })).status).toBe(422);
    expect((await post(app, "/wx-login", [])).status).toBe(422);
  });
});

describe("dev login", () => {
  it("requires both non-production and the explicit allow flag", async () => {
    const app = authRoutes(SECRET, deps());
    delete process.env.KITH_INN_V1_ALLOW_DEV_LOGIN;
    expect((await post(app, "/dev-login", { openid: "seed" })).status).toBe(404);
    process.env.KITH_INN_V1_ALLOW_DEV_LOGIN = "1";
    process.env.NODE_ENV = "production";
    expect((await post(app, "/dev-login", { openid: "seed" })).status).toBe(404);
  });

  it("looks up the explicit seeded openid without calling WeChat", async () => {
    const injected = deps();
    const response = await post(authRoutes(SECRET, injected), "/dev-login", { openid: "seed-openid" });
    expect(response.status).toBe(200);
    expect(injected.findOperatorMemberships).toHaveBeenCalledWith({ openid: "seed-openid" });
    expect(injected.code2session).not.toHaveBeenCalled();
    expect((await post(authRoutes(SECRET, injected), "/dev-login", { openid: "" })).status).toBe(422);
  });

  it("maps a CMS failure without falling back to another identity flow", async () => {
    const injected = deps(vi.fn(async () => { throw new Error("cms down"); }));
    expect((await post(authRoutes(SECRET, injected), "/dev-login", { openid: "seed" })).status).toBe(502);
    expect(injected.code2session).not.toHaveBeenCalled();
  });

  it("rejects an unprovisioned dev identity", async () => {
    const injected = deps(vi.fn(async () => []));
    expect((await post(authRoutes(SECRET, injected), "/dev-login", { openid: "unknown" })).status).toBe(401);
  });
});

describe("seller selection", () => {
  it("revalidates the chosen membership and issues only that seller", async () => {
    const lookup = vi.fn(async (input: { openid?: string; operatorId?: string | number }) =>
      input.operatorId === 2 ? [memberships[1]!] : memberships
    );
    const app = authRoutes(SECRET, deps(lookup));
    const first = await post(app, "/wx-login", { code: "wx-code" });
    const { selectionToken } = await first.json() as { selectionToken: string };
    const selected = await post(app, "/select-seller", { selectionToken, sellerId: "8" });
    expect(selected.status).toBe(200);
    const body = await selected.json() as { token: string };
    await expect(verifyOperatorToken(body.token, SECRET, NOW)).resolves.toMatchObject({ operatorId: 2, sellerId: 8 });
    expect(lookup).toHaveBeenLastCalledWith({ operatorId: 2 });
  });

  it("rejects forged seller, wrong token kind, expiry and stopped membership", async () => {
    const app = authRoutes(SECRET, deps(vi.fn(async () => memberships)));
    const first = await post(app, "/wx-login", { code: "wx-code" });
    const { selectionToken } = await first.json() as { selectionToken: string };
    expect((await post(app, "/select-seller", { selectionToken, sellerId: 999 })).status).toBe(401);

    const direct = await post(authRoutes(SECRET, deps()), "/wx-login", { code: "wx-code" });
    const { token } = await direct.json() as { token: string };
    expect((await post(app, "/select-seller", { selectionToken: token, sellerId: 7 })).status).toBe(401);

    const expiredApp = authRoutes(SECRET, { ...deps(), now: () => NOW + 301 });
    expect((await post(expiredApp, "/select-seller", { selectionToken, sellerId: 7 })).status).toBe(401);

    const stopped = authRoutes(SECRET, deps(vi.fn(async () => [])));
    expect((await post(stopped, "/select-seller", { selectionToken, sellerId: 7 })).status).toBe(403);
    expect((await post(app, "/select-seller", { sellerId: 7 })).status).toBe(422);
    expect((await post(app, "/select-seller", { selectionToken, sellerId: 7.5 })).status).toBe(422);
    const brokenCms = authRoutes(SECRET, deps(vi.fn(async () => { throw new Error("cms down"); })));
    expect((await post(brokenCms, "/select-seller", { selectionToken, sellerId: 7 })).status).toBe(502);
  });
});

describe("customer session", () => {
  it("bootstraps before exchanging one code and returns no identity fields", async () => {
    const order: string[] = [];
    const injected = customerDeps({
      findCustomerSessionBootstrap: vi.fn(async () => { order.push("bootstrap"); return customerBootstrap; }),
      code2session: vi.fn(async () => { order.push("code2session"); return "wx-customer"; })
    });
    const response = await post(customerAuthRoutes(SECRET, injected), "/wx-session", {
      code: "one-time-code",
      batchPublicId: customerBootstrap.batch.publicId
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { token: string; session: Record<string, unknown> };
    expect(order).toEqual(["bootstrap", "code2session"]);
    expect(injected.code2session).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toMatch(/openid|sellerId/);
    expect(body.session).toMatchObject({ sellerName: "桃子", role: "customer" });
    await expect(verifyCustomerToken(body.token, SECRET, NOW)).resolves.toMatchObject({
      sellerId: 7,
      openid: "wx-customer"
    });
  });

  it("does not consume a code for an invalid batch and maps WeChat failures", async () => {
    const invalid = customerDeps({
      findCustomerSessionBootstrap: vi.fn(async () => { throw new CmsAuthError(404, "booking-batch-not-found"); })
    });
    expect((await post(customerAuthRoutes(SECRET, invalid), "/wx-session", {
      code: "one-time-code",
      batchPublicId: customerBootstrap.batch.publicId
    })).status).toBe(404);
    expect(invalid.code2session).not.toHaveBeenCalled();

    for (const [error, status] of [
      [new Code2SessionError("invalid", "bad code"), 401],
      [new Code2SessionError("unavailable", "timeout"), 502],
      [new Error("unknown"), 502]
    ] as const) {
      const deps = customerDeps({ code2session: vi.fn(async () => { throw error; }) });
      expect((await post(customerAuthRoutes(SECRET, deps), "/wx-session", {
        code: "secret-code",
        batchPublicId: customerBootstrap.batch.publicId
      })).status).toBe(status);
    }
  });

  it("keeps dev login behind both switches and never calls WeChat", async () => {
    const injected = customerDeps();
    delete process.env.KITH_INN_V1_ALLOW_DEV_LOGIN;
    expect((await post(customerAuthRoutes(SECRET, injected), "/dev-session", {
      openid: "dev-customer",
      batchPublicId: customerBootstrap.batch.publicId
    })).status).toBe(404);
    process.env.KITH_INN_V1_ALLOW_DEV_LOGIN = "1";
    process.env.NODE_ENV = "production";
    expect((await post(customerAuthRoutes(SECRET, injected), "/dev-session", {
      openid: "dev-customer",
      batchPublicId: customerBootstrap.batch.publicId
    })).status).toBe(404);
    process.env.NODE_ENV = "test";
    const response = await post(customerAuthRoutes(SECRET, injected), "/dev-session", {
      openid: "dev-customer",
      batchPublicId: customerBootstrap.batch.publicId
    });
    expect(response.status).toBe(200);
    expect(injected.code2session).not.toHaveBeenCalled();
    expect((await post(customerAuthRoutes(SECRET, injected), "/dev-session", {
      openid: "",
      batchPublicId: customerBootstrap.batch.publicId
    })).status).toBe(422);
  });

  it("validates inputs and maps inactive/malformed CMS responses", async () => {
    const app = customerAuthRoutes(SECRET, customerDeps());
    expect((await post(app, "/wx-session", { code: "x", batchPublicId: "bad" })).status).toBe(422);
    expect((await post(app, "/dev-session", { openid: "x", batchPublicId: "bad" })).status).toBe(422);
    for (const [error, status] of [
      [new CmsAuthError(403, "seller-inactive"), 403],
      [new Error("offline"), 502]
    ] as const) {
      const deps = customerDeps({ findCustomerSessionBootstrap: vi.fn(async () => { throw error; }) });
      expect((await post(customerAuthRoutes(SECRET, deps), "/dev-session", {
        openid: "dev-customer",
        batchPublicId: customerBootstrap.batch.publicId
      })).status).toBe(status);
    }
  });
});

describe("default dependencies", () => {
  it("wires the real boundaries and current clock", async () => {
    process.env.WX_APPID = "app";
    process.env.WX_SECRET = "secret";
    process.env.CMS_BASE_URL = "http://cms.test";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).includes("api.weixin.qq.com")
      ? new Response(JSON.stringify({ openid: "wx-openid" }))
      : new Response(JSON.stringify({ memberships: [memberships[0]] }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await post(authRoutes(SECRET), "/wx-login", { code: "wx-code" });
    expect(response.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("wires the real customer bootstrap and current clock", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(customerBootstrap)));
    vi.stubGlobal("fetch", fetchMock);
    const response = await post(customerAuthRoutes(SECRET), "/dev-session", {
      openid: "dev-customer",
      batchPublicId: customerBootstrap.batch.publicId
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { token: string };
    await expect(verifyCustomerToken(body.token, SECRET)).resolves.toMatchObject({ openid: "dev-customer" });
    vi.unstubAllGlobals();
  });
});
