import { describe, expect, it } from "vitest";
import type { Order } from "@cfp/kith-inn-shared";
import { customerName, todayShanghai } from "./domainUtil";

describe("domainUtil", () => {
  it("formats today in Asia/Shanghai", () => {
    expect(todayShanghai(() => new Date("2026-06-29T23:30:00Z"))).toBe("2026-06-30");
    expect(todayShanghai(new Date("2026-06-29T12:00:00+08:00"))).toBe("2026-06-29");
    expect(todayShanghai()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reads populated customer names and falls back to ids", () => {
    expect(customerName({ customer: { id: 5, displayName: "王燕萍" } } as Order)).toBe("王燕萍");
    expect(customerName({ customer: 7 } as Order)).toBe("#7");
  });
});
