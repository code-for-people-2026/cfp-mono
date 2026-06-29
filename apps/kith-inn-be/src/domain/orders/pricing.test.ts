import { describe, expect, it } from "vitest";
import { computeTotalCents, resolveUnitPrice } from "./pricing";

describe("resolveUnitPrice", () => {
  it("prefers an explicit item price (这单特价)", () => {
    expect(resolveUnitPrice({ unitPriceCents: 2500 }, { priceCents: 3000 }, { defaultPriceCents: 3000 })).toBe(2500);
  });

  it("falls back to the offering price when the item has none", () => {
    expect(resolveUnitPrice({}, { priceCents: 2800 }, { defaultPriceCents: 3000 })).toBe(2800);
  });

  it("falls back to the seller default when neither item nor offering is priced", () => {
    expect(resolveUnitPrice({}, undefined, { defaultPriceCents: 3000 })).toBe(3000);
  });

  it("returns 0 when nothing is priced (defensive)", () => {
    expect(resolveUnitPrice({}, undefined, undefined)).toBe(0);
    expect(resolveUnitPrice({}, {}, {})).toBe(0);
  });
});

describe("computeTotalCents", () => {
  it("sums quantity × unit price across items", () => {
    expect(computeTotalCents([{ quantity: 2, unitPriceCents: 3000 }, { quantity: 1, unitPriceCents: 3000 }])).toBe(9000);
  });

  it("treats a missing unit price as 0", () => {
    expect(computeTotalCents([{ quantity: 3 }])).toBe(0);
  });

  it("is 0 for an empty item set", () => {
    expect(computeTotalCents([])).toBe(0);
  });
});
