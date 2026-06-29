import { describe, expect, it } from "vitest";
import { retainMessages } from "./memory";

const day = (d: Date, daysAgo: number, hour = 9) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - daysAgo);
  x.setHours(hour);
  return x.toISOString();
};

const now = new Date("2026-06-29T15:00:00+08:00");

describe("retainMessages", () => {
  it("keeps today + yesterday, drops 前天 and older (2-day window)", () => {
    const msgs = [
      { id: 1, createdAt: day(now, 3) }, // 前天之前 → drop
      { id: 2, createdAt: day(now, 2) }, // 前天 → drop (window is today+yesterday)
      { id: 3, createdAt: day(now, 1) }, // 昨天 → keep
      { id: 4, createdAt: day(now, 0) }, // 今天 → keep
    ];
    const r = retainMessages(msgs, now);
    expect(r.keep.map((m) => m.id)).toEqual([3, 4]);
    expect(r.dropped).toBe(2);
  });

  it("keeps everything when under the cap", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({ id: i, createdAt: day(now, 0) }));
    expect(retainMessages(msgs, now).keep).toHaveLength(50);
  });

  it("drops the oldest 200 when over the 1000 cap", () => {
    const msgs = Array.from({ length: 1005 }, (_, i) => ({ id: i, createdAt: day(now, 0) }));
    const r = retainMessages(msgs, now);
    expect(r.keep).toHaveLength(805); // 1005 - 200
    expect(r.keep[0]!.id).toBe(200); // oldest 200 dropped
    expect(r.dropped).toBe(200);
  });

  it("respects a custom cap + overCapDrop", () => {
    const msgs = Array.from({ length: 12 }, (_, i) => ({ id: i, createdAt: day(now, 0) }));
    const r = retainMessages(msgs, now, { cap: 10, overCapDrop: 3 });
    expect(r.keep).toHaveLength(9);
    expect(r.keep[0]!.id).toBe(3);
  });
});
