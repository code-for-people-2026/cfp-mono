import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CmsMealSlotError,
  createMealSlot,
  getMealSlot,
  listMealSlots,
  updateMealSlot
} from "./mealSlots";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const menuItems = [
  { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" as const },
  { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" as const },
  { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" as const },
  { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" as const },
  { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" as const }
];
const slot = {
  id: 11,
  sellerId: 7,
  date: "2026-07-13",
  occasion: "lunch" as const,
  menuItems,
  orderStatus: "draft" as const,
  priceCents: null,
  generatedAt: "2026-07-10T01:00:00.000Z"
};
const response = (body: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  }))
});

describe("CMS meal-slot client", () => {
  it("lists, gets, creates and patches through the kiv1 operator boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    const listDeps = response({ docs: [slot] });
    await expect(listMealSlots("jwt", { from: "2026-07-01", to: "2026-07-31" }, listDeps)).resolves.toEqual([slot]);
    expect(listDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/meal-slots?from=2026-07-01&to=2026-07-31",
      { headers: { "x-kith-inn-v1-operator": "jwt" } }
    );

    const incomplete = { ...slot, menuItems: menuItems.slice(0, 1) };
    await expect(listMealSlots(
      "jwt",
      { from: "2026-07-01", to: "2026-07-31" },
      response({ docs: [incomplete] })
    )).resolves.toEqual([incomplete]);

    const detailDeps = response({ doc: slot });
    await expect(getMealSlot("jwt", 11, detailDeps)).resolves.toEqual(slot);
    expect(detailDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/meal-slots/11",
      { headers: { "x-kith-inn-v1-operator": "jwt" } }
    );

    const input = { date: slot.date, occasion: slot.occasion, menuItems, generatedAt: slot.generatedAt };
    const createDeps = response({ doc: slot }, 201);
    await expect(createMealSlot("jwt", input, createDeps)).resolves.toEqual(slot);
    expect(createDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/meal-slots",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) })
    );

    const patch = { menuItems, generatedAt: "2026-07-10T02:00:00.000Z" };
    const updateDeps = response({ doc: { ...slot, ...patch } });
    await expect(updateMealSlot("jwt", 11, patch, updateDeps)).resolves.toMatchObject(patch);
    expect(updateDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/meal-slots/11",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(patch) })
    );
  });

  it("preserves CMS errors and rejects malformed success payloads", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    for (const status of [401, 403, 404, 409, 422, 500]) {
      await expect(getMealSlot("jwt", 11, response({ error: `error-${status}`, message: "失败" }, status)))
        .rejects.toEqual(expect.objectContaining({ status, code: `error-${status}`, message: "失败" }));
    }
    await expect(listMealSlots("jwt", { from: "2026-07-01", to: "2026-07-31" }, response({ docs: [{}] })))
      .rejects.toMatchObject({ status: 502, code: "invalid-cms-response" });
    await expect(createMealSlot(
      "jwt",
      { date: slot.date, occasion: slot.occasion, menuItems, generatedAt: slot.generatedAt },
      response({})
    )).rejects.toBeInstanceOf(CmsMealSlotError);
    await expect(createMealSlot(
      "jwt",
      { date: slot.date, occasion: slot.occasion, menuItems, generatedAt: slot.generatedAt },
      response(null)
    )).rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(listMealSlots("jwt", { from: "2026-07-01", to: "2026-07-31" }, response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(listMealSlots("jwt", { from: "2026-07-01", to: "2026-07-31" }, response({})))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
  });

  it("uses stable fallbacks and fails without CMS_BASE_URL", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(getMealSlot("jwt", 11, response({ error: "not-found" }, 404))).rejects.toMatchObject({
      status: 404,
      code: "not-found",
      message: "餐次服务失败"
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("not-json", { status: 500 }));
    await expect(getMealSlot("jwt", 11, { fetch })).rejects.toMatchObject({ code: "cms-meal-slot-failed" });
    delete process.env.CMS_BASE_URL;
    await expect(getMealSlot("jwt", 11)).rejects.toThrow(/CMS_BASE_URL/);
  });

  it("uses global fetch by default", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = response({ docs: [] }).fetch;
    vi.stubGlobal("fetch", fetchMock);
    await expect(listMealSlots("jwt", { from: "2026-07-01", to: "2026-07-31" })).resolves.toEqual([]);
  });
});
