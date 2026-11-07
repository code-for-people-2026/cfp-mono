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
  resolvePaperCurl,
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
  it("keeps right as previous and left as next on the horizontal axis", () => {
    expect(resolvePaperTurnTransform({
      axis: "horizontal", direction: "prev", phase: "drag",
      displacement: 160, size: 320, side: "neighbor",
    })).toEqual({ x: -160, y: 0, progress: 0.5 });
    expect(resolvePaperTurnTransform({
      axis: "horizontal", direction: "next", phase: "drag",
      displacement: -160, size: 320, side: "current",
    })).toEqual({ x: -160, y: 0, progress: 0.5 });
    expect(completedPaperTurnDisplacement("horizontal", "prev", 320)).toBe(320);
    expect(completedPaperTurnDisplacement("horizontal", "next", 320)).toBe(-320);
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

  it("captures the first touch once and follows cross-axis direction changes", () => {
    const settings = config(true);
    let state = pointerDown(createGestureState(), {
      points: [point(100, 100)],
      metrics: metrics(),
      scale: 1,
      config: settings,
    });
    state = pointerMove(state, {
      points: [point(220, 76)],
      metrics: metrics(),
      config: settings,
    }).state;
    expect(state.paperTurn).toMatchObject({
      direction: "prev",
      displacement: 120,
      crossDisplacement: -24,
      origin: { x: 100, y: 100 },
    });

    state = pointerMove(state, {
      points: [point(20, 124)],
      metrics: metrics(),
      config: settings,
    }).state;
    expect(state.paperTurn).toMatchObject({
      direction: "next",
      displacement: -80,
      crossDisplacement: 24,
      origin: { x: 100, y: 100 },
    });
  });
});

describe("paper curl", () => {
  const curl = (overrides: Partial<Parameters<typeof resolvePaperCurl>[0]> = {}) => resolvePaperCurl({
    axis: "horizontal",
    phase: "drag",
    displacement: 100,
    crossDisplacement: 0,
    origin: { x: 120, y: 180 },
    width: 320,
    height: 400,
    ...overrides,
  });

  it("reverses the touch angle within one gesture without snapping direction", () => {
    let state = pointerDown(createGestureState(), {
      points: [point(160, 200)],
      metrics: metrics(),
      scale: 1,
      config: config(),
    });
    state = pointerMove(state, {
      points: [point(260, 180)],
      metrics: metrics(),
      config: config(),
    }).state;
    const rightward = curl(state.paperTurn);
    state = pointerMove(state, {
      points: [point(60, 220)],
      metrics: metrics(),
      config: config(),
    }).state;
    const leftward = curl(state.paperTurn);

    expect(rightward.angle).toBeLessThan(0);
    expect(leftward.angle).toBeGreaterThan(0);
    expect(leftward.angle).toBeCloseTo(-rightward.angle, 10);
    expect(curl({ ...state.paperTurn, crossDisplacement: 0 }).angle).toBe(0);
  });

  it("keeps every output finite and within the visual bounds", () => {
    const result = curl({
      displacement: Number.NaN,
      crossDisplacement: Number.POSITIVE_INFINITY,
      origin: { x: Number.NEGATIVE_INFINITY, y: Number.NaN },
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY,
    });
    expect(Object.values(result).every(Number.isFinite)).toBe(true);
    expect(result.angle).toBeGreaterThanOrEqual(-8);
    expect(result.angle).toBeLessThanOrEqual(8);
    expect(result.curlSize).toBeLessThanOrEqual(36);
    expect(result.shadowOpacity).toBeLessThanOrEqual(0.3);

    const bounded = curl({ displacement: 320, crossDisplacement: 10000 });
    expect(bounded.angle).toBe(8);
    expect(bounded.curlSize).toBeLessThanOrEqual(36);
    expect(bounded.shadowOpacity).toBeLessThanOrEqual(0.3);
  });

  it("opens smoothly and saturates before the swipe threshold", () => {
    expect(curl({ displacement: 0, crossDisplacement: 40 }).angle).toBe(0);
    const near = curl({ displacement: 1, crossDisplacement: 20 });
    const saturated = curl({ displacement: 56, crossDisplacement: 20 });
    expect(near.angle).toBeGreaterThan(0);
    expect(near.angle).toBeLessThan(saturated.angle);
    expect(curl({ displacement: 72, crossDisplacement: 72 * 20 / 56 }).angle)
      .toBeCloseTo(saturated.angle, 10);
  });

  it("follows increasing cross-axis drag without an early angle cap", () => {
    const angle10 = curl({ displacement: 120, crossDisplacement: 10 }).angle;
    const angle20 = curl({ displacement: 120, crossDisplacement: 20 }).angle;
    const angle30 = curl({ displacement: 120, crossDisplacement: 30 }).angle;

    expect(angle10).toBeGreaterThan(0);
    expect(angle20).toBeGreaterThan(angle10);
    expect(angle30).toBeGreaterThan(angle20);
    expect(angle30).toBeLessThan(8);
    expect(curl({ displacement: 120, crossDisplacement: -30 }).angle)
      .toBeCloseTo(-angle30, 10);
  });

  it("clamps the stable touch pivot to the physical viewport", () => {
    expect(curl({ origin: { x: -40, y: 480 } })).toMatchObject({ originX: 0, originY: 400 });
    expect(curl({ origin: { x: 500, y: -20 } })).toMatchObject({ originX: 320, originY: 0 });
  });

  it("lets CSS own reduced-motion and ending frames", () => {
    const active = curl({ displacement: 100, crossDisplacement: 30 });
    expect(active.angle).not.toBe(0);
    expect(curl({ reducedMotion: true })).toMatchObject({ angle: 0, curlSize: 0, shadowOpacity: 0 });
    expect(curl({ phase: "complete" })).toMatchObject({ angle: 0, curlSize: 0, shadowOpacity: 0 });
    expect(curl({ phase: "recoil" })).toMatchObject({ angle: 0, curlSize: 0, shadowOpacity: 0 });
    expect(curl({ phase: "idle" })).toMatchObject({ angle: 0, curlSize: 0, shadowOpacity: 0 });
  });
});

describe("paper-turn release", () => {
  it("commits with a complete target while preserving the selected axis and direction", () => {
    const state = drag(point(100, 100), point(180, 100));
    const update = pointerUp(state, {
      remaining: [],
      changed: [point(180, 100)],
      metrics: metrics(),
      config: config(),
    });

    expect(update.navigation).toBe("prev");
    expect(update.state.phase).toBe("settling");
    expect(update.state.paperTurn).toMatchObject({
      axis: "horizontal", direction: "prev", phase: "complete", displacement: 0,
      origin: { x: 100, y: 100 }, crossDisplacement: 0,
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
      origin: { x: 100, y: 0 }, crossDisplacement: 0,
    });
  });

  it("never reveals a future page when next is blocked", () => {
    const settings = config(false);
    const state = drag(point(100, 100), point(20, 100), metrics(), settings);
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
      changed: [point(20, 100)],
      metrics: metrics(),
      config: settings,
    });
    expect(update.blocked).toBe(true);
    expect(update.navigation).toBeNull();
    expect(update.state.paperTurn.phase).toBe("idle");
    expect(update.state.paperTurn.displacement).toBe(0);
    expect(update.state.paperTurn.origin).toBeUndefined();
    expect(update.state.paperTurn.crossDisplacement).toBeUndefined();
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
