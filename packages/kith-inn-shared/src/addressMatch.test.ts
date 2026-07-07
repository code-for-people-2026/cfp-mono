import { describe, expect, it } from "vitest";
import { addressMatches } from "./addressMatch";

describe("addressMatches", () => {
  it("prefix: 3a matches 3a27b but not 2d03a", () => {
    expect(addressMatches("3a27b", "3a")).toBe(true);
    expect(addressMatches("2d03a", "3a")).toBe(false);
  });

  it("pure-numeric boundary: 2 matches building 2 not 26", () => {
    expect(addressMatches("2a10a", "2")).toBe(true);
    expect(addressMatches("26B-301", "2")).toBe(false);
    expect(addressMatches("26B-301", "26")).toBe(true);
  });

  it("letter fragment: prefix + case-insensitive (3a/26b ↔ 3A/26B)", () => {
    expect(addressMatches("26B-301", "26B")).toBe(true);
    expect(addressMatches("26B-301", "26b")).toBe(true); // case-insensitive
    expect(addressMatches("3A-1201", "3a")).toBe(true);
    expect(addressMatches("3a27b", "3A")).toBe(true);
  });

  it("blank fragment → false", () => {
    expect(addressMatches("3a27b", "")).toBe(false);
    expect(addressMatches("3a27b", "  ")).toBe(false);
  });

  it("non-latin: 隔 matches 隔壁小区", () => {
    expect(addressMatches("隔壁小区", "隔")).toBe(true);
    expect(addressMatches("隔壁小区", "隔壁")).toBe(true);
  });
});
