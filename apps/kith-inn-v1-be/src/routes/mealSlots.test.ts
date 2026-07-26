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
  orderDeadline: null,
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
      orderDeadline: null,
      priceCents: null,
      ...input
    } as MealSlot)),
    updateMealSlot: vi.fn(async (_token: string, id: string | number, patch: MealSlotUpdate) => ({
      ...existing,
      id,
      ...patch
    })),
    updateMealSlotBookingConfig: vi.fn(async (_token, id, patch) => ({ ...existing, id, ...patch })),
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
  it.each(["open", "closed"] as const)(
    "rejects a batch containing a slot in %s state before generation or writes",
    async (orderStatus) => {
      const locked = { ...existing, orderStatus };
      const injected = deps({ listMealSlots: vi.fn(async () => [existing, locked]) });
      const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
        method: "POST",
        body: JSON.stringify({
          targets: [
            { date: existing.date, occasion: "dinner" },
            { date: locked.date, occasion: locked.occasion }
          ],
          replaceExisting: true
        })
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "meal-slot-menu-locked",
        message: "餐次已开放或关闭，菜单不可修改"
      });
      expect(injected.listOfferings).not.toHaveBeenCalled();
      expect(injected.createMealSlot).not.toHaveBeenCalled();
      expect(injected.updateMealSlot).not.toHaveBeenCalled();
    }
  );

  it("allows replacing an expired slot that is still draft", async () => {
    const expiredDraft = { ...existing, orderDeadline: "2026-07-09T01:00:00.000Z" };
    const injected = deps({ listMealSlots: vi.fn(async () => [expiredDraft]) });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/generate-menus", {
      method: "POST",
      body: JSON.stringify({
        targets: [{ date: expiredDraft.date, occasion: expiredDraft.occasion }],
        replaceExisting: true
      })
    });

    expect(response.status).toBe(200);
    expect(injected.updateMealSlot).toHaveBeenCalledOnce();
  });

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
  it.each(["open", "closed"] as const)("rejects swapping a slot in %s state before menu work", async (orderStatus) => {
    const injected = deps({ getMealSlot: vi.fn(async () => ({ ...existing, orderStatus })) });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 5 })
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "meal-slot-menu-locked",
      message: "餐次已开放或关闭，菜单不可修改"
    });
    expect(injected.listOfferings).not.toHaveBeenCalled();
    expect(injected.listMealSlots).not.toHaveBeenCalled();
    expect(injected.updateMealSlot).not.toHaveBeenCalled();
  });

  it("allows swapping an expired slot that is still draft", async () => {
    const injected = deps({
      getMealSlot: vi.fn(async () => ({ ...existing, orderDeadline: "2026-07-09T01:00:00.000Z" }))
    });
    const response = await request(mealSlotsRoutes(SECRET, injected), "/11/swap-menu-item", {
      method: "POST",
      body: JSON.stringify({ offeringId: 5 })
    });

    expect(response.status).toBe(200);
    expect(injected.updateMealSlot).toHaveBeenCalledOnce();
  });

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

describe("meal-slot booking config route", () => {
  it("opens a complete slot with a future deadline and can close it", async () => {
    const injected = deps();
    const app = mealSlotsRoutes(SECRET, injected);
    const open = await request(app, "/11/booking-config", {
      method: "PATCH",
      body: JSON.stringify({
        priceCents: 2800,
        orderDeadline: "2026-07-11T01:00:00.000Z",
        orderStatus: "open"
      })
    });
    expect(open.status).toBe(200);
    expect(injected.updateMealSlotBookingConfig).toHaveBeenCalledWith(token, 11, {
      priceCents: 2800,
      orderDeadline: "2026-07-11T01:00:00.000Z",
      orderStatus: "open"
    });

    const close = await request(mealSlotsRoutes(SECRET, deps({
      getMealSlot: vi.fn(async () => ({
        ...existing,
        orderStatus: "open" as const,
        orderDeadline: "2026-07-11T01:00:00.000Z"
      }))
    })), "/11/booking-config", {
      method: "PATCH",
      body: JSON.stringify({ orderStatus: "closed" })
    });
    expect(close.status).toBe(200);

    const reopenDeps = deps({
      getMealSlot: vi.fn(async () => ({
        ...existing,
        orderStatus: "closed" as const,
        orderDeadline: "2026-07-11T01:00:00.000Z"
      }))
    });
    const reopen = await request(mealSlotsRoutes(SECRET, reopenDeps), "/11/booking-config", {
      method: "PATCH",
      body: JSON.stringify({ orderStatus: "open" })
    });
    expect(reopen.status).toBe(200);
    expect(reopenDeps.updateMealSlotBookingConfig).toHaveBeenCalledWith(token, 11, { orderStatus: "open" });
  });

  it("rejects incomplete, expired and backward state transitions before CMS writes", async () => {
    const cases: Array<{ slot: MealSlot; patch: unknown; status: number; error: string }> = [
      { slot: existing, patch: { orderStatus: "open" }, status: 422, error: "meal-slot-not-ready" },
      {
        slot: { ...existing, orderDeadline: "2026-07-09T01:00:00.000Z" },
        patch: { orderStatus: "open" },
        status: 422,
        error: "meal-slot-not-ready"
      },
      {
        slot: { ...existing, orderStatus: "open", orderDeadline: "2026-07-11T01:00:00.000Z" },
        patch: { orderStatus: "draft" },
        status: 409,
        error: "invalid-meal-slot-transition"
      }
    ];
    for (const item of cases) {
      const injected = deps({ getMealSlot: vi.fn(async () => item.slot) });
      const response = await request(mealSlotsRoutes(SECRET, injected), "/11/booking-config", {
        method: "PATCH",
        body: JSON.stringify(item.patch)
      });
      expect(response.status).toBe(item.status);
      await expect(response.json()).resolves.toMatchObject({ error: item.error });
      expect(injected.updateMealSlotBookingConfig).not.toHaveBeenCalled();
    }
  });

  it("validates JSON/body and maps CMS failures", async () => {
    const app = mealSlotsRoutes(SECRET, deps());
    expect((await request(app, "/11/booking-config", { method: "PATCH", body: "{" })).status).toBe(400);
    expect((await request(app, "/11/booking-config", { method: "PATCH", body: JSON.stringify({}) })).status).toBe(422);
    const unavailable = mealSlotsRoutes(SECRET, deps({
      updateMealSlotBookingConfig: vi.fn(async () => {
        throw new CmsMealSlotError(500, "booking-config-failed", "失败");
      })
    }));
    expect((await request(unavailable, "/11/booking-config", {
      method: "PATCH",
      body: JSON.stringify({ priceCents: 2800 })
    })).status).toBe(502);
  });
});

describe("bulk meal-slot booking status route", () => {
  it("opens each unique slot independently and preserves partial failures", async () => {
    const ready = { ...existing, orderDeadline: "2026-07-11T01:00:00.000Z" };
    const getMealSlot = vi.fn(async (_token: string, id: string | number) => (
      String(id) === "12" ? { ...existing, id } : { ...ready, id }
    ));
    const updateMealSlotBookingConfig = vi.fn(async (_token, id, patch) => {
      if (String(id) === "13") throw new CmsMealSlotError(409, "service-closure-conflict", "该餐次已打烊");
      return { ...ready, id, ...patch };
    });
    const response = await request(mealSlotsRoutes(SECRET, deps({
      getMealSlot,
      updateMealSlotBookingConfig
    })), "/bulk-booking-status", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11, 11, 12, 13], action: "open" })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [
        { id: 11, status: "updated", doc: { orderStatus: "open" } },
        { id: 12, status: "failed", error: "meal-slot-not-ready" },
        { id: 13, status: "failed", error: "service-closure-conflict", message: "该餐次已打烊" }
      ]
    });
    expect(getMealSlot).toHaveBeenCalledTimes(3);
    expect(updateMealSlotBookingConfig).toHaveBeenCalledTimes(2);
  });

  it("stops open slots and reopens valid stopped slots", async () => {
    const ready = {
      ...existing,
      orderStatus: "closed" as const,
      orderDeadline: "2026-07-11T01:00:00.000Z"
    };
    const updateMealSlotBookingConfig = vi.fn(async (_token, id, patch) => ({ ...ready, id, ...patch }));
    const reopenApp = mealSlotsRoutes(SECRET, deps({
      getMealSlot: vi.fn(async (_token, id) => ({ ...ready, id })),
      updateMealSlotBookingConfig
    }));
    const reopen = await request(reopenApp, "/bulk-booking-status", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11], action: "open" })
    });
    const stopApp = mealSlotsRoutes(SECRET, deps({
      getMealSlot: vi.fn(async (_token, id) => ({
        ...ready,
        id,
        orderStatus: String(id) === "11" ? "open" as const : String(id) === "12" ? "closed" as const : "draft" as const
      })),
      updateMealSlotBookingConfig
    }));
    const stop = await request(stopApp, "/bulk-booking-status", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11, 12, 13], action: "stop" })
    });

    expect(reopen.status).toBe(200);
    await expect(reopen.json()).resolves.toMatchObject({ results: [{ status: "updated", doc: { orderStatus: "open" } }] });
    expect(stop.status).toBe(200);
    await expect(stop.json()).resolves.toMatchObject({
      results: [
        { id: 11, status: "updated", doc: { orderStatus: "closed" } },
        { id: 12, status: "updated", doc: { orderStatus: "closed" } },
        { id: 13, status: "failed", error: "invalid-meal-slot-transition" }
      ]
    });
    expect(updateMealSlotBookingConfig).toHaveBeenCalledTimes(2);
  });

  it("validates JSON and the bounded seller-free input", async () => {
    const app = mealSlotsRoutes(SECRET, deps());
    expect((await request(app, "/bulk-booking-status", { method: "POST", body: "{" })).status).toBe(400);
    for (const body of [
      { mealSlotIds: [], action: "open" },
      { mealSlotIds: Array.from({ length: 21 }, (_, index) => index + 1), action: "stop" },
      { mealSlotIds: [11], action: "open", sellerId: 99 }
    ]) {
      expect((await request(app, "/bulk-booking-status", {
        method: "POST",
        body: JSON.stringify(body)
      })).status).toBe(422);
    }
  });

  it("maps unavailable dependencies per item and continues", async () => {
    const getMealSlot = vi.fn(async (_token: string, id: string | number) => {
      if (String(id) === "11") throw new CmsMealSlotError(500, "failed", "失败");
      if (String(id) === "12") throw new CmsMealSlotError(401, "internal-unauthorized", "内部凭据错误");
      throw new Error("network");
    });
    const response = await request(mealSlotsRoutes(SECRET, deps({ getMealSlot })), "/bulk-booking-status", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11, 12, 13], action: "stop" })
    });

    expect(response.status).toBe(200);
    expect((await response.json() as { results: Array<{ error: string }> }).results.map(({ error }) => error))
      .toEqual(["cms-unavailable", "cms-unavailable", "cms-unavailable"]);
    expect(getMealSlot).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])("returns a request-level %i merchant authorization failure", async (status) => {
    const getMealSlot = vi.fn(async () => {
      throw new CmsMealSlotError(status, "membership-inactive", "商家身份失效");
    });
    const response = await request(mealSlotsRoutes(SECRET, deps({ getMealSlot })), "/bulk-booking-status", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11, 12], action: "open" })
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: "membership-inactive" });
    expect(getMealSlot).toHaveBeenCalledOnce();
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

    const internalAuth = mealSlotsRoutes(SECRET, deps({
      listMealSlots: vi.fn(async () => {
        throw new CmsMealSlotError(401, "internal-unauthorized", "内部凭据错误");
      })
    }));
    const response = await request(internalAuth, "/?from=2026-07-01&to=2026-07-31");
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "cms-unavailable" });
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
      if (url.endsWith("/meal-slots/11/booking-config") && method === "PATCH") {
        const patch = JSON.parse(String(init?.body)) as { priceCents: number };
        return new Response(JSON.stringify({ doc: { ...existing, ...patch } }));
      }
      if (url.includes("/meal-slots?") && method === "GET") return new Response(JSON.stringify({ docs: [] }));
      if (url.endsWith("/meal-slots") && method === "POST") {
        const input = JSON.parse(String(init?.body)) as MealSlotCreate;
        return new Response(JSON.stringify({
          doc: { id: 20, sellerId: 7, orderStatus: "draft", orderDeadline: null, priceCents: null, ...input }
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
    expect((await request(app, "/11/booking-config", {
      method: "PATCH",
      body: JSON.stringify({ priceCents: 2800 })
    })).status).toBe(200);
    expect(fetch).toHaveBeenCalled();
  });
});
