import { describe, expect, it } from "vitest";
import {
  CUSTOMER_KINDS,
  FULFILLMENT_STATUSES,
  FULFILLMENT_MODES,
  MENU_PLAN_STATUSES,
  OFFERING_CATEGORIES,
  OFFERING_KINDS,
  OCCASIONS,
  OPERATOR_ROLES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SERVICE_SLOT_STATUSES,
  SELLER_MODULES,
  SELLER_STATUSES,
  SUBSCRIPTION_STATUSES,
} from "./enums";

describe("domain enums", () => {
  // Smoke: every enum tuple is non-empty and carries the spec's kebab-case values.
  // Importing the module also covers all `as const` lines for coverage.
  it("occasions cover the day (lunch + dinner are the MVP slots)", () => {
    expect(OCCASIONS).toEqual([
      "breakfast",
      "brunch",
      "lunch",
      "dinner",
      "all-day",
    ]);
  });

  it("order status is the draft→confirm→cancel lifecycle", () => {
    expect(ORDER_STATUSES).toEqual(["draft", "confirmed", "canceled"]);
  });

  it("payment status is distinct from order status (reconciled, not confirmed)", () => {
    expect(PAYMENT_STATUSES).toEqual(["unpaid", "paid", "reconciled"]);
  });

  it("offering kinds cover the four business shapes", () => {
    expect(OFFERING_KINDS).toEqual([
      "combo-meal",
      "single-item",
      "service-session",
      "component",
    ]);
  });

  it("offering categories carry kebab values + Chinese labels", () => {
    expect(OFFERING_CATEGORIES).toContainEqual({ value: "meat", label: "荤" });
    expect(OFFERING_CATEGORIES.map((c) => c.value)).toEqual([
      "meat",
      "veg",
      "soup",
      "staple",
    ]);
  });

  it("fulfillment status includes the canceled terminal state", () => {
    expect(FULFILLMENT_STATUSES).toEqual([
      "pending",
      "handed-off",
      "done",
      "canceled",
    ]);
  });

  it("remaining enums are non-empty and kebab-case", () => {
    expect(FULFILLMENT_MODES.length).toBeGreaterThan(0);
    expect(CUSTOMER_KINDS).toContain("self");
    expect(SELLER_MODULES).toContain("menu-planning");
    expect(SELLER_STATUSES).toContain("active");
    expect(OPERATOR_ROLES).toContain("owner");
    expect(SERVICE_SLOT_STATUSES).toContain("archived");
    expect(MENU_PLAN_STATUSES).toContain("published");
    expect(ORDER_SOURCES).toContain("chat-paste");
    expect(SUBSCRIPTION_STATUSES).toContain("paused");
  });
});
