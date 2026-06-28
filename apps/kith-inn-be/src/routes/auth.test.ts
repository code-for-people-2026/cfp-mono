import { describe, expect, it, vi } from "vitest";
import type { OperatorRecord } from "../lib/cms/client";
import { authRoutes, type AuthDeps } from "./auth";

const SECRET = "test-secret";
const activeOp: OperatorRecord = { id: 1, sellerId: 7, role: "owner", active: true };

const jsonHeaders = { "content-type": "application/json" };
const post = (app: ReturnType<typeof authRoutes>, body: unknown) =>
  app.request("/wx-login", { method: "POST", body: JSON.stringify(body), headers: jsonHeaders });
const postRaw = (app: ReturnType<typeof authRoutes>, body: string) =>
  app.request("/wx-login", { method: "POST", body });
const postDev = (app: ReturnType<typeof authRoutes>, body: unknown) =>
  app.request("/dev-login", { method: "POST", body: JSON.stringify(body), headers: jsonHeaders });

const deps = (
  overrides: Partial<AuthDeps> = {},
): AuthDeps => ({
  code2session: overrides.code2session ?? vi.fn(async () => "openid-1"),
  findOperatorByOpenid: overrides.findOperatorByOpenid ?? vi.fn(async () => activeOp),
});

describe("POST /auth/wx-login", () => {
  it("returns a token + operator on success", async () => {
    const res = await post(authRoutes(SECRET, deps()), { code: "the-code" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token: string; operator: unknown };
    expect(json.token).toBeTypeOf("string");
    expect(json.operator).toEqual({ id: 1, sellerId: 7, role: "owner" });
  });

  it("400 when code is missing", async () => {
    const res = await post(authRoutes(SECRET, deps()), {});
    expect(res.status).toBe(400);
  });

  it("400 when the body is not JSON", async () => {
    const res = await postRaw(authRoutes(SECRET, deps()), "not-json");
    expect(res.status).toBe(400);
  });

  it("401 when no operator matches the openid", async () => {
    const res = await post(
      authRoutes(SECRET, deps({ findOperatorByOpenid: vi.fn(async () => null) })),
      { code: "c" },
    );
    expect(res.status).toBe(401);
  });

  it("401 when the operator is inactive", async () => {
    const res = await post(
      authRoutes(
        SECRET,
        deps({ findOperatorByOpenid: vi.fn(async () => ({ ...activeOp, active: false })) }),
      ),
      { code: "c" },
    );
    expect(res.status).toBe(401);
  });

  it("502 when the wx exchange throws", async () => {
    const res = await post(
      authRoutes(SECRET, deps({ code2session: vi.fn(async () => { throw new Error("wx down"); }) })),
      { code: "c" },
    );
    expect(res.status).toBe(502);
  });
});

describe("POST /auth/dev-login", () => {
  it("returns a token for a known dev openid (non-production)", async () => {
    const res = await postDev(authRoutes(SECRET, deps()), { openid: "taozi-dev-openid" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token: string };
    expect(json.token).toBeTypeOf("string");
  });

  it("404 in production (disabled)", async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await postDev(authRoutes(SECRET, deps()), { openid: "x" });
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it("400 when openid is missing", async () => {
    const res = await postDev(authRoutes(SECRET, deps()), {});
    expect(res.status).toBe(400);
  });

  it("400 when the body is not JSON", async () => {
    const res = await authRoutes(SECRET, deps()).request("/dev-login", {
      method: "POST",
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("401 when operator not found", async () => {
    const res = await postDev(
      authRoutes(SECRET, deps({ findOperatorByOpenid: vi.fn(async () => null) })),
      { openid: "nobody" },
    );
    expect(res.status).toBe(401);
  });

  it("502 when cms lookup throws", async () => {
    const res = await postDev(
      authRoutes(
        SECRET,
        deps({ findOperatorByOpenid: vi.fn(async () => { throw new Error("cms down"); }) }),
      ),
      { openid: "x" },
    );
    expect(res.status).toBe(502);
  });
});
