import { describe, expect, it } from "vitest";
import { todayShanghai } from "./time";

describe("todayShanghai", () => {
  it("formats the Shanghai date YYYY-MM-DD off the injected clock", () => {
    expect(todayShanghai(new Date("2026-06-30T12:00:00+08:00"))).toBe("2026-06-30");
  });

  it("rolls over at the Shanghai midnight boundary", () => {
    // 2026-06-29T23:30:00Z = 2026-06-30T07:30:00+08:00
    expect(todayShanghai(new Date("2026-06-29T23:30:00+00:00"))).toBe("2026-06-30");
  });
});
