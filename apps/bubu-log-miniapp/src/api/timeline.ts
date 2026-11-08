import { api, identityEnabled } from ".";
import { calendarPeriod, dayBounds } from "../model";
import type { Activity, DailyStat, RecordSummary } from "../model";

export type TimelineMode = "day" | "week";

export interface TimelineLoaded {
  key: string;
  activities: Activity[];
  evening: Activity[];
  latest: Activity[];
  stats: DailyStat[];
  complete: boolean;
  recordSummary?: RecordSummary;
  birthDate?: string | null;
  profileError?: string;
}

const iso = (value: number) => new Date(value).toISOString();

/** Existing day/week reads, extracted without adding any API endpoint. */
export async function loadTimeline(options: {
  babyId: string;
  mode: TimelineMode;
  date: string;
  today: string;
  key: string;
}): Promise<TimelineLoaded> {
  const { babyId, mode, date, today, key } = options;
  if (mode === "week") {
    const week = calendarPeriod("week", date);
    const result = await api.getActivities({
      babyId,
      startTimeGte: iso(dayBounds(week.start).start),
      startTimeLt: iso(dayBounds(week.end).next),
      crossStartTime: true,
      crossEndTime: true,
    });
    return { key, ...result, evening: [], latest: [], stats: [] };
  }

  const bounds = dayBounds(date).start;
  if (identityEnabled) {
    // The snapshot carries the sidecar record projection and its live summary.
    // The previous-evening range is still read through the sidecar activities route.
    const [snapshot, previous] = await Promise.all([
      api.getSnapshot(babyId, date),
      api.getActivities({
        babyId,
        startTimeGte: iso(bounds - 6 * 3600000),
        startTimeLt: iso(bounds),
      }),
    ]);
    const latest = date === today
      ? (await Promise.all([
        api.getLatestActivity(babyId, ["SLEEP"]),
        api.getLatestActivity(babyId, ["BREASTFEED", "BOTTLE"]),
      ])).filter((activity): activity is Activity => activity !== null)
      : [];
    return {
      key,
      activities: snapshot.activities,
      evening: previous.activities,
      latest,
      stats: [],
      complete: previous.complete,
      recordSummary: snapshot.summary,
    };
  }

  const [result, previous] = await Promise.all([
    api.getActivities({ babyId, date }),
    api.getActivities({
      babyId,
      startTimeGte: iso(bounds - 6 * 3600000),
      startTimeLt: iso(bounds),
    }),
  ]);
  const latest = date === today
    ? (await Promise.all([
      api.getLatestActivity(babyId, ["SLEEP"]),
      api.getLatestActivity(babyId, ["BREASTFEED", "BOTTLE"]),
    ])).filter((activity): activity is Activity => activity !== null)
    : [];
  return {
    key,
    ...result,
    complete: result.complete && previous.complete,
    evening: previous.activities,
    latest,
    stats: [],
  };
}
