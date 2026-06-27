import { describe, expect, it } from "vitest";
import { buildSellerWhere, isOperator, sellerIdOf } from "./buildSellerWhere";

describe("isOperator", () => {
  it("rejects non-object values", () => {
    expect(isOperator(null)).toBe(false); // typeof null === "object", caught by null check
    expect(isOperator(undefined)).toBe(false);
    expect(isOperator("operator")).toBe(false);
    expect(isOperator(42)).toBe(false);
  });

  it("rejects objects missing the tenant/active keys", () => {
    expect(isOperator({})).toBe(false);
    expect(isOperator({ seller: 1 })).toBe(false);
    expect(isOperator({ active: true })).toBe(false);
  });

  it("accepts an object carrying seller + active", () => {
    expect(isOperator({ seller: 1, active: true })).toBe(true);
  });
});

describe("sellerIdOf", () => {
  it("returns null for non-operators and inactive operators", () => {
    expect(sellerIdOf(null)).toBeNull();
    expect(sellerIdOf({ seller: 1 })).toBeNull();
    expect(sellerIdOf({ seller: 1, active: false })).toBeNull();
  });

  it("reads a shallow seller id (number or string)", () => {
    expect(sellerIdOf({ seller: 7, active: true })).toBe(7);
    expect(sellerIdOf({ seller: "seller-abc", active: true })).toBe("seller-abc");
  });

  it("reads a populated seller doc's id", () => {
    expect(sellerIdOf({ seller: { id: 9 }, active: true })).toBe(9);
    expect(sellerIdOf({ seller: { id: "seller-xyz" }, active: true })).toBe("seller-xyz");
  });

  it("returns null when the seller value has no readable id", () => {
    expect(sellerIdOf({ seller: null, active: true })).toBeNull();
    expect(sellerIdOf({ seller: { name: "x" }, active: true })).toBeNull(); // object without id
    expect(sellerIdOf({ seller: { id: true }, active: true })).toBeNull(); // id is wrong type
    expect(sellerIdOf({ seller: [1, 2], active: true })).toBeNull(); // array, no id key
  });
});

describe("buildSellerWhere", () => {
  it("returns null (deny) when there is no usable tenant", () => {
    expect(buildSellerWhere(null)).toBeNull();
    expect(buildSellerWhere({ seller: 1, active: false })).toBeNull();
  });

  it("returns a Where scoping reads to the operator's seller", () => {
    expect(buildSellerWhere({ seller: 7, active: true })).toEqual({
      seller: { equals: 7 },
    });
  });
});
