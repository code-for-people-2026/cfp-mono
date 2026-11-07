import { describe, expect, it } from "vitest";
import {
  createGestureState,
  pointerDown,
  pointerMove,
  pointerUp,
  type GestureConfig,
  type GestureMetrics,
  type GesturePoint,
  type GestureState,
} from "../src/gestures/model";
import {
  completedPaperTurnDisplacement,
  resolvePaperTurnTransform,
} from "../src/gestures/paper-turn";

const metrics = (overrides: Partial<GestureMetrics> = {}): GestureMetrics => ({
  scrollTop: 0,
  viewportHeight: 400,
  contentHeight: 800,
  canvasTop: 0,
  canvasHeight: 800,
  ...overrides,
});

const config = (canNext = true): GestureConfig => ({
  canNext,
  labels: { previous: "前一天", next: "后一天", current: "今天" },
});

const point = (x: number, y: number): GesturePoint => ({ x, y });

const drag = (
  start: GesturePoint,
  end: GesturePoint,
  geometry: GestureMetrics = metrics(),
  settings: GestureConfig = config(),
): GestureState => {
  let state = pointerDown(createGestureState(), {
    points: [start],
    metrics: geometry,
    scale: 1,
    config: settings,
  });
  state = pointerMove(state, { points: [end], metrics: geometry, config: settings }).state;
  return state;
};

describe("paper-turn geometry", () => {
  it("keeps left as previous and right as next on the horizontal axis", () => {
    expect(resolvePaperTurnTransform({
      axis: "horizontal", direction: "prev", phase: "drag",
      displacement: -160, size: 320, side: "neighbor",
    })).toEqual({ x: 160, y: 0, progress: 0.5 });
    expect(resolvePaperTurnTransform({
      axis: "horizontal", direction: "next", phase: "drag",
      displacement: 160, size: 320, side: "current",
    })).toEqual({ x: 160, y: 0, progress: 0.5 });
    expect(completedPaperTurnDisplacement("horizontal", "prev", 320)).toBe(-320);
    expect(completedPaperTurnDisplacement("horizontal", "next", 320)).toBe(320);
  });

  it("uses downward top pulls and signed upward bottom pulls on the vertical axis", () => {
    expect(resolvePaperTurnTransform({
      axis: "vertical", direction: "prev", phase: "drag",
      displacement: 160, size: 400, side: "neighbor",
    })).toEqual({ x: 0, y: -240, progress: 0.4 });
    expect(resolvePaperTurnTransform({
      axis: "vertical", direction: "next", phase: "drag",
      displacement: -160, size: 400, side: "current",
    })).toEqual({ x: 0, y: -160, progress: 0.4 });
    expect(completedPaperTurnDisplacement("vertical", "prev", 400)).toBe(400);
    expect(completedPaperTurnDisplacement("vertical", "next", 400)).toBe(-400);

    const state = drag(
      point(100, 300),
      point(100, 240),
      metrics({ scrollTop: 400, contentHeight: 800 }),
      config(true),
    );
    expect(state.phase).toBe("pull");
    expect(state.edge).toBe("bottom");
    expect(state.direction).toBe("next");
    expect(state.paperTurn).toMatchObject({
      axis: "vertical", direction: "next", phase: "drag", displacement: -60,
    });
  });
});

describe("paper-turn release", () => {
  it("commits with a complete target while preserving the selected axis and direction", () => {
    const state = drag(point(100, 100), point(20, 100));
    const update = pointerUp(state, {
      remaining: [],
      changed: [point(20, 100)],
      metrics: metrics(),
      config: config(),
    });

    expect(update.navigation).toBe("prev");
    expect(update.state.phase).toBe("settling");
    expect(update.state.paperTurn).toMatchObject({
      axis: "horizontal", direction: "prev", phase: "complete", displacement: 0,
    });
  });

  it("recoils below the threshold without losing the selected geometry", () => {
    const state = drag(point(100, 0), point(100, 24), metrics());
    const update = pointerUp(state, {
      remaining: [],
      changed: [point(100, 24)],
      metrics: metrics(),
      config: config(),
    });

    expect(update.navigation).toBeNull();
    expect(update.state.phase).toBe("settling");
    expect(update.state.paperTurn).toMatchObject({
      axis: "vertical", direction: "prev", phase: "recoil", displacement: 0,
    });
  });

  it("never reveals a future page when next is blocked", () => {
    const settings = config(false);
    const state = drag(point(100, 100), point(180, 100), metrics(), settings);
    expect(resolvePaperTurnTransform({
      axis: state.paperTurn.axis,
      direction: state.paperTurn.direction ?? "next",
      phase: state.paperTurn.phase,
      displacement: state.paperTurn.displacement,
      size: 320,
      side: "current",
    }).progress).toBe(0);

    const update = pointerUp(state, {
      remaining: [],
      changed: [point(180, 100)],
      metrics: metrics(),
      config: settings,
    });
    expect(update.blocked).toBe(true);
    expect(update.navigation).toBeNull();
    expect(update.state.paperTurn.phase).toBe("idle");
    expect(update.state.paperTurn.displacement).toBe(0);
  });

  it("cancels a pending one-finger drag when a second finger arrives", () => {
    let state = pointerDown(createGestureState(), {
      points: [point(100, 100)],
      metrics: metrics(),
      scale: 1,
      config: config(),
    });
    state = pointerMove(state, {
      points: [point(50, 100)],
      metrics: metrics(),
      config: config(),
    }).state;
    expect(state.phase).toBe("horizontal");

    state = pointerDown(state, {
      points: [point(50, 100), point(50, 220)],
      metrics: metrics(),
      scale: 1,
      config: config(),
    });
    expect(state.phase).toBe("blocked");
    expect(state.paperTurn.phase).toBe("idle");
    expect(state.paperTurn.displacement).toBe(0);
  });

  it("preserves the pinch anchor and scale for a fresh two-finger gesture", () => {
    const state = pointerDown(createGestureState(), {
      points: [point(100, 100), point(100, 300)],
      metrics: metrics({ canvasTop: 100, canvasHeight: 1000, contentHeight: 1100 }),
      scale: 1,
      config: config(),
    });
    const update = pointerMove(state, {
      points: [point(100, 80), point(100, 340)],
      metrics: metrics({ canvasTop: 100, canvasHeight: 1000, contentHeight: 1100 }),
      config: config(),
    });

    expect(update.state.phase).toBe("pinch");
    expect(update.scaleChanged).toBe(true);
    expect(update.state.scale).toBeCloseTo(1.3, 5);
    const anchorRatio = (0 + 210 - 100) / 1000;
    expect(anchorRatio).toBeCloseTo(0.11, 5);
    expect(update.scrollTop).toBeCloseTo(100 + anchorRatio * 1300 - 210, 5);
    expect(update.scrollTop).toBeCloseTo(33, 5);
  });
});
