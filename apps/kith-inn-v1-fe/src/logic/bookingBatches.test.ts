import { expect, it, vi } from "vitest";
import type { BookingBatch, MealSlot, ServiceClosure } from "@cfp/kith-inn-v1-shared";
import {
  applyBulkBookingStatus,
  batchCloseText,
  bookingConfigContext,
  bookingConfigUrl,
  bookingMenuUrl,
  bookingReturnMode,
  bookingWeekDates,
  bookingWeekStart,
  bookingDeadlineInputValue,
  buildBookingConfig,
  copyBookingBatchPath,
  effectiveServiceClosure,
  selectableBookingSlots,
  toggleBookingSlot,
  toggleOperationalSelection
} from "./bookingBatches";

const slot = (overrides: Partial<MealSlot> = {}): MealSlot => ({
  id: 11,
  sellerId: 7,
  date: "2026-07-13",
  occasion: "lunch",
  menuItems: Array.from({ length: 5 }, (_, index) => ({
    offeringId: index + 1,
    nameSnapshot: `菜${index + 1}`,
    mainIngredientSnapshot: null,
    categorySnapshot: index < 2 ? "meat" : index < 4 ? "veg" : "soup"
  })),
  orderStatus: "open",
  orderDeadline: "2026-07-12T01:00:00.000Z",
  priceCents: null,
  generatedAt: "2026-07-10T01:00:00.000Z",
  ...overrides
});

it("parses booking context and degrades invalid target parameters", () => {
  expect(bookingConfigContext({
    weekStart: "2026-07-20",
    date: "2026-07-22",
    occasion: "dinner"
  })).toEqual({
    weekStart: "2026-07-20",
    target: { date: "2026-07-22", occasion: "dinner" }
  });
  expect(bookingConfigContext({ weekStart: "2026-07-20" }))
    .toEqual({ weekStart: "2026-07-20", target: null });
  expect(bookingConfigContext({ weekStart: "2026-07-20", source: "home" }))
    .toEqual({ weekStart: "2026-07-20", target: null, source: "home" });
  expect(bookingConfigContext({ weekStart: "2026-07-20", date: "2026-07-25", occasion: "lunch" }))
    .toEqual({ weekStart: "2026-07-20", target: null });
  expect(bookingConfigContext({ weekStart: "2026-07-20", date: "bad", occasion: "supper" }))
    .toEqual({ weekStart: "2026-07-20", target: null });
  expect(bookingConfigContext({ weekStart: "2026-07-21" })).toBeNull();
  expect(bookingConfigContext({ weekStart: "2026-02-31" })).toBeNull();
  expect(bookingConfigContext({ weekStart: "9999-99-99" })).toBeNull();
  expect(bookingConfigContext({ weekStart: ["2026-07-20"] })).toBeNull();
  expect(bookingConfigContext({})).toBeNull();
});

it("builds booking configuration URLs for a week or meal target", () => {
  expect(bookingConfigUrl("2026-07-20"))
    .toBe("/pages/merchant/batches/index?weekStart=2026-07-20");
  expect(bookingConfigUrl("2026-07-20", { date: "2026-07-22", occasion: "dinner" }))
    .toBe("/pages/merchant/batches/index?weekStart=2026-07-20&date=2026-07-22&occasion=dinner");
  expect(bookingConfigUrl("2026-07-20", { date: "2026-07-22", occasion: "dinner" }, "home"))
    .toBe("/pages/merchant/batches/index?weekStart=2026-07-20&date=2026-07-22&occasion=dinner&source=home");
  expect(bookingMenuUrl({ weekStart: "2026-07-20", target: null }))
    .toBe("/pages/merchant/menu/index?weekStart=2026-07-20");
  expect(bookingMenuUrl({
    weekStart: "2026-07-20",
    target: { date: "2026-07-22", occasion: "dinner" }
  })).toBe("/pages/merchant/menu/index?weekStart=2026-07-20&date=2026-07-22&occasion=dinner");
});

it("builds a Monday-to-Friday booking week", () => {
  expect(bookingWeekStart("2026-07-22")).toBe("2026-07-20");
  expect(bookingWeekStart("2026-07-26")).toBe("2026-07-20");
  expect(bookingWeekStart("bad")).toBeNull();
  expect(bookingWeekDates("2026-07-20")).toEqual([
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"
  ]);
  expect(bookingWeekDates("2026-07-21")).toEqual([]);
});

it("chooses a safe menu return mode for platform and page stack", () => {
  expect(bookingReturnMode({ hasContext: false, platform: "weapp", pageCount: 1 })).toBe("navigate-to");
  expect(bookingReturnMode({ hasContext: true, platform: "h5", pageCount: 2 })).toBe("redirect-to");
  expect(bookingReturnMode({ hasContext: true, platform: "weapp", pageCount: 1 })).toBe("redirect-to");
  expect(bookingReturnMode({ hasContext: true, platform: "weapp", pageCount: 2 })).toBe("navigate-back");
});

it("selects only open unexpired slots and toggles stable ids", () => {
  const now = "2026-07-10T01:00:00.000Z";
  expect(selectableBookingSlots([
    slot(),
    slot({ id: 12, orderStatus: "draft" }),
    slot({ id: 13, orderDeadline: null }),
    slot({ id: 14, orderDeadline: now })
  ], now).map(({ id }) => id)).toEqual([11]);
  expect(toggleBookingSlot([], slot(), now)).toEqual([11]);
  expect(toggleBookingSlot([11], slot(), now)).toEqual([]);
  expect(toggleBookingSlot([], slot({ orderStatus: "closed" }), now)).toEqual([]);
});

it("caps operational selection while still allowing deselection", () => {
  expect(toggleOperationalSelection([1], 2, 2)).toEqual({ selected: [1, 2], limitReached: false });
  expect(toggleOperationalSelection([1, 2], 3, 2)).toEqual({ selected: [1, 2], limitReached: true });
  expect(toggleOperationalSelection([1, 2], "1", 2)).toEqual({ selected: [2], limitReached: false });
});

it("applies partial bulk results and keeps failed rows selected", () => {
  const updated = slot({ orderStatus: "open" });
  expect(applyBulkBookingStatus([slot({ orderStatus: "draft" }), slot({ id: 12 })], [
    { id: 11, status: "updated", doc: updated },
    { id: 12, status: "failed", error: "meal-slot-not-ready", message: "截止时间无效" }
  ])).toEqual({
    slots: [updated, slot({ id: 12 })],
    failedIds: [12],
    failures: { "12": "截止时间无效" }
  });
});

it("resolves whole-day closure before a meal closure", () => {
  const closures: ServiceClosure[] = [
    { id: 21, sellerId: 7, date: "2026-07-13", occasion: "lunch", note: null },
    { id: 22, sellerId: 7, date: "2026-07-13", occasion: null, note: "休息" }
  ];
  expect(effectiveServiceClosure(closures, "2026-07-13", "lunch")?.id).toBe(22);
  expect(effectiveServiceClosure(closures.slice(0, 1), "2026-07-13", "lunch")?.id).toBe(21);
  expect(effectiveServiceClosure(closures, "2026-07-14", "dinner")).toBeNull();
});

it("parses yuan/deadline config without leaking invalid values", () => {
  expect(buildBookingConfig({ priceYuan: "28.50", orderDeadline: "2026-07-12T09:00", orderStatus: "open" }))
    .toEqual({ priceCents: 2850, orderDeadline: "2026-07-12T01:00:00.000Z", orderStatus: "open" });
  expect(buildBookingConfig({ priceYuan: "", orderDeadline: "", orderStatus: "draft" }))
    .toEqual({ priceCents: null, orderDeadline: null, orderStatus: "draft" });
  expect(buildBookingConfig({ priceYuan: "28", orderDeadline: "", orderStatus: "draft" }))
    .toEqual({ priceCents: 2800, orderDeadline: null, orderStatus: "draft" });
  expect(buildBookingConfig({ priceYuan: "28.555", orderDeadline: "bad", orderStatus: "open" })).toBeNull();
  expect(buildBookingConfig({ priceYuan: "28", orderDeadline: "bad", orderStatus: "open" })).toBeNull();
  expect(buildBookingConfig({ priceYuan: "-1", orderDeadline: "2026-07-12T09:00", orderStatus: "open" })).toBeNull();
  expect(buildBookingConfig({ priceYuan: "abc", orderDeadline: "", orderStatus: "draft" })).toBeNull();
  expect(bookingDeadlineInputValue("2026-07-12T01:00:00.000Z")).toBe("2026-07-12T09:00");
  expect(bookingDeadlineInputValue(null)).toBe("");
});

it("copies the deterministic public path and describes close impact", async () => {
  const batch: BookingBatch = {
    id: 31,
    sellerId: 7,
    publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
    title: "午餐预订",
    status: "open",
    mealSlotIds: [11],
    createdById: 1
  };
  const setClipboardData = vi.fn(async () => undefined);
  await copyBookingBatchPath({ title: batch.title, path: `/pages/booking/index?batch=${batch.publicId}` }, setClipboardData);
  expect(setClipboardData).toHaveBeenCalledWith({ data: `/pages/booking/index?batch=${batch.publicId}` });
  expect(batchCloseText(batch)).toBe("关闭批次只会停用此分享入口，不会关闭其中餐次。确认关闭？");
  expect(batchCloseText({ ...batch, status: "closed" })).toBe("该批次已关闭");
});
