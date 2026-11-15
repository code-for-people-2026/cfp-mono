import { describe, expect, it } from "vitest";
import { durationDue, tickUsage, TWO_HOURS } from "./policy";

describe("interaction deterministic boundaries", () => {
  it("reminds every 2 hours across short reconnects and resets after a real break", () => {
    let usage = { activeMs: TWO_HOURS - 30_000, lastSeen: 1_000_000, reminded: 0 };
    usage = tickUsage(usage, 1_030_000);
    expect(durationDue(usage)).toBe(true);
    usage.reminded = 1;
    expect(durationDue(usage)).toBe(false);
    usage.activeMs = 2 * TWO_HOURS;
    expect(durationDue(usage)).toBe(true);
    expect(tickUsage(usage, usage.lastSeen + 15 * 60_000).activeMs).toBe(0);
    expect(tickUsage(usage, usage.lastSeen - 1000).activeMs).toBe(usage.activeMs);
    expect(tickUsage(usage, usage.lastSeen + 120_000).activeMs).toBe(usage.activeMs);
  });
});
