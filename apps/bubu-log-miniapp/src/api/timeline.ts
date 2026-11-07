import { api } from ".";
import { calendarPeriod, dayBounds } from "../model";
import type { Activity, DailyStat } from "../model";

export type TimelineMode = "day" | "week";

export interface TimelineLoaded {
  key: string;
  activities: Activity[];
  evening: Activity[];
  latest: Activity[];
  stats: DailyStat[];
  complete: boolean;
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
