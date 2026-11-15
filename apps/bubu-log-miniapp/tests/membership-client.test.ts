import { describe, expect, it, vi } from "vitest";
import { createBubuApi, type Transport } from "../src/api/client";
import { ResponseFormatError } from "../src/api/contracts";
import { decodeMembership, type MembershipStatus } from "../src/membership/contracts";

const babyId = "baby /一";
const membership: MembershipStatus = { babyId, version: 0, status: "free", label: "限时免费", message: "当前可免费使用宝宝服务。", startsAt: null, endsAt: null,
  entitlements: { chat: true, collection: true, history: true }, payment: { enabled: false } };
function setup(transport: Transport, authMode: "sidecar" | "legacy" = "sidecar") {
  return createBubuApi({ transport, native: false, origin: "", authMode,
    storage: { get: () => undefined, set: () => {}, remove: () => {} } });
}

describe("baby membership HTTP boundary", () => {
  it("reads the scoped server decision through the identity session and preserves an unconfigured deadline", async () => {
    const api = setup(async request => {
      expect(request.url).toBe("/api/app/membership?babyId=baby%20%2F%E4%B8%80");
      expect(request.method).toBe("GET");
      expect(request.headers["x-baby-id"]).toBe(babyId);
      expect(request.headers["X-Bubu-Client"]).toBe("browser");
      expect(request.credentials).toBe("include");
      return { status: 200, data: { ...membership, configured: false, checkedAt: "2026-10-23T00:00:00Z" } };
    });
    expect(await api.getMembership(babyId)).toEqual(membership);
  });

  it("does not recalculate the service decision from a past date or turn a pause into expired access", () => {
    const free = { ...membership, endsAt: "2000-01-01T00:00:00Z", version: 4 };
    expect(decodeMembership(free, babyId)).toEqual(free);
    const paused = { ...free, status: "paused", label: "服务已暂停", message: "运营已暂停服务，恢复后可继续。", entitlements: { chat: false, collection: false, history: true } };
    expect(decodeMembership(paused, babyId)).toEqual(paused);
  });

  it.each([
    { babyId: "another-baby" }, { version: -1 }, { status: "paid" }, { endsAt: "yesterday" }, { startsAt: undefined }, { label: "" },
    { entitlements: { chat: "true", collection: true, history: true } }, { entitlements: { chat: true, collection: true, history: false } }, { payment: { enabled: true } },
  ])("rejects mismatched or malformed service data without inventing free access: %j", async patch => {
    const api = setup(async () => ({ status: 200, data: { ...membership, ...patch } }));
    await expect(api.getMembership(babyId)).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it("distinguishes state-read failure from a successful free response", async () => {
    const api = setup(async () => ({ status: 503, data: { code: "MEMBERSHIP_UNAVAILABLE", error: "暂时无法读取服务状态" } }));
    await expect(api.getMembership(babyId)).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_UNAVAILABLE" });
  });

  it("preserves service pause failures without clearing the baby's private drafts", async () => {
    const revoked = vi.fn();
    const api = createBubuApi({ native: false, origin: "", authMode: "sidecar", onAccessRevoked: revoked,
      storage: { get: () => undefined, set: () => {}, remove: () => {} },
      transport: async () => ({ status: 423, data: { code: "SERVICE_PAUSED", error: "服务已暂停，恢复后可以继续。" } }) });
    await expect(api.sendChat({ babyId, requestId: "original-request", text: "刚才喝了奶", attachmentIds: [], context: { viewedDate: "2026-10-23" } })).rejects.toMatchObject({ status: 423, code: "SERVICE_PAUSED" });
    expect(revoked).not.toHaveBeenCalled();
  });

  it("does not request independent membership or manufacture authorization in legacy mode", async () => {
    const transport = vi.fn();
    await expect(setup(transport, "legacy").getMembership(babyId)).rejects.toMatchObject({ code: "IDENTITY_NOT_ENABLED" });
    expect(transport).not.toHaveBeenCalled();
  });
});
