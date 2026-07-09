import type { MenuPlan, MenuPlanView, Offering, Seller } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { CmsHttpError } from "../lib/cms/orders";
import type { MenuPlanUpsertInput } from "../lib/cms/menuPlans";
import { menuRoutes, type MenuDeps } from "./menu";

const SECRET = "test-secret";
const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
const auth = () => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const dish = (id: string, category: Offering["category"], mainIngredient: string): Offering =>
  ({ id, name: `d${id}`, kind: "component", category, mainIngredient, active: true, seller: 7 }) as Offering;

/** Feasible pool (12 meat / 12 veg / 4 soup, distinct 主料). */
const feasible = (): Offering[] => [
  ...["牛", "鸡", "鱼", "猪", "鸭", "羊", "虾", "鹅", "兔", "驴", "鹿", "鸽"].map((mi, i) => dish(`m${i + 1}`, "meat", mi)),
  ...["青菜", "豆腐", "土豆", "茄子", "瓜", "豆角", "花菜", "菇", "笋", "木耳", "藕", "荷兰豆"].map((mi, i) => dish(`v${i + 1}`, "veg", mi)),
  ...[1, 2, 3, 4].map((n) => dish(`s${n}`, "soup", `汤料${n}`)),
];

const SELLER: Seller = { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" };

/** A populated plan (slot+offerings depth:1) with 2 meat / 2 veg / 1 soup. */
const fullPlan = (over: Partial<MenuPlan> & { status?: "draft" | "published" } = {}): MenuPlan =>
  ({
    id: 501,
    slot: { id: 91, date: "2026-07-08", occasion: "lunch", granularity: "occasion", status: "open", seller: 7 } as MenuPlan["slot"],
    offerings: [dish("m1", "meat", "牛"), dish("m2", "meat", "鸡"), dish("v1", "veg", "青菜"), dish("v2", "veg", "豆腐"), dish("s1", "soup", "汤料1")],
    status: "draft",
    seller: 7,
    ...over,
  }) as MenuPlan;

/** Mock deps; tests override the fns they exercise. upsert/patch echo back a viewable plan. */
const mockDeps = (overrides: Partial<MenuDeps> = {}): MenuDeps => ({
  findOfferings: vi.fn(async () => feasible()),
  listMenuPlans: vi.fn(async () => []),
  getMenuPlan: vi.fn(async () => fullPlan()),
  upsertMenuPlans: vi.fn(async (_jwt: string, items: MenuPlanUpsertInput[]) =>
    items.map(
      (it, i) =>
        ({
          id: 500 + i,
          slot: { id: 91 + i, date: it.date, occasion: it.occasion, status: "open", seller: 7 },
          offerings: it.offerings.map((id) => dish(String(id), "meat", `料${id}`)),
          status: it.status,
          seller: 7,
        }) as unknown as MenuPlan,
    ),
  ),
  patchMenuPlan: vi.fn(async (_jwt: string, _id, patch) => ({ ...fullPlan(), ...patch }) as MenuPlan),
  getSeller: vi.fn(async () => SELLER),
  ...overrides,
});

describe("GET /menu/week", () => {
  it("generates a 10-slot week menu", async () => {
    const app = menuRoutes(SECRET, mockDeps());
    const res = await app.request("/week", { headers: auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; menu?: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.menu).toHaveLength(10);
  });

  it("returns pool-too-small", async () => {
    const app = menuRoutes(SECRET, mockDeps({ findOfferings: vi.fn(async () => [dish("m1", "meat", "牛")]) }));
    const json = (await (await app.request("/week", { headers: auth() })).json()) as { ok: boolean; missing: { category: string } };
    expect(json.ok).toBe(false);
    expect(json.missing.category).toBe("meat");
  });

  it("401 without a token", async () => {
    expect((await menuRoutes(SECRET, mockDeps()).request("/week")).status).toBe(401);
  });
});

describe("GET /menu/plans", () => {
  it("returns view-shaped plans for a date range", async () => {
    const listMenuPlans = vi.fn(async () => [fullPlan()]);
    const app = menuRoutes(SECRET, mockDeps({ listMenuPlans }));
    const res = await app.request("/plans?from=2026-07-06&to=2026-07-10", { headers: auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { plans: MenuPlanView[] };
    expect(json.plans[0]!.planId).toBe(501);
    expect(json.plans[0]!.dishes).toHaveLength(5);
    expect(listMenuPlans).toHaveBeenCalledWith(token, { from: "2026-07-06", to: "2026-07-10" });
  });

  it("accepts ?date= (single day)", async () => {
    const app = menuRoutes(SECRET, mockDeps({ listMenuPlans: vi.fn(async () => []) }));
    const res = await app.request("/plans?date=2026-07-08", { headers: auth() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { plans: unknown[] }).plans).toEqual([]);
  });

  it("400 without date or from+to", async () => {
    expect((await menuRoutes(SECRET, mockDeps()).request("/plans", { headers: auth() })).status).toBe(400);
  });

  it("502 when listMenuPlans throws (cms error)", async () => {
    const app = menuRoutes(SECRET, mockDeps({ listMenuPlans: vi.fn(async () => { throw new Error("boom"); }) }));
    expect((await app.request("/plans?date=2026-07-08", { headers: auth() })).status).toBe(502);
  });
});

describe("POST /menu/generate", () => {
  it("writes draft plans for the targets", async () => {
    const upsertMenuPlans = vi.fn(async (_jwt: string, items: MenuPlanUpsertInput[]) =>
      items.map((it, i) => ({ id: 500 + i, slot: { id: 91 + i, date: it.date, occasion: it.occasion }, offerings: [], status: "draft", seller: 7 }) as unknown as MenuPlan),
    );
    const app = menuRoutes(SECRET, mockDeps({ upsertMenuPlans }));
    const res = await app.request("/generate", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ targets: [{ date: "2026-07-08", occasion: "lunch" }, { date: "2026-07-08", occasion: "dinner" }] }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { plans: MenuPlanView[] }).plans).toHaveLength(2);
    expect(upsertMenuPlans).toHaveBeenCalledOnce();
  });

  it("409 when a target is already published and no force", async () => {
    const published = fullPlan({ status: "published" });
    (published.slot as { date: string }).date = "2026-07-08T00:00:00.000Z";
    const app = menuRoutes(SECRET, mockDeps({ listMenuPlans: vi.fn(async () => [published]) }));
    const res = await app.request("/generate", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ targets: [{ date: "2026-07-08", occasion: "lunch" }] }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("plan-published");
  });

  it("published target WITH force proceeds", async () => {
    const upsertMenuPlans = vi.fn(async (_jwt: string, items: MenuPlanUpsertInput[]) =>
      items.map((it, i) => ({ id: 500 + i, slot: { date: it.date, occasion: it.occasion }, offerings: [], status: "draft", seller: 7 }) as unknown as MenuPlan),
    );
    const app = menuRoutes(SECRET, mockDeps({ listMenuPlans: vi.fn(async () => [fullPlan({ status: "published" })]), upsertMenuPlans }));
    const res = await app.request("/generate", { method: "POST", headers: auth(), body: JSON.stringify({ targets: [{ date: "2026-07-08", occasion: "lunch" }], force: true }) });
    expect(res.status).toBe(200);
  });

  it("pool-too-small → {ok:false}", async () => {
    const app = menuRoutes(SECRET, mockDeps({ findOfferings: vi.fn(async () => [dish("m1", "meat", "牛")]) }));
    const json = (await (await app.request("/generate", { method: "POST", headers: auth(), body: JSON.stringify({ targets: [{ date: "2026-07-08", occasion: "lunch" }] }) })).json()) as { ok: boolean };
    expect(json.ok).toBe(false);
  });

  it("400 without targets / 401 without token", async () => {
    expect((await menuRoutes(SECRET, mockDeps()).request("/generate", { method: "POST", headers: auth(), body: JSON.stringify({}) })).status).toBe(400);
    expect((await menuRoutes(SECRET, mockDeps()).request("/generate", { method: "POST" })).status).toBe(401);
  });

  it("400 on non-JSON body (parse fallback)", async () => {
    expect((await menuRoutes(SECRET, mockDeps()).request("/generate", { method: "POST", headers: auth(), body: "not-json" })).status).toBe(400);
  });

  it("502 when findOfferings throws (cms error)", async () => {
    const app = menuRoutes(SECRET, mockDeps({ findOfferings: vi.fn(async () => { throw new Error("boom"); }) }));
    expect((await app.request("/generate", { method: "POST", headers: auth(), body: JSON.stringify({ targets: [{ date: "2026-07-08", occasion: "lunch" }] }) })).status).toBe(502);
  });
});

describe("POST /menu/plans/:id/swap", () => {
  it("auto-swaps a dish (draft) and patches offerings", async () => {
    const patchMenuPlan = vi.fn(async (_jwt: string, _id, patch) => ({ ...fullPlan(), offerings: [], ...patch }) as MenuPlan);
    const app = menuRoutes(SECRET, mockDeps({ patchMenuPlan }));
    const res = await app.request("/plans/501/swap", { method: "POST", headers: auth(), body: JSON.stringify({ dishId: "m1" }) });
    expect(res.status).toBe(200);
    expect(patchMenuPlan).toHaveBeenCalledWith(token, "501", expect.objectContaining({ offerings: expect.any(Array) }));
  });

  it("specified swap with 主料 clash → warning in response", async () => {
    // m1(牛) → m2(鸡): but m2 already in slot → inSlotOther clash → warning
    const app = menuRoutes(SECRET, mockDeps());
    const res = await app.request("/plans/501/swap", { method: "POST", headers: auth(), body: JSON.stringify({ dishId: "m1", replacementId: "m2" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { warning?: string }).warning).toBe("会和近期主料重复，仍要换吗？");
  });

  it("specified swap with bad replacement → 400", async () => {
    const app = menuRoutes(SECRET, mockDeps());
    const res = await app.request("/plans/501/swap", { method: "POST", headers: auth(), body: JSON.stringify({ dishId: "m1", replacementId: "zzz" }) });
    expect(res.status).toBe(400);
  });

  it("published plan without force → 409", async () => {
    const app = menuRoutes(SECRET, mockDeps({ getMenuPlan: vi.fn(async () => fullPlan({ status: "published" })) }));
    const res = await app.request("/plans/501/swap", { method: "POST", headers: auth(), body: JSON.stringify({ dishId: "m1" }) });
    expect(res.status).toBe(409);
  });

  it("published plan with force → clears publishText (single patch)", async () => {
    const patchMenuPlan = vi.fn(async (_jwt: string, _id, patch) => ({ ...fullPlan({ status: "published" }), ...patch }) as MenuPlan);
    const app = menuRoutes(SECRET, mockDeps({ getMenuPlan: vi.fn(async () => fullPlan({ status: "published", publishText: "旧" })), patchMenuPlan }));
    const res = await app.request("/plans/501/swap", { method: "POST", headers: auth(), body: JSON.stringify({ dishId: "m1", replacementId: "m3", force: true }) });
    expect(res.status).toBe(200);
    expect(patchMenuPlan).toHaveBeenCalledWith(token, "501", expect.objectContaining({ publishText: null, offerings: expect.any(Array) }));
  });

  it("404 when plan not owned (cms 404)", async () => {
    const app = menuRoutes(SECRET, mockDeps({ getMenuPlan: vi.fn(async () => { throw new CmsHttpError(404, "get"); }) }));
    expect((await app.request("/plans/501/swap", { method: "POST", headers: auth(), body: JSON.stringify({ dishId: "m1" }) })).status).toBe(404);
  });

  it("401 without token", async () => {
    expect((await menuRoutes(SECRET, mockDeps()).request("/plans/501/swap", { method: "POST" })).status).toBe(401);
  });

  it("400 on non-JSON body (parse fallback)", async () => {
    expect((await menuRoutes(SECRET, mockDeps()).request("/plans/501/swap", { method: "POST", headers: auth(), body: "not-json" })).status).toBe(400);
  });

  it("auto-swap with no alternative in pool → 409", async () => {
    // pool has only m1 (the dish being swapped) as meat → no meat alternative
    const app = menuRoutes(SECRET, mockDeps({ findOfferings: vi.fn(async () => [dish("m1", "meat", "牛"), dish("v1", "veg", "青菜"), dish("s1", "soup", "汤料1")]) }));
    const res = await app.request("/plans/501/swap", { method: "POST", headers: auth(), body: JSON.stringify({ dishId: "m1" }) });
    expect(res.status).toBe(409);
  });
});

describe("POST /menu/plans/:id/publish", () => {
  it("draft + no publishText → status=published + 生成接龙文案 (single patch)", async () => {
    const patchMenuPlan = vi.fn(async (_jwt: string, _id, patch) => ({ ...fullPlan({ status: "published" }), ...patch }) as MenuPlan);
    const app = menuRoutes(SECRET, mockDeps({ patchMenuPlan }));
    const res = await app.request("/plans/501/publish", { method: "POST", headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publishText: string };
    expect(body.publishText).toContain("#接龙");
    expect(body.publishText).toContain("7.8号星期");
    expect(body.publishText).toContain("午餐预定接龙");
    expect(body.publishText).toContain("例 桃子");
    expect(patchMenuPlan).toHaveBeenCalledWith(token, "501", expect.objectContaining({ status: "published", publishText: expect.any(String) }));
  });

  it("published + cached publishText → no patch, return cache", async () => {
    const patchMenuPlan = vi.fn(async () => fullPlan());
    const app = menuRoutes(SECRET, mockDeps({ getMenuPlan: vi.fn(async () => fullPlan({ status: "published", publishText: "缓存的文案" })), patchMenuPlan }));
    const res = await app.request("/plans/501/publish", { method: "POST", headers: auth() });
    expect(((await res.json()) as { publishText: string }).publishText).toBe("缓存的文案");
    expect(patchMenuPlan).not.toHaveBeenCalled();
  });

  it("404 when plan not owned", async () => {
    const app = menuRoutes(SECRET, mockDeps({ getMenuPlan: vi.fn(async () => { throw new CmsHttpError(404, "get"); }) }));
    expect((await app.request("/plans/501/publish", { method: "POST", headers: auth() })).status).toBe(404);
  });

  it("401 without token", async () => {
    expect((await menuRoutes(SECRET, mockDeps()).request("/plans/501/publish", { method: "POST" })).status).toBe(401);
  });
});
