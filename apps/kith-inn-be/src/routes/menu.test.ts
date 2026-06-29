import type { Offering } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { menuRoutes } from "./menu";

const SECRET = "test-secret";
const auth = async () => ({ Authorization: `Bearer ${await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET)}` });
const dish = (id: string, category: Offering["category"], mainIngredient: string): Offering =>
  ({ id, name: `d${id}`, kind: "component", category, mainIngredient, active: true, seller: 7 }) as Offering;

/** Feasible pool (12 meat / 12 veg / 4 soup, distinct 主料) — see PR3 core tests. */
const feasible = (): Offering[] => [
  ...["牛", "鸡", "鱼", "猪", "鸭", "羊", "虾", "鹅", "兔", "驴", "鹿", "鸽"].map((mi, i) => dish(`m${i + 1}`, "meat", mi)),
  ...["青菜", "豆腐", "土豆", "茄子", "瓜", "豆角", "花菜", "菇", "笋", "木耳", "藕", "荷兰豆"].map((mi, i) => dish(`v${i + 1}`, "veg", mi)),
  ...[1, 2, 3, 4].map((n) => dish(`s${n}`, "soup", `汤料${n}`)),
];

describe("GET /menu/week", () => {
  it("generates a 10-slot week menu from the seller's offerings", async () => {
    const findOfferings = vi.fn(async () => feasible());
    const app = menuRoutes(SECRET, { findOfferings });
    const res = await app.request("/week", { headers: await auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; menu?: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.menu).toHaveLength(10);
  });

  it("returns pool-too-small when the pool can't fill the structure", async () => {
    const findOfferings = vi.fn(async () => [dish("m1", "meat", "牛")]); // 1 meat, need 2
    const app = menuRoutes(SECRET, { findOfferings });
    const res = await app.request("/week", { headers: await auth() });
    const json = (await res.json()) as { ok: boolean; missing: { category: string } };
    expect(json.ok).toBe(false);
    expect(json.missing.category).toBe("meat");
  });

  it("401 without a token", async () => {
    expect((await menuRoutes(SECRET, { findOfferings: vi.fn() }).request("/week")).status).toBe(401);
  });
});
