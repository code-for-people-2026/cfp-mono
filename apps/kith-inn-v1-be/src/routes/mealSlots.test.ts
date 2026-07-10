import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MealSlot,
  MealSlotCreate,
  MealSlotUpdate,
  Offering
} from "@cfp/kith-inn-v1-shared";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CmsMealSlotError } from "../lib/cms/mealSlots";
import { CmsOfferingError } from "../lib/cms/offerings";
import { mealSlotsRoutes, type MealSlotsDeps } from "./mealSlots";

const SECRET = "v1-secret";
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const NOW = "2026-07-10T01:00:00.000Z";
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});
const offerings: Offering[] = [
  { id: 1, sellerId: 7, name: "荤一", mainIngredient: "牛肉", category: "meat", active: true },
  { id: 2, sellerId: 7, name: "荤二", mainIngredient: "猪肉", category: "meat", active: true },
  { id: 3, sellerId: 7, name: "素一", mainIngredient: "青菜", category: "veg", active: true },
  { id: 4, sellerId: 7, name: "素二", mainIngredient: "豆腐", category: "veg", active: true },
  { id: 5, sellerId: 7, name: "汤一", mainIngredient: "番茄", category: "soup", active: true },
  { id: 6, sellerId: 7, name: "汤二", mainIngredient: "冬瓜", category: "soup", active: true }
];
const menuItems = offerings.slice(0, 5).map((item) => ({
  offeringId: item.id,
  nameSnapshot: item.name,
  mainIngredientSnapshot: item.mainIngredient,
  categorySnapshot: item.category
}));
const existing: MealSlot = {
  id: 11,
  sellerId: 7,
  date: "2026-07-13",
  occasion: "lunch",
  menuItems,
  orderStatus: "draft",
  priceCents: null,
  generatedAt: NOW
};

function deps(overrides: Partial<MealSlotsDeps> = {}): MealSlotsDeps {
  return {
    listOfferings: vi.fn(async () => offerings),
    listMealSlots: vi.fn(async () => []),
    getMealSlot: vi.fn(async () => existing),
    createMealSlot: vi.fn(async (_token: string, input: MealSlotCreate) => ({
      id: 20,
      sellerId: 7,
      orderStatus: "draft" as const,
      priceCents: null,
      ...input
    } as MealSlot)),
    updateMealSlot: vi.fn(async (_token: string, id: string | number, patch: MealSlotUpdate) => ({
      ...existing,
      id,
      ...patch
    })),
    now: () => NOW,
    random: () => 0,
    ...overrides
  };
}

function request(app: ReturnType<typeof mealSlotsRoutes>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
}

describe("merchant meal-slot list", () => {
  it("validates the date range, forwards the operator token and protects the route", async () => {
    const incomplete = { ...existing, id: 12, menuItems: existing.menuItems.slice(0, 1) };
    const listMealSlots = vi.fn(async () => [existing, incomplete]);
    const app = mealSlotsRoutes(SECRET, deps({ listMealSlots }));
    const response = await request(app, "/?from=2026-07-01&to=2026-07-31");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [existing] });
    expect(listMealSlots).toHaveBeenCalledWith(token, { from: "2026-07-01", to: "2026-07-31" });
    expect((await request(app, "/?from=2026-07-01&to=2026-08-01")).status).toBe(400);
    expect((await app.request("/?from=2026-07-01&to=2026-07-31")).status).toBe(401);
  });
});

describe("menu generation route", () => {
  it("returns every existing target before writes and succeeds when explicitly retried with replace", async () => {
    const incomplete = { ...existing, menuItems: existing.menuItems.slice(0, 1) };
    const injected = deps({ listMealSlots: vi.fn(async () => [incomplete]) });
    const app = mealSlotsRoutes(SECRET, injected);
    const input = { targets: [{ date: existing.date, occasion: existing.occasion }] };
    const conflict = await request(app, "/generate-menus", { method: "POST", body: JSON.stringify(input) });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: "meal-slots-exist",
      existingTargets: input.targets
    });
    expect(injected.createMealSlot).not.toHaveBeenCalled();
    expect(injected.updateMealSlot).not.toHaveBeenCalled();

    const replaced = await request(app, "/generate-menus", {
      method: "POST",
      body: JSON.stringify({ ...input, replaceExisting: true })
    });
    expect(replaced.status).toBe(200);
    expect(injected.updateMealSlot).toHaveBeenCalledWith(token, 11, {
      menuItems: expect.arrayContaining([expect.objectContaining({ categorySnapshot: "soup" })]),
      generatedAt: NOW
    });
  });

  it("checks the complete active pool before writing anything", async () => {
    const injected = deps({ listOfferings: vi.fn(async () => offerings.filter(({ category }) => category !== "soup")) });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
      method: "POST",
      body: JSON.stringify({ targets: [{ date: "2026-07-13", occasion: "lunch" }] })
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "offering-pool-insufficient",
      shortages: [{ category: "soup", required: 1, available: 0 }]
    });
    expect(injected.createMealSlot).not.toHaveBeenCalled();
    expect(injected.updateMealSlot).not.toHaveBeenCalled();
  });

  it("creates new targets, updates existing targets and returns relaxation details", async () => {
    const listMealSlots = vi.fn(async () => [existing]);
    const injected = deps({ listMealSlots });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
      method: "POST",
      body: JSON.stringify({
        targets: [
          { date: "2026-07-13", occasion: "lunch" },
          { date: "2026-07-13", occasion: "dinner" }
        ],
        replaceExisting: true
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.docs).toHaveLength(2);
    expect(body.relaxedRules).toContain("same-day-main-ingredient");
    expect(injected.updateMealSlot).toHaveBeenCalledOnce();
    expect(injected.createMealSlot).toHaveBeenCalledWith(token, expect.objectContaining({
      date: "2026-07-13",
      occasion: "dinner",
      menuItems: expect.any(Array),
      generatedAt: NOW
    }));
    expect(listMealSlots).toHaveBeenCalledWith(token, { from: "2026-07-06", to: "2026-07-13" });
  });

  it("splits distant target history into CMS ranges of at most 31 calendar days", async () => {
    const listMealSlots = vi.fn(async () => []);
    const injected = deps({ listMealSlots });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
      method: "POST",
      body: JSON.stringify({
        targets: [
          { date: "2026-07-01", occasion: "lunch" },
          { date: "2026-07-25", occasion: "lunch" },
          { date: "2026-07-31", occasion: "dinner" }
        ]
      })
    });
    expect(response.status).toBe(200);
    expect(listMealSlots).toHaveBeenNthCalledWith(1, token, { from: "2026-06-24", to: "2026-07-01" });
    expect(listMealSlots).toHaveBeenNthCalledWith(2, token, { from: "2026-07-18", to: "2026-07-31" });
  });

  it("recovers a concurrent create conflict only after explicit replace confirmation", async () => {
    const listMealSlots = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existing]);
    const injected = deps({
      listMealSlots,
      createMealSlot: vi.fn(async () => { throw new CmsMealSlotError(409, "meal-slot-conflict", "冲突"); })
    });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
      method: "POST",
      body: JSON.stringify({
        targets: [{ date: existing.date, occasion: existing.occasion }],
        replaceExisting: true
      })
    });
    expect(response.status).toBe(200);
    expect(injected.updateMealSlot).toHaveBeenCalledWith(token, existing.id, expect.objectContaining({ generatedAt: NOW }));
    expect(listMealSlots).toHaveBeenNthCalledWith(2, token, { from: existing.date, to: existing.date });
  });

  it("does not turn unconfirmed or unresolved create conflicts into overwrites", async () => {
    for (const [replaceExisting, raceResult] of [[false, []], [true, []]] as const) {
      const listMealSlots = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(raceResult);
      const injected = deps({
        listMealSlots,
        createMealSlot: vi.fn(async () => { throw new CmsMealSlotError(409, "meal-slot-conflict", "冲突"); })
      });
      const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
        method: "POST",
        body: JSON.stringify({
          targets: [{ date: "2026-07-13", occasion: "lunch" }],
          replaceExisting
        })
      });
      expect(response.status).toBe(409);
      expect(injected.updateMealSlot).not.toHaveBeenCalled();
    }
  });

  it("maps generic create failures without retrying", async () => {
    const injected = deps({ createMealSlot: vi.fn(async () => { throw new Error("offline"); }) });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
      method: "POST",
      body: JSON.stringify({ targets: [{ date: "2026-07-13", occasion: "lunch" }], replaceExisting: true })
    });
    expect(response.status).toBe(502);
  });

  it("rejects malformed JSON, invalid targets and seller injection", async () => {
    const app = mealSlotsRoutes(SECRET, deps());
    expect((await request(app, "/generate-menus", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request(app, "/generate-menus", {
      method: "POST",
      body: JSON.stringify({ targets: [] })
    })).status).toBe(422);
    expect((await request(app, "/generate-menus", {
      method: "POST",
      body: JSON.stringify({ seller: 99, targets: [{ date: "2026-07-13", occasion: "lunch" }] })
    })).status).toBe(422);
  });
});

describe("menu item swap route", () => {
  it("updates only the selected snapshot and keeps the original when no candidate exists", async () => {
    const noCandidate = deps({ listOfferings: vi.fn(async () => offerings.slice(0, 5)) });
    const noCandidateResponse = await request(mealSlotsRoutes(SECRET, noCandidate), "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 5 })
    });
    expect(noCandidateResponse.status).toBe(409);
    await expect(noCandidateResponse.json()).resolves.toMatchObject({ error: "no-swap-candidate" });
    expect(noCandidate.updateMealSlot).not.toHaveBeenCalled();

    const injected = deps();
    const response = await request(mealSlotsRoutes(SECRET, injected), "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 5 })
    });
    expect(response.status).toBe(200);
    expect(injected.updateMealSlot).toHaveBeenCalledWith(token, 11, {
      menuItems: expect.arrayContaining([expect.objectContaining({ offeringId: 6 })]),
      generatedAt: NOW
    });
    const patch = vi.mocked(injected.updateMealSlot).mock.calls[0]![2];
    expect(patch.menuItems?.filter((item, index) => item.offeringId !== existing.menuItems[index]!.offeringId)).toHaveLength(1);
  });

  it("returns 404 for an item not in the owned slot and validates the body", async () => {
    const app = mealSlotsRoutes(SECRET, deps());
    expect((await request(app, "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 999 })
    })).status).toBe(404);
    expect((await request(app, "/11/swap-menu-item", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request(app, "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 5, seller: 99 })
    })).status).toBe(422);
  });
});

describe("meal-slot dependency errors", () => {
  it("preserves actionable CMS statuses and maps unknown failures to 502", async () => {
    for (const status of [401, 403, 404, 409, 422, 500]) {
      const app = mealSlotsRoutes(SECRET, deps({
        listMealSlots: vi.fn(async () => { throw new CmsMealSlotError(status, `cms-${status}`, "失败"); })
      }));
      const response = await request(app, "/?from=2026-07-01&to=2026-07-31");
      expect(response.status).toBe(status === 500 ? 502 : status);
      await expect(response.json()).resolves.toMatchObject({ error: `cms-${status}` });
    }
    const app = mealSlotsRoutes(SECRET, deps({ listMealSlots: vi.fn(async () => { throw new Error("offline"); }) }));
    expect((await request(app, "/?from=2026-07-01&to=2026-07-31")).status).toBe(502);
  });

  it("maps offering failures during generation and meal-slot failures during swap", async () => {
    const generate = mealSlotsRoutes(SECRET, deps({
      listOfferings: vi.fn(async () => { throw new CmsOfferingError(403, "membership-inactive", "停用"); })
    }));
    expect((await request(generate, "/generate-menus", {
      method: "POST",
      body: JSON.stringify({ targets: [{ date: "2026-07-13", occasion: "lunch" }] })
    })).status).toBe(403);

    const swap = mealSlotsRoutes(SECRET, deps({
      getMealSlot: vi.fn(async () => { throw new CmsMealSlotError(404, "not-found", "不存在"); })
    }));
    expect((await request(swap, "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 5 })
    })).status).toBe(404);
  });

  it("wires every real CMS dependency by default", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/offerings")) return new Response(JSON.stringify({ docs: offerings }));
      if (url.endsWith("/meal-slots/11") && method === "GET") {
        return new Response(JSON.stringify({ doc: existing }));
      }
      if (url.endsWith("/meal-slots/11") && method === "PATCH") {
        const patch = JSON.parse(String(init?.body)) as MealSlotUpdate;
        return new Response(JSON.stringify({ doc: { ...existing, ...patch } }));
      }
      if (url.includes("/meal-slots?") && method === "GET") return new Response(JSON.stringify({ docs: [] }));
      if (url.endsWith("/meal-slots") && method === "POST") {
        const input = JSON.parse(String(init?.body)) as MealSlotCreate;
        return new Response(JSON.stringify({
          doc: { id: 20, sellerId: 7, orderStatus: "draft", priceCents: null, ...input }
        }), { status: 201 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const app = mealSlotsRoutes(SECRET);
    expect((await request(app, "/generate-menus", {
      method: "POST",
      body: JSON.stringify({ targets: [{ date: "2026-07-13", occasion: "lunch" }] })
    })).status).toBe(200);
    expect((await request(app, "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 5 })
    })).status).toBe(200);
    expect(fetch).toHaveBeenCalled();
  });
});
