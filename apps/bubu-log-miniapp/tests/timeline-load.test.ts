import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineLoaded } from "../src/api/timeline";
import type { Activity } from "../src/model/types";
import { emptyRecordSummary } from "./fixtures/records";

const activity = (id: string, startTime: string): Activity => ({ id, type: "SLEEP", startTime });
interface ActivitiesInput { date?: string; startTimeGte?: string; startTimeLt?: string }

describe("timeline loading", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("uses a successful sidecar snapshot without a redundant current-day legacy read", async () => {
    const current = activity("current", "2026-10-23T10:00:00+08:00");
    const previous = activity("previous", "2026-10-22T22:00:00+08:00");
    const latestSleep = activity("latest-sleep", "2026-10-23T08:00:00+08:00");
    const latestFeed = activity("latest-feed", "2026-10-23T09:00:00+08:00");
    const getSnapshot = vi.fn(async () => ({ activities: [current], events: [], questions: [], summary: emptyRecordSummary() }));
    const getActivities = vi.fn(async (_input: ActivitiesInput) => ({ activities: [previous], complete: true, limit: 500 }));
    const getLatestActivity = vi.fn(async (_babyId: string, types: string[]) => types[0] === "SLEEP" ? latestSleep : latestFeed);
    vi.doMock("../src/api/index", () => ({ api: { getSnapshot, getActivities, getLatestActivity }, identityEnabled: true }));
    const { loadTimeline } = await import("../src/api/timeline");

    const result = await loadTimeline({ babyId: "baby-1", mode: "day", date: "2026-10-23", today: "2026-10-23", key: "current" });

    expect(getSnapshot).toHaveBeenCalledWith("baby-1", "2026-10-23");
    expect(getActivities).toHaveBeenCalledTimes(1);
    expect(getActivities.mock.calls[0][0]).toMatchObject({ startTimeGte: expect.any(String), startTimeLt: expect.any(String) });
    expect(getActivities.mock.calls.some(([input]) => input.date === "2026-10-23")).toBe(false);
    expect(getLatestActivity.mock.calls.map(([babyId, types]) => [babyId, types])).toEqual([
      ["baby-1", ["SLEEP"]],
      ["baby-1", ["BREASTFEED", "BOTTLE"]],
    ]);
    expect(result).toMatchObject({ activities: [current], evening: [previous], latest: [latestSleep, latestFeed], recordSummary: expect.anything() } satisfies Partial<TimelineLoaded>);
  });

  it("keeps the current-day legacy activity read in legacy mode", async () => {
    const current = activity("current", "2026-10-23T10:00:00+08:00");
    const previous = activity("previous", "2026-10-22T22:00:00+08:00");
    const latestSleep = activity("latest-sleep", "2026-10-23T08:00:00+08:00");
    const latestFeed = activity("latest-feed", "2026-10-23T09:00:00+08:00");
    const getSnapshot = vi.fn(async () => { throw new Error("sidecar snapshot must not be requested"); });
    const getActivities = vi.fn(async (input: ActivitiesInput) => (
      input.date ? { activities: [current], complete: true, limit: 500 } : { activities: [previous], complete: true, limit: 500 }
    ));
    const getLatestActivity = vi.fn(async (_babyId: string, types: string[]) => types[0] === "SLEEP" ? latestSleep : latestFeed);
    vi.doMock("../src/api/index", () => ({ api: { getSnapshot, getActivities, getLatestActivity }, identityEnabled: false }));
    const { loadTimeline } = await import("../src/api/timeline");

    const result = await loadTimeline({ babyId: "baby-1", mode: "day", date: "2026-10-23", today: "2026-10-23", key: "current" });

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(getActivities).toHaveBeenCalledTimes(2);
    expect(getActivities.mock.calls.filter(([input]) => input.date === "2026-10-23")).toHaveLength(1);
    expect(getActivities.mock.calls.some(([input]) => Boolean(input.startTimeGte && input.startTimeLt))).toBe(true);
    expect(getLatestActivity).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ activities: [current], evening: [previous], latest: [latestSleep, latestFeed] } satisfies Partial<TimelineLoaded>);
    expect("recordSummary" in result).toBe(false);
  });
});
