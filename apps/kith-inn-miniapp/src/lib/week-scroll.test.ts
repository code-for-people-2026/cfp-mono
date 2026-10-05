import { afterEach, expect, it, vi } from "vitest";
import { createWeekScrollSnap, snapWeekScroll } from "./week-scroll";

afterEach(() => { vi.useRealTimers(); });

it("keeps Sunday fully visible at the end instead of snapping back to Friday", () => {
  // Observed 390px H5 layout: 118px day columns, 8px gaps, 311px viewport.
  expect(snapWeekScroll(563, 874, 311)).toBe(563);
  expect(snapWeekScroll(550, 874, 311)).toBe(563);
  expect(snapWeekScroll(520, 874, 311)).toBe(504);
  expect(snapWeekScroll(190, 874, 311)).toBe(252);
  expect(snapWeekScroll(-20, 874, 311)).toBe(0);
  expect(snapWeekScroll(900, 874, 311)).toBe(563);
  expect(snapWeekScroll(0, 280, 311)).toBe(0);
  expect(snapWeekScroll(563.5, 874.5, 311)).toBe(563.5);
});

it("waits for the gesture and inertia, snaps once, and ignores its own animation", () => {
  vi.useFakeTimers();
  const scrollTo = vi.fn();
  const read = vi.fn((receive: (view: { width: number; scrollTo: (left: number) => void }) => void) => receive({ width: 311, scrollTo }));
  const snap = createWeekScrollSnap(read);
  const move = (scrollLeft: number) => snap.scroll({ scrollLeft, scrollWidth: 874 });
  snap.start(); move(190); snap.settle(); vi.advanceTimersByTime(1000);
  expect(read).not.toHaveBeenCalled(); // Holding the finger still must not issue commands.
  snap.end(); vi.advanceTimersByTime(120); move(280); vi.advanceTimersByTime(179);
  expect(read).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(scrollTo.mock.calls).toEqual([[252]]);
  move(275); move(260); move(252); snap.settle(); vi.advanceTimersByTime(1000);
  expect(read).toHaveBeenCalledTimes(1);

  // Reverse direction, then return to the same target in a separate gesture.
  for (const left of [170, 155]) {
    snap.start(); move(left); snap.end(); snap.settle(); move(126); snap.settle();
  }
  expect(scrollTo.mock.calls).toEqual([[252], [126], [126]]);
  snap.start(); move(550); snap.end(); snap.settle(); move(563); snap.settle();
  expect(scrollTo.mock.calls).toEqual([[252], [126], [126], [563]]);
  snap.dispose();
});

it("discards a delayed measurement when another gesture starts or the board unmounts", () => {
  vi.useFakeTimers();
  const scrollTo = vi.fn();
  const callbacks: ((view: { width: number; scrollTo: (left: number) => void }) => void)[] = [];
  const snap = createWeekScrollSnap((receive) => { callbacks.push(receive); });
  snap.start(); snap.scroll({ scrollLeft: 280, scrollWidth: 874 }); snap.end(); snap.settle();
  snap.start(); callbacks[0]!({ width: 311, scrollTo });
  expect(scrollTo).not.toHaveBeenCalled();
  snap.scroll({ scrollLeft: 400, scrollWidth: 874 }); snap.end(); snap.settle();
  snap.dispose(); callbacks[1]!({ width: 311, scrollTo }); vi.runAllTimers();
  expect(scrollTo).not.toHaveBeenCalled();
  expect(callbacks).toHaveLength(2);
});
