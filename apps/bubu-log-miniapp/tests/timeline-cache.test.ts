import { describe, expect, it } from "vitest";
import type { TimelineLoaded } from "../src/api/timeline";
import {
  TimelineCacheStaleError,
  TimelinePrefetchCache,
  type TimelineCacheContext,
  type TimelineCacheIdentity,
} from "../src/navigation/timeline-cache";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const identity = (babyId: string, epoch = 0): TimelineCacheIdentity => ({
  epoch,
  babyId,
  revision: 0,
  today: "2026-11-07",
});

const context = (
  date: string,
  owner: TimelineCacheIdentity = identity("baby-1"),
): TimelineCacheContext => ({ identity: owner, mode: "day", date });

const loaded = (key: string): TimelineLoaded => ({
  key,
  activities: [],
  evening: [],
  latest: [],
  stats: [],
  complete: true,
});

describe("TimelinePrefetchCache", () => {
  it("deduplicates concurrent requests for one cache entry", async () => {
    const cache = new TimelinePrefetchCache();
    const pending = deferred<TimelineLoaded>();
    let requests = 0;
    const owner = context("2026-11-07");

    const first = cache.load(owner, () => {
      requests += 1;
      return pending.promise;
    });
    const second = cache.load(owner, () => {
      throw new Error("a deduplicated request must not call the loader");
    });

    expect(requests).toBe(1);
    pending.resolve(loaded("first"));
    expect(await Promise.all([first, second])).toEqual([loaded("first"), loaded("first")]);
  });

  it("keeps only the most recently used entries", async () => {
    const cache = new TimelinePrefetchCache(2);
    await cache.load(context("2026-11-05"), async () => loaded("first"));
    await cache.load(context("2026-11-06"), async () => loaded("second"));
    await cache.load(context("2026-11-07"), async () => loaded("third"));

    expect(cache.size).toBe(2);
    expect(cache.peek(context("2026-11-05"))).toBeNull();
    expect(cache.peek(context("2026-11-06"))?.key).toBe("second");
    expect(cache.peek(context("2026-11-07"))?.key).toBe("third");
  });

  it("rejects an old response after reset so it cannot repopulate the same identity", async () => {
    const cache = new TimelinePrefetchCache();
    const owner = context("2026-11-07");
    const old = deferred<TimelineLoaded>();
    const next = deferred<TimelineLoaded>();
    const oldRequest = cache.load(owner, () => old.promise);

    cache.reset();
    const newRequest = cache.load(owner, () => next.promise);

    old.resolve(loaded("stale"));
    await expect(oldRequest).rejects.toBeInstanceOf(TimelineCacheStaleError);
    next.resolve(loaded("current"));
    await newRequest;
    expect(cache.peek(owner)?.key).toBe("current");
  });

  it("does not let an old failure remove a replacement in-flight request", async () => {
    const cache = new TimelinePrefetchCache();
    const owner = context("2026-11-07");
    const old = deferred<TimelineLoaded>();
    const next = deferred<TimelineLoaded>();
    const oldRequest = cache.load(owner, () => old.promise);

    cache.reset();
    const newRequest = cache.load(owner, () => next.promise);
    old.reject(new Error("old request failed"));

    await expect(oldRequest).rejects.toBeInstanceOf(Error);
    next.resolve(loaded("replacement"));
    await newRequest;
    expect(cache.peek(owner)?.key).toBe("replacement");
  });

  it("discards old entries and responses when the identity switches", async () => {
    const cache = new TimelinePrefetchCache();
    const firstOwner = identity("baby-1");
    const secondOwner = identity("baby-2");
    const old = deferred<TimelineLoaded>();
    const oldRequest = cache.load(context("2026-11-07", firstOwner), () => old.promise);

    const newRequest = cache.load(context("2026-11-07", secondOwner), async () => loaded("new-baby"));
    old.resolve(loaded("old-baby"));
    await expect(oldRequest).rejects.toBeInstanceOf(TimelineCacheStaleError);
    await newRequest;

    expect(cache.peek(context("2026-11-07", secondOwner))?.key).toBe("new-baby");
    expect(cache.peek(context("2026-11-07", firstOwner))).toBeNull();
  });
});
