import { describe, expect, it } from "vitest";
import type { MealSlot, ServiceClosure } from "./types";
import {
  customerMealSlotPresentation,
  customerMealSlotPresentationForTarget,
  serviceClosureForTarget
} from "./availability";

const NOW = "2026-07-13T01:00:00.000Z";
const slot = (over: Partial<MealSlot> = {}): MealSlot => ({
  id: 11,
  sellerId: 7,
  date: "2026-07-13",
  occasion: "lunch",
  menuItems: [
    { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
    { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
    { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
    { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
    { offeringId: 5, nameSnapshot: "汤", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
  ],
  orderStatus: "draft",
  orderDeadline: null,
  priceCents: null,
  generatedAt: NOW,
  ...over
});

const closure = (over: Partial<ServiceClosure> = {}): ServiceClosure => ({
  id: 41,
  sellerId: 7,
  date: "2026-07-13",
  occasion: null,
  note: null,
  ...over
});

describe("customer meal-slot presentation", () => {
  it("hides drafts and open records without a deadline", () => {
    expect(customerMealSlotPresentation(slot(), NOW)).toBe("hidden");
    expect(customerMealSlotPresentation(slot({ orderStatus: "open" }), NOW)).toBe("hidden");
  });

  it("distinguishes bookable, exact-deadline, passed and stopped slots", () => {
    expect(customerMealSlotPresentation(slot({
      orderStatus: "open", orderDeadline: "2026-07-13T01:00:01.000Z", priceCents: null
    }), NOW)).toBe("bookable");
    expect(customerMealSlotPresentation(slot({
      orderStatus: "open", orderDeadline: "2026-07-13T01:00:01.000Z", priceCents: 3000
    }), NOW)).toBe("bookable");
    expect(customerMealSlotPresentation(slot({
      orderStatus: "open", orderDeadline: NOW, priceCents: 3000
    }), NOW)).toBe("deadline-passed");
    expect(customerMealSlotPresentation(slot({
      orderStatus: "open", orderDeadline: "2026-07-13T00:59:59.000Z", priceCents: 3000
    }), NOW)).toBe("deadline-passed");
    expect(customerMealSlotPresentation(slot({ orderStatus: "closed" }), NOW)).toBe("stopped");
  });

  it("makes explicit closures visible even without a meal-slot record", () => {
    expect(customerMealSlotPresentationForTarget(
      { date: "2026-07-13", occasion: "lunch" },
      null,
      [closure()],
      NOW
    )).toBe("service-closed");
  });

  it("lets full-day and meal closures override every meal-slot state", () => {
    expect(customerMealSlotPresentationForTarget(
      { date: "2026-07-13", occasion: "lunch" },
      slot({ orderStatus: "open", orderDeadline: "2026-07-13T01:00:01.000Z" }),
      [closure()],
      NOW
    )).toBe("service-closed");
    expect(customerMealSlotPresentationForTarget(
      { date: "2026-07-13", occasion: "dinner" },
      slot({ occasion: "dinner" }),
      [closure({ occasion: "dinner" })],
      NOW
    )).toBe("service-closed");
  });

  it("falls back to meal-slot presentation when no closure matches", () => {
    expect(customerMealSlotPresentationForTarget(
      { date: "2026-07-13", occasion: "lunch" },
      slot({ orderStatus: "open", orderDeadline: "2026-07-13T01:00:01.000Z" }),
      [closure({ occasion: "dinner" })],
      NOW
    )).toBe("bookable");
    expect(customerMealSlotPresentationForTarget(
      { date: "2026-07-13", occasion: "lunch" },
      null,
      [],
      NOW
    )).toBe("hidden");
  });
});

describe("service closure precedence", () => {
  it("prefers a full-day closure over a matching meal closure", () => {
    const meal = closure({ id: 42, occasion: "lunch" });
    const day = closure();
    expect(serviceClosureForTarget([meal, day], { date: "2026-07-13", occasion: "lunch" })).toEqual(day);
  });

  it("matches only the target date and occasion", () => {
    const lunch = closure({ occasion: "lunch" });
    expect(serviceClosureForTarget([lunch], { date: "2026-07-13", occasion: "lunch" })).toEqual(lunch);
    expect(serviceClosureForTarget([lunch], { date: "2026-07-13", occasion: "dinner" })).toBeNull();
    expect(serviceClosureForTarget([closure({ date: "2026-07-14" })], {
      date: "2026-07-13", occasion: "lunch"
    })).toBeNull();
  });
});
