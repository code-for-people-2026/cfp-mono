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
