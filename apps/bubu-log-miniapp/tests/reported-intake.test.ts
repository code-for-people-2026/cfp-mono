import { describe, expect, it } from "vitest";
import { recordEvent } from "../src/api/contracts";
import { recordDetailFields } from "../src/model";
import type { Activity, RecordEvent } from "../src/model/types";
import { recordEventFixture } from "./fixtures/records";

const startTime = "2026-10-22T09:10:00+08:00";

function breastfeedActivity(overrides: Partial<Activity> = {}): Activity {
  return { id: "breastfeed-record", babyId: "baby-1", type: "BREASTFEED", startTime, ...overrides };
}

function decodeIntake(intake: unknown, states: Record<string, unknown> = { reportedIntake: "known" }) {
  return recordEvent({
    ...recordEventFixture({ states: states as RecordEvent["states"] }),
    facts: { type: "BREASTFEED", startTime, reportedIntake: intake },
    currentActivity: breastfeedActivity(),
  }).reportedIntake;
}

describe("reported breastfeeding intake", () => {
  it("accepts only explicit grams and preserves the original quotation", () => {
    expect(decodeIntake({ value: 0, unit: "g", originalText: " 亲喂吃了 0 克 " }))
      .toEqual({ value: 0, unit: "g", originalText: " 亲喂吃了 0 克 " });
    expect(decodeIntake({ value: 80, unit: "g", originalText: "\n亲喂吃了 80 克\n" }))
      .toEqual({ value: 80, unit: "g", originalText: "\n亲喂吃了 80 克\n" });
  });

  it("ignores unconfirmed, malformed, out-of-range, or over-specified grams", () => {
    const invalidValues: unknown[] = [
      { value: "80", unit: "g", originalText: "亲喂吃了 80 克" },
      { value: -1, unit: "g", originalText: "亲喂吃了 -1 克" },
      { value: 100001, unit: "g", originalText: "亲喂吃了 100001 克" },
      { value: 80, unit: "ml", originalText: "亲喂吃了 80 毫升" },
      { value: 80, unit: "g", originalText: "   " },
      { value: 80, unit: "g", originalText: "亲喂吃了 80 克", source: "extra" },
    ];
    for (const intake of invalidValues) expect(decodeIntake(intake)).toBeUndefined();
    expect(decodeIntake({ value: 80, unit: "g", originalText: "亲喂吃了 80 克" }, { reportedIntake: "unknown" })).toBeUndefined();
    expect(recordEvent({
      ...recordEventFixture({ states: { reportedIntake: "known" } }),
      facts: { type: "BOTTLE", startTime, reportedIntake: { value: 80, unit: "g", originalText: "瓶喂吃了 80 克" } },
      currentActivity: breastfeedActivity({ type: "BOTTLE" }),
    }).reportedIntake).toBeUndefined();
  });

  it("keeps historical breastfeed ml under its explicit old label", () => {
    const activity = breastfeedActivity({ milkAmount: 80, endTime: "2026-10-22T09:30:00+08:00" });
    const event = recordEvent({
      ...recordEventFixture({ states: { reportedIntake: "known", milkAmount: "known" } }),
      facts: { type: "BREASTFEED", startTime, milkAmount: 80 },
      currentActivity: activity,
    });
    const details = recordDetailFields(activity, event);

    expect(event.reportedIntake).toBeUndefined();
    expect(details).toContainEqual({ label: "记录奶量", value: "80 ml" });
    expect(details.some(field => field.label === "奶量")).toBe(false);
    expect(details.some(field => field.value.includes("80 克"))).toBe(false);
  });

  it("shows valid pending and conflicting grams as not yet saved", () => {
    const pending = recordEvent({
      ...recordEventFixture({ projection: "pending", states: { reportedIntake: "known" } }),
      facts: { type: "BREASTFEED", startTime, reportedIntake: { value: 80, unit: "g", originalText: "亲喂吃了 80 克" } },
      currentActivity: breastfeedActivity(),
    });
    const conflict = recordEvent({
      ...recordEventFixture({ projection: "conflict", states: { reportedIntake: "known" } }),
      facts: { type: "BREASTFEED", startTime, reportedIntake: { value: 80, unit: "g", originalText: "亲喂吃了 80 克" } },
      currentActivity: breastfeedActivity(),
    });

    const pendingDetails = recordDetailFields(breastfeedActivity(), pending);
    expect(pendingDetails).toContainEqual({ label: "保存状态", value: "等待同步保存" });
    expect(pendingDetails).toContainEqual({ label: "报告摄入量", value: "80 克（明确报告，待同步保存）" });
    const conflictDetails = recordDetailFields(breastfeedActivity(), conflict);
    expect(conflictDetails).toContainEqual({ label: "保存状态", value: "待核对，已保存事实保留" });
    expect(conflictDetails).toContainEqual({ label: "报告摄入量", value: "80 克（明确报告，待核对）" });
  });
});
