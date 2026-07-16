import { describe, expect, it, vi } from "vitest";
import type { CustomerProfile, CustomerProfileCreate } from "@cfp/kith-inn-v1-shared";
import { issueCustomerToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CmsCustomerProfileError } from "../lib/cms/customerProfiles";
import { customerProfileRoutes, type CustomerProfileRouteDeps } from "./customerProfiles";

const SECRET = "v1-secret";
const token = await issueCustomerToken({ sellerId: 7, openid: "wx-customer" }, SECRET);
const operatorToken = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const profile: CustomerProfile = {
  id: 21, sellerId: 7, displayName: "王阿姨", address: "3A-1201", active: true
};

function deps(overrides: Partial<CustomerProfileRouteDeps> = {}): CustomerProfileRouteDeps {
  return {
    listProfiles: vi.fn(async () => [profile]),
    createProfile: vi.fn(async (_token: string, input: CustomerProfileCreate) => ({ ...profile, id: 22, ...input })),
    deactivateProfile: vi.fn(async () => ({ ...profile, active: false })),
    ...overrides
  };
}

function request(app: ReturnType<typeof customerProfileRoutes>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
}

describe("customer profile routes", () => {
  it("accepts only customer sessions and lists owner-safe profiles", async () => {
    const injected = deps();
    const app = customerProfileRoutes(SECRET, injected);
    const response = await request(app, "/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [profile] });
    expect(injected.listProfiles).toHaveBeenCalledWith(token);
    expect((await app.request("/")).status).toBe(401);
    expect((await request(app, "/", { headers: { Authorization: `Bearer ${operatorToken}` } })).status).toBe(401);
  });

  it("creates a strict profile without accepting owner fields", async () => {
    const injected = deps();
    const app = customerProfileRoutes(SECRET, injected);
    const response = await request(app, "/", {
      method: "POST", body: JSON.stringify({ displayName: " 李叔 ", address: " 2B-901 " })
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ doc: { id: 22, displayName: "李叔", address: "2B-901" } });
    expect(injected.createProfile).toHaveBeenCalledWith(token, { displayName: "李叔", address: "2B-901" });
    expect((await request(app, "/", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request(app, "/", {
      method: "POST", body: JSON.stringify({ displayName: "王", address: "3A", openid: "leak", sellerId: 9 })
    })).status).toBe(422);
  });

  it("preserves actionable CMS errors and sanitizes unavailable dependencies", async () => {
    for (const [error, status, code] of [
      [new CmsCustomerProfileError(409, "profile-conflict", "冲突"), 409, "profile-conflict"],
      [new CmsCustomerProfileError(500, "database-detail", "secret"), 502, "cms-unavailable"],
      [new Error("secret"), 502, "cms-unavailable"]
    ] as const) {
      const app = customerProfileRoutes(SECRET, deps({ listProfiles: vi.fn(async () => { throw error; }) }));
      const response = await request(app, "/");
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: code });
    }
    const app = customerProfileRoutes(SECRET, deps({
      createProfile: vi.fn(async () => { throw new CmsCustomerProfileError(422, "profile-invalid", "无效"); })
    }));
    expect((await request(app, "/", {
      method: "POST", body: JSON.stringify({ displayName: "王", address: "3A" })
    })).status).toBe(422);
  });

  it("strictly deactivates an owned profile", async () => {
    const injected = deps();
    const app = customerProfileRoutes(SECRET, injected);
    const response = await request(app, "/21/deactivate", { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ doc: { id: 21, active: false } });
    expect(injected.deactivateProfile).toHaveBeenCalledWith(token, "21");
    expect((await request(app, "/21/deactivate", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request(app, "/21/deactivate", { method: "POST", body: JSON.stringify({ active: false }) })).status).toBe(422);
    const failed = customerProfileRoutes(SECRET, deps({ deactivateProfile: vi.fn(async () => { throw new Error("offline"); }) }));
    expect((await request(failed, "/21/deactivate", { method: "POST", body: "{}" })).status).toBe(502);
  });
});
