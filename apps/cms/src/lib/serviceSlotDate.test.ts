import { describe, expect, it } from "vitest";
import { normalizeServiceSlotDate } from "./serviceSlotDate";

describe("normalizeServiceSlotDate", () => {
  it("normalizes date-only values and keeps ISO values stable", () => {
    expect(normalizeServiceSlotDate("2026-07-13")).toBe("2026-07-13T00:00:00.000Z");
    expect(normalizeServiceSlotDate("2026-07-13T00:00:00.000Z")).toBe("2026-07-13T00:00:00.000Z");
  });

  it("rejects invalid values", () => {
    expect(() => normalizeServiceSlotDate("not-a-date")).toThrow(TypeError);
    expect(() => normalizeServiceSlotDate(null)).toThrow(TypeError);
    expect(() => normalizeServiceSlotDate(0)).toThrow(TypeError);
  });
});
