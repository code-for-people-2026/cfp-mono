import { describe, expect, it } from "vitest";
import {
  MIN_PINCH_SEPARATION,
  SWIPE_THRESHOLD,
  cancelGesture,
  createGestureState,
  pointerDown,
  pointerMove,
  pointerUp,
  resolvePinchFrame,
  type GestureConfig,
  type GestureMetrics,
  type GestureState,
} from "../src/gestures/model";

const config: GestureConfig = {
  canNext: true,
  labels: { previous: "前一天", next: "后一天", current: "今天" },
};

const metrics = (overrides: Partial<GestureMetrics> = {}): GestureMetrics => ({
  scrollTop: 300,
  viewportHeight: 400,
  contentHeight: 1392,
  canvasTop: 12,
  canvasHeight: 1392,
  ...overrides,
});

const point = (x: number, y: number) => ({ x, y });

function start(
  points = [point(200, 200)],
  overrides: Partial<GestureMetrics> = {},
  gestureConfig: GestureConfig = config,
  scale = 1,
): GestureState {
  return pointerDown(createGestureState(scale), {
    points,
    metrics: metrics(overrides),
    scale,
    config: gestureConfig,
  });
}

function move(state: GestureState, points: Array<{ x: number; y: number }>, overrides: Partial<GestureMetrics> = {}, gestureConfig: GestureConfig = config) {
  return pointerMove(state, { points, metrics: metrics(overrides), config: gestureConfig });
}

function up(
  state: GestureState,
  remaining: Array<{ x: number; y: number }> = [],
  changed: Array<{ x: number; y: number }> = [],
  overrides: Partial<GestureMetrics> = {},
  gestureConfig: GestureConfig = config,
) {
  return pointerUp(state, {
    remaining,
    changed,
    metrics: metrics(overrides),
    config: gestureConfig,
  });
}

describe("one-finger axis gestures", () => {
  it("arms a left swipe for the next period only past the physical threshold", () => {
    const begun = start();
    const below = move(begun, [point(200 - SWIPE_THRESHOLD + 1, 200)]);
    expect(below.state.phase).toBe("horizontal");
    expect(below.state.armed).toBe(false);
    expect(below.state.feedback).toBe("继续左滑查看后一天");
    expect(up(below.state, [], [point(130, 200)]).navigation).toBeNull();

    const armed = move(begun, [point(200 - SWIPE_THRESHOLD, 200)]);
    expect(armed.state.armed).toBe(true);
    expect(armed.state.feedback).toBe("松开切换后一天");
    expect(up(armed.state, [], [point(120, 200)]).navigation).toBe("next");
  });

  it("maps a right swipe to the previous period and cancels when the drag returns below threshold", () => {
    const begun = start();
    const armed = move(begun, [point(200 + SWIPE_THRESHOLD + 10, 200)]);
    expect(armed.state.direction).toBe("prev");
    expect(armed.state.armed).toBe(true);
    const returned = move(armed.state, [point(200 + 30, 200)]);
    expect(returned.state.armed).toBe(false);
    expect(returned.state.feedback).toBe("继续右滑查看前一天");
    expect(up(returned.state, [], [point(230, 200)]).navigation).toBeNull();
    expect(up(armed.state, [], [point(300, 200)]).navigation).toBe("prev");
  });

  it("never requests a future period and reports the current limit", () => {
    const blockedConfig: GestureConfig = {
      canNext: false,
      labels: { previous: "前一天", next: "后一天", current: "今天" },
    };
    const begun = start([point(200, 200)], {}, blockedConfig);
    const moved = move(begun, [point(80, 200)], {}, blockedConfig);
    expect(moved.state.armed).toBe(false);
    expect(moved.state.feedback).toBe("已经是今天，无法查看未来");
    const ended = up(moved.state, [], [point(80, 200)], {}, blockedConfig);
    expect(ended.navigation).toBeNull();
    expect(ended.blocked).toBe(true);
    expect(ended.state.feedback).toBe("已经是今天，无法查看未来");
  });

  it("keeps a dominant diagonal drag at the top as ordinary scrolling", () => {
    const begun = start([point(200, 200)], { scrollTop: 0 });
    const diagonal = move(begun, [point(230, 240)], { scrollTop: 0 });
    expect(diagonal.state).toMatchObject({
      phase: "scroll",
      edge: null,
      direction: null,
      armed: false,
      feedback: "",
      paperTurn: { phase: "idle", direction: null, displacement: 0 },
    });
    const outward = move(diagonal.state, [point(232, 300)], { scrollTop: 0 });
    expect(outward.state.phase).toBe("scroll");
    expect(outward.state.armed).toBe(false);
    expect(outward.state.paperTurn.phase).toBe("idle");
    expect(up(outward.state, [], [point(232, 300)], { scrollTop: 0 }).navigation).toBeNull();
  });

  it("keeps an ordinary mid-list vertical drag as scrolling even if it reaches the top", () => {
    const begun = start([point(200, 200)], { scrollTop: 100 });
    const moved = move(begun, [point(200, 400)], { scrollTop: 0 });
    expect(moved.state.phase).toBe("scroll");
    expect(moved.state.armed).toBe(false);
    expect(moved.state.feedback).toBe("");
    expect(up(moved.state, [], [point(200, 400)], { scrollTop: 0 }).navigation).toBeNull();
  });

  it("keeps an inward drag from either boundary as ordinary scrolling", () => {
    const top = start([point(200, 200)], { scrollTop: 0 });
    const upInward = move(top, [point(200, 100)], { scrollTop: 0 });
    expect(upInward.state.phase).toBe("scroll");
    expect(upInward.state.armed).toBe(false);

    const bottom = start([point(200, 200)], { scrollTop: 992, contentHeight: 1392 });
    const downInward = move(bottom, [point(200, 300)], { scrollTop: 992, contentHeight: 1392 });
    expect(downInward.state.phase).toBe("scroll");
  });

  it("keeps a dominant bottom-boundary drag as scrolling even when next is available", () => {
    const bottom = start([point(200, 400)], { scrollTop: 992, contentHeight: 1392 });
    const outward = move(bottom, [point(200, 280)], { scrollTop: 992, contentHeight: 1392 });
    expect(outward.state).toMatchObject({
      phase: "scroll",
      edge: null,
      direction: null,
      armed: false,
      feedback: "",
      paperTurn: { phase: "idle", direction: null, displacement: 0 },
    });
    const ended = up(outward.state, [], [point(200, 280)], { scrollTop: 992, contentHeight: 1392 });
    expect(ended.navigation).toBeNull();
    expect(ended.state.paperTurn.phase).toBe("idle");
  });

  it("cancels touch sequences without navigation and suppresses the following click", () => {
    const begun = start();
    const moved = move(begun, [point(100, 200)]);
    const cancelled = cancelGesture(moved.state);
    expect(cancelled.phase).toBe("done");
    expect(cancelled.suppressClick).toBe(true);
    expect(up(cancelled).navigation).toBeNull();
  });
});

describe("two-finger pinch state", () => {
  const pinchStart = () => pointerDown(createGestureState(1), {
    points: [point(100, 150), point(100, 250)],
    metrics: metrics({ scrollTop: 300, contentHeight: 1392, canvasTop: 0, canvasHeight: 1000 }),
    scale: 1,
    config,
  });

  it("scales around the pinch midpoint and keeps the time under it anchored", () => {
    const begun = pinchStart();
    expect(begun.phase).toBe("pinch");
    const update = pointerMove(begun, {
      points: [point(100, 100), point(100, 300)],
      metrics: metrics({ scrollTop: 300, contentHeight: 1392, canvasTop: 0, canvasHeight: 1000 }),
      config,
    });
    expect(update.scaleChanged).toBe(true);
    expect(update.state.scale).toBe(2);
    expect(update.scrollTop).toBeCloseTo(800, 3);
  });

  it("clamps the usable scale at both ends", () => {
    const begun = pinchStart();
    const wide = pointerMove(begun, {
      points: [point(100, -100), point(100, 500)],
      metrics: metrics({ scrollTop: 300, contentHeight: 1392, canvasTop: 0, canvasHeight: 1000 }),
      config,
    });
    expect(wide.state.scale).toBe(3);
    const narrow = pointerMove(begun, {
      points: [point(100, 196), point(100, 216)],
      metrics: metrics({ scrollTop: 300, contentHeight: 1392, canvasTop: 0, canvasHeight: 1000 }),
      config,
    });
    expect(narrow.state.scale).toBe(0.5);
  });

  it("does not zoom when fingers move together or the starting separation is tiny", () => {
    const begun = pinchStart();
    const movedTogether = pointerMove(begun, {
      points: [point(100, 200), point(100, 300)],
      metrics: metrics({ scrollTop: 300, contentHeight: 1392, canvasTop: 0, canvasHeight: 1000 }),
      config,
    });
    expect(movedTogether.state.scale).toBe(1);

    const tiny = pointerDown(createGestureState(1), {
      points: [point(100, 200), point(100, 200 + MIN_PINCH_SEPARATION - 1)],
      metrics: metrics(),
      scale: 1,
      config,
    });
    expect(tiny.phase).toBe("blocked");
    expect(tiny.suppressClick).toBe(true);
  });

  it("freezes scale instead of jumping when fingers cross or nearly touch", () => {
    const begun = pinchStart();
    const crossed = pointerMove(begun, {
      points: [point(100, 199), point(100, 203)],
      metrics: metrics({ scrollTop: 300, contentHeight: 1392, canvasTop: 0, canvasHeight: 1000 }),
      config,
    });
    expect(crossed.state.scale).toBe(1);
    expect(crossed.scrollTop).toBeNull();
  });

  it("anchors with explicit frame math and clamps at both scroll edges", () => {
    const middle = resolvePinchFrame({
      pinchStartScale: 1, startDistance: 100, currentScale: 1, distance: 200,
      midY: 200, scrollTop: 300, canvasTop: 0, baseCanvasHeight: 1000,
      viewportHeight: 400, bottomPad: 392,
    });
    expect(middle.scale).toBe(2);
    expect(middle.scrollTop).toBeCloseTo(800, 3);

    const atTop = resolvePinchFrame({
      pinchStartScale: 1, startDistance: 100, currentScale: 2, distance: 50,
      midY: 0, scrollTop: 0, canvasTop: 0, baseCanvasHeight: 1000,
      viewportHeight: 400, bottomPad: 0,
    });
    expect(atTop.scale).toBe(0.5);
    expect(atTop.scrollTop).toBe(0);

    const atBottom = resolvePinchFrame({
      pinchStartScale: 1, startDistance: 100, currentScale: 2, distance: 200,
      midY: 400, scrollTop: 4000, canvasTop: 0, baseCanvasHeight: 1000,
      viewportHeight: 400, bottomPad: 0,
    });
    expect(atBottom.scale).toBe(2);
    expect(atBottom.scrollTop).toBe(1600);
  });

  it("consumes one-to-two-to-one transitions and extra touches without navigating", () => {
    let state = start();
    state = pointerDown(state, {
      points: [point(100, 150), point(100, 250)],
      metrics: metrics({ canvasTop: 0, canvasHeight: 1000 }),
      scale: 1,
      config,
    });
    expect(state.phase).toBe("pinch");

    const oneLeft = up(state, [point(100, 250)], [point(100, 150)], { canvasTop: 0, canvasHeight: 1000 });
    expect(oneLeft.state.phase).toBe("blocked");
    expect(oneLeft.navigation).toBeNull();
    const final = up(oneLeft.state);
    expect(final.navigation).toBeNull();
    expect(final.state.suppressClick).toBe(true);

    const third = pointerDown(createGestureState(1), {
      points: [point(100, 100), point(100, 200), point(100, 300)],
      metrics: metrics(),
      scale: 1,
      config,
    });
    expect(third.phase).toBe("blocked");
    expect(up(third).navigation).toBeNull();
  });
});

describe("click suppression", () => {
  it("allows a plain tap but suppresses a drag or pinch release", () => {
    const tap = start();
    const tapEnd = up(tap, [], [point(200, 200)]);
    expect(tapEnd.state.suppressClick).toBe(false);

    const drag = move(start(), [point(80, 200)]);
    const dragEnd = up(drag.state, [], [point(80, 200)]);
    expect(dragEnd.state.suppressClick).toBe(true);

    const pinch = pointerDown(createGestureState(1), {
      points: [point(100, 150), point(100, 250)],
      metrics: metrics({ canvasTop: 0, canvasHeight: 1000 }),
      scale: 1,
      config,
    });
    expect(up(pinch).state.suppressClick).toBe(true);
  });
});
