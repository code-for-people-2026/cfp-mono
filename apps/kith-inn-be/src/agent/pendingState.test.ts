import { afterEach, describe, expect, it } from "vitest";
import type { ConfirmCustomerItem } from "@cfp/kith-inn-shared";
import { clearPending, getPending, setPending } from "./pendingState";

const item = (customerName: string): ConfirmCustomerItem => ({
  customerName,
  address: "26B",
  quantity: 1,
  occasion: "dinner",
});

// Module-level singleton → clear between tests so order doesn't matter.
afterEach(() => {
  clearPending(1);
  clearPending(2);
});

describe("pendingState", () => {
  it("stores and reads items by operator", () => {
    setPending(1, [item("大龙猫")]);
    expect(getPending(1)).toEqual([item("大龙猫")]);
    expect(getPending(2)).toEqual([]); // isolated per operator
  });

  it("clears on read-after-confirm", () => {
    setPending(1, [item("大龙猫")]);
    clearPending(1);
    expect(getPending(1)).toEqual([]);
  });

  it("setPending([]) drops the entry (same as clear)", () => {
    setPending(1, [item("大龙猫")]);
    setPending(1, []);
    expect(getPending(1)).toEqual([]);
  });
});
