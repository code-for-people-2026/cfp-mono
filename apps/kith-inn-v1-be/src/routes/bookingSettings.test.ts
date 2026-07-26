import type { SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { describe, expect, it, vi } from "vitest";
import { CmsSellerError } from "../lib/cms/seller";
import { bookingSettingsRoutes, type BookingSettingsDeps } from "./bookingSettings";

const SECRET = "v1-secret";
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const seller: SellerSnapshot = { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" };
const auth = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
const deps = (overrides: Partial<BookingSettingsDeps> = {}): BookingSettingsDeps => ({
  getSeller: vi.fn(async () => seller),
  updateSettings: vi.fn(async (_token, input) => input),
  ...overrides
});

describe("merchant booking settings routes", () => {
  it("reads and updates only the authenticated seller settings", async () => {
    const injected = deps();
    const app = bookingSettingsRoutes(SECRET, injected);
    await expect((await app.request("/", { headers: auth })).json())
      .resolves.toEqual({ defaultPriceCents: 3000 });
    const response = await app.request("/", {
      method: "PATCH", headers: auth, body: JSON.stringify({ defaultPriceCents: 3200 })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ defaultPriceCents: 3200 });
    expect(injected.updateSettings).toHaveBeenCalledWith(token, { defaultPriceCents: 3200 });
  });

  it("validates input and maps CMS failures", async () => {
    const app = bookingSettingsRoutes(SECRET, deps());
    expect((await app.request("/", { method: "PATCH", headers: auth, body: "{" })).status).toBe(400);
    expect((await app.request("/", {
      method: "PATCH", headers: auth, body: JSON.stringify({ defaultPriceCents: -1 })
    })).status).toBe(422);
    const failed = bookingSettingsRoutes(SECRET, deps({
      getSeller: vi.fn(async () => { throw new CmsSellerError(403, "seller-inactive", "停用"); })
    }));
    expect((await failed.request("/", { headers: auth })).status).toBe(403);
    const updateFailed = bookingSettingsRoutes(SECRET, deps({
      updateSettings: vi.fn(async () => { throw new CmsSellerError(500, "write-failed", "失败"); })
    }));
    expect((await updateFailed.request("/", {
      method: "PATCH", headers: auth, body: JSON.stringify({ defaultPriceCents: 3200 })
    })).status).toBe(502);
    const unavailable = bookingSettingsRoutes(SECRET, deps({
      getSeller: vi.fn(async () => { throw new Error("offline"); })
    }));
    expect((await unavailable.request("/", { headers: auth })).status).toBe(502);
  });
});
