import type { Offering } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { offeringsRoutes } from "./offerings";

const SECRET = "test-secret";

describe("GET /offerings", () => {
  it("returns the operator's offerings with a valid token (passthrough to cms)", async () => {
    const findOfferings = vi.fn(async (): Promise<Offering[]> => [
      { id: 1, name: "番茄炒蛋", kind: "component", seller: 7 },
    ]);
    const app = offeringsRoutes(SECRET, { findOfferings });
    const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
    const res = await app.request("/", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { offerings: unknown[] };
    expect(json.offerings).toHaveLength(1);
    // the operator JWT is forwarded to cms verbatim (seller-token passthrough)
    expect(findOfferings).toHaveBeenCalledWith(token);
  });

  it("401 without an Authorization header", async () => {
    const res = await offeringsRoutes(SECRET, { findOfferings: vi.fn() }).request("/");
    expect(res.status).toBe(401);
  });

  it("401 with a non-Bearer scheme", async () => {
    const res = await offeringsRoutes(SECRET, { findOfferings: vi.fn() }).request("/", {
      headers: { Authorization: "Basic xyz" },
    });
    expect(res.status).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const res = await offeringsRoutes(SECRET, { findOfferings: vi.fn() }).request("/", {
      headers: { Authorization: "Bearer not.a.real.token" },
    });
    expect(res.status).toBe(401);
  });
});
