import type { TimelineLoaded, TimelineMode } from "../api/timeline";
import { calendarPeriod, dateKey } from "../model";

export interface TimelineCacheIdentity {
  epoch: number;
  babyId: string;
  revision: number;
  today: string;
}

export interface TimelineCacheContext {
  identity: TimelineCacheIdentity;
  mode: TimelineMode;
  date: string;
}

/** Timeline display keys use the period start, not the arbitrary weekday selected in week mode. */
export function timelinePeriodDate(mode: TimelineMode, date: string): string {
  return mode === "week" ? calendarPeriod("week", date).start : dateKey(date);
}

export function timelineDataKey(
  mode: TimelineMode,
  date: string,
  babyId: string,
  revision: number,
): string {
  return `${babyId}:${mode}:${timelinePeriodDate(mode, date)}:${revision}`;
}

export const timelineCacheIdentityKey = (identity: TimelineCacheIdentity): string =>
  `${identity.epoch}:${identity.babyId}:${identity.revision}:${identity.today}`;

export const timelineCacheKey = (context: TimelineCacheContext): string =>
  `${timelineCacheIdentityKey(context.identity)}:${context.mode}:${timelinePeriodDate(context.mode, context.date)}`;

export const timelineDisplayKey = (context: TimelineCacheContext): string =>
  timelineDataKey(
    context.mode,
    context.date,
    context.identity.babyId,
    context.identity.revision,
  );

export class TimelineCacheStaleError extends Error {
  constructor() {
    super("Timeline request was superseded");
    this.name = "TimelineCacheStaleError";
  }
}

/** Bounded in-memory LRU; timeline data is never persisted. */
export class TimelinePrefetchCache {
  private readonly limit: number;
  private entries = new Map<string, TimelineLoaded>();
  private inflight = new Map<string, Promise<TimelineLoaded>>();
  private identityKey = "";
  private generation = 0;

  constructor(limit = 5) {
    this.limit = Math.max(1, limit);
  }

  get size(): number {
    return this.entries.size;
  }

  peek(context: TimelineCacheContext): TimelineLoaded | null {
    this.ensureIdentity(context);
    const key = timelineCacheKey(context);
    const value = this.entries.get(key) ?? null;
    if (value) this.touch(key);
    return value;
  }

  reset(): void {
    this.generation += 1;
    this.entries.clear();
    this.inflight.clear();
    this.identityKey = "";
  }

  async load(
    context: TimelineCacheContext,
    request: () => Promise<TimelineLoaded>,
  ): Promise<TimelineLoaded> {
    this.ensureIdentity(context);
    const key = timelineCacheKey(context);
    const cached = this.entries.get(key);
    if (cached) {
      this.touch(key);
      return cached;
    }
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const generation = this.generation;
    const identityKey = timelineCacheIdentityKey(context.identity);
    const pending = request().then((data) => {
      if (this.generation !== generation || this.identityKey !== identityKey) {
        throw new TimelineCacheStaleError();
      }
      this.entries.set(key, data);
      this.touch(key);
      this.prune();
      return data;
    });

    this.inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      // A replacement may already have taken this exact cache slot after a reset.
      if (this.inflight.get(key) === pending) this.inflight.delete(key);
    }
  }

  private ensureIdentity(context: TimelineCacheContext): void {
    const next = timelineCacheIdentityKey(context.identity);
    if (this.identityKey === next) return;
    this.generation += 1;
    this.entries.clear();
    this.inflight.clear();
    this.identityKey = next;
  }

  private touch(key: string): void {
    const value = this.entries.get(key);
    if (!value) return;
    this.entries.delete(key);
    this.entries.set(key, value);
  }

  private prune(): void {
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest == null) break;
      this.entries.delete(oldest);
    }
  }
}
