import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineMode } from "../src/api/timeline";
import type { Activity, RecordSummary } from "../src/model";
import { emptyRecordSummary } from "./fixtures/records";

const fixture = vi.hoisted(() => ({
  identityEnabled: true,
  api: {
    getSnapshot: vi.fn(),
    getActivities: vi.fn(),
    getLatestActivity: vi.fn(),
  },
}));

vi.mock("../src/api", () => ({
  api: fixture.api,
  get identityEnabled() { return fixture.identityEnabled; },
}));

const babyId = "baby-1";
const activity = (id: string): Activity => ({
  id,
  babyId,
  type: "BOTTLE",
  startTime: `2026-10-23T0${id.length}:00:00+08:00`,
  milkAmount: 30,
});
const summary: RecordSummary = emptyRecordSummary();

const load = (mode: TimelineMode, date: string) => {
  vi.resetModules();
  return import("../src/api/timeline").then(({ loadTimeline }) => loadTimeline({
    babyId,
    mode,
    date,
    today: "2026-10-24",
    key: `${mode}:${date}`,
  }));
};

describe("loadTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.identityEnabled = true;
    fixture.api.getSnapshot.mockResolvedValue({ activities: [activity("day")], summary, events: [], questions: [] });
    fixture.api.getActivities.mockImplementation(async (query: { date?: string }) => ({
      activities: [activity(query.date ? "day" : "evening")],
      complete: true,
      limit: 1000,
    }));
  });

  it("uses the sidecar snapshot for a day and the activities range for the previous evening", async () => {
    const result = await load("day", "2026-10-23");

    expect(fixture.api.getSnapshot).toHaveBeenCalledWith(babyId, "2026-10-23");
    expect(fixture.api.getActivities).toHaveBeenCalledTimes(1);
    expect(fixture.api.getActivities).toHaveBeenCalledWith({
      babyId,
      startTimeGte: "2026-10-22T10:00:00.000Z",
      startTimeLt: "2026-10-22T16:00:00.000Z",
    });
    expect(result.activities).toEqual([activity("day")]);
    expect(result.evening).toEqual([activity("evening")]);
    expect(result.recordSummary).toBe(summary);
  });

  it("uses date activities in legacy mode without requesting a snapshot", async () => {
    fixture.identityEnabled = false;
    fixture.api.getSnapshot.mockRejectedValue(new Error("snapshot is sidecar-only"));

    const result = await load("day", "2026-10-23");

    expect(fixture.api.getSnapshot).not.toHaveBeenCalled();
    expect(fixture.api.getActivities.mock.calls.map(([query]) => query)).toEqual([
      { babyId, date: "2026-10-23" },
      { babyId, startTimeGte: "2026-10-22T10:00:00.000Z", startTimeLt: "2026-10-22T16:00:00.000Z" },
    ]);
    expect(result.activities).toEqual([activity("day")]);
    expect(result.evening).toEqual([activity("evening")]);
    expect(result.recordSummary).toBeUndefined();
  });

  it("uses the whole calendar week range", async () => {
    fixture.api.getSnapshot.mockRejectedValue(new Error("weeks do not load snapshots"));
    fixture.api.getActivities.mockResolvedValue({ activities: [activity("week")], complete: true, limit: 1000 });

    const result = await load("week", "2026-10-23");

    expect(fixture.api.getSnapshot).not.toHaveBeenCalled();
    expect(fixture.api.getActivities).toHaveBeenCalledTimes(1);
    expect(fixture.api.getActivities).toHaveBeenCalledWith({
      babyId,
      startTimeGte: "2026-10-18T16:00:00.000Z",
      startTimeLt: "2026-10-25T16:00:00.000Z",
      crossStartTime: true,
      crossEndTime: true,
    });
    expect(result.activities).toEqual([activity("week")]);
    expect(result.evening).toEqual([]);
  });
});
