import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { paperTurnTransition } from "../src/gestures/paper-turn";
import {
  paperFoldAvatarTransform,
  resolvePaperFoldFrame,
  resolvePaperFoldMotion,
  type PaperFoldPolygon,
} from "../src/gestures/paper-fold";

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

const matrixValues = (transform: string): number[] => {
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  expect(match).toBeTruthy();
  return (match?.[1] ?? "").split(",").map(Number);
};

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

type MutablePoint = [number, number];
type MutablePolygon = MutablePoint[];

const square: MutablePolygon = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];

const polygonArea = (polygon: readonly (readonly [number, number])[]): number => {
  let doubledArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(doubledArea) / 2 / 1_000_000;
};

const isNonCrossing = (polygon: PaperFoldPolygon): boolean => {
  let orientation = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = (current[0] - previous[0]) * (next[1] - current[1])
      - (current[1] - previous[1]) * (next[0] - current[0]);
    // Ignore sub-pixel turns introduced by 0.1% quantization.
    if (Math.abs(cross) > 500) {
      const sign = Math.sign(cross);
      if (orientation === 0) orientation = sign;
      else if (sign !== orientation) return false;
    }
  }
  return true;
};

const intersection = (
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): MutablePoint => {
  const dc = [d[0] - c[0], d[1] - c[1]];
  const ca = [a[0] - c[0], a[1] - c[1]];
  const ba = [b[0] - a[0], b[1] - a[1]];
  const denominator = ba[0] * dc[1] - ba[1] * dc[0];
  const amount = (dc[0] * ca[1] - dc[1] * ca[0]) / denominator;
  return [a[0] + amount * ba[0], a[1] + amount * ba[1]];
};

/** Test-only Sutherland-Hodgman clipping; runtime code never clips geometry. */
const clipConvex = (subject: PaperFoldPolygon, inputClip: MutablePolygon): MutablePolygon => {
  let clipDoubledArea = 0;
  for (let index = 0; index < inputClip.length; index += 1) {
    const current = inputClip[index];
    const next = inputClip[(index + 1) % inputClip.length];
    clipDoubledArea += current[0] * next[1] - next[0] * current[1];
  }
  const clip = clipDoubledArea < 0 ? [...inputClip].reverse() : inputClip;
  let output = subject.map(([x, y]) => [x, y] as MutablePoint);
  for (let edge = 0; edge < clip.length; edge += 1) {
    if (output.length === 0) break;
    const a = clip[edge];
    const b = clip[(edge + 1) % clip.length];
    const edgeX = b[0] - a[0];
    const edgeY = b[1] - a[1];
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const next = input[(index + 1) % input.length];
      const currentInside = edgeX * (current[1] - a[1]) - edgeY * (current[0] - a[0]) >= -0.01;
      const nextInside = edgeX * (next[1] - a[1]) - edgeY * (next[0] - a[0]) >= -0.01;
      if (currentInside) {
        output.push(current);
        if (!nextInside) output.push(intersection(current, next, a, b));
      } else if (nextInside) {
        output.push(intersection(current, next, a, b));
      }
    }
  }
  return output.filter((point, index) => {
    const next = output[(index + 1) % output.length];
    return Math.abs(point[0] - next[0]) > 0.01 || Math.abs(point[1] - next[1]) > 0.01;
  });
};

const visibleFlatArea = (frame: { flat: PaperFoldPolygon }): number => (
  polygonArea(clipConvex(frame.flat, square))
);

const visibleBackArea = (frame: { flat: PaperFoldPolygon; back: PaperFoldPolygon }): number => (
  polygonArea(clipConvex(clipConvex(frame.back, frame.flat.map(([x, y]) => [x, y])), square))
);

const analyticFlatArea = (progress: number, tilt: number): number => {
  const slope = tilt * 0.85 * Math.sin(Math.PI * progress);
  const intercept = (1 - progress) - slope * 0.5;
  const valueAt = (y: number) => intercept + slope * y;
  const boundaries = new Set([0, 1]);
  for (const value of [0, 1]) {
    const y = (value - intercept) / slope;
    if (Number.isFinite(y) && y > 0 && y < 1) boundaries.add(y);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  let result = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const clipped = Math.min(1, Math.max(0, valueAt((start + end) / 2)));
    result += (end - start) * clipped;
  }
  return result;
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = seed + 0x6d2b79f5 | 0;
  let bits = Math.imul(seed ^ seed >>> 15, 1 | seed);
  bits = bits + Math.imul(bits ^ bits >>> 7, 61 | bits) ^ bits;
  return ((bits ^ bits >>> 14) >>> 0) / 4294967296;
};

describe("paper-fold preset table", () => {
  it("contains signed finite four-point polygons outside the viewport without self-crossing", () => {
    for (let tiltIndex = 0; tiltIndex <= 12; tiltIndex += 1) {
      const tilt = tiltIndex / 6 - 1;
      for (let progressIndex = 0; progressIndex <= 40; progressIndex += 1) {
        const frame = resolvePaperFoldFrame(progressIndex / 40, tilt, "horizontal");
        for (const polygon of [frame.flat, frame.back, frame.shadow]) {
          expect(polygon).toHaveLength(4);
          expect(polygon.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
          expect(isNonCrossing(polygon)).toBe(true);
        }
      }
    }

    const start = resolvePaperFoldFrame(0, 0, "horizontal");
    const end = resolvePaperFoldFrame(1, 0, "horizontal");
    expect(start.flat[0]).toEqual([-2000, 0]);
    expect(end.back[1][0]).toBeLessThan(0);
  });

  it("matches the exact flat half-plane after viewport clipping", () => {
    for (let tiltIndex = 0; tiltIndex <= 12; tiltIndex += 1) {
      const tilt = tiltIndex / 6 - 1;
      for (let progressIndex = 0; progressIndex <= 40; progressIndex += 1) {
        const progress = progressIndex / 40;
        const frame = resolvePaperFoldFrame(progress, tilt, "horizontal");
        expect(Math.abs(visibleFlatArea(frame) - analyticFlatArea(progress, tilt)))
          .toBeLessThan(0.003);
      }
    }
  });

  it("keeps random bilinear intermediates simple and close to the exact flat mask", () => {
    const random = mulberry32(438);
    for (let sample = 0; sample < 500; sample += 1) {
      const progress = random();
      const tilt = random() * 2 - 1;
      const frame = resolvePaperFoldFrame(progress, tilt, "horizontal");
      for (const polygon of [frame.flat, frame.back, frame.shadow]) {
        expect(polygon).toHaveLength(4);
        expect(isNonCrossing(polygon)).toBe(true);
      }
      expect(Math.abs(visibleFlatArea(frame) - analyticFlatArea(progress, tilt)))
        .toBeLessThan(0.01);
    }
  });

  it("hides projected backs at endpoints while providing a broad visible intermediate flap", () => {
    for (const tilt of [-1, 0, 1]) {
      expect(visibleBackArea(resolvePaperFoldFrame(0, tilt, "horizontal"))).toBe(0);
      expect(visibleBackArea(resolvePaperFoldFrame(1, tilt, "horizontal"))).toBe(0);
    }
    for (const progress of [0.25, 0.45, 0.65]) {
      const frame = resolvePaperFoldFrame(progress, 0, "horizontal");
      expect(visibleBackArea(frame)).toBeGreaterThan(0.1);
      expect(frame.flatClipPath).not.toContain("NaN");
      expect(frame.backClipPath).not.toContain("NaN");
    }

    const positive = resolvePaperFoldFrame(0.5, 1, "horizontal");
    const negative = resolvePaperFoldFrame(0.5, -1, "horizontal");
    expect(visibleBackArea(positive)).toBeGreaterThan(0.1);
    expect(visibleBackArea(negative)).toBeGreaterThan(0.1);
    expect(positive.back.some(([x, y], index) => Math.abs(x - negative.back[index][0]) > 2
      || Math.abs(y - negative.back[index][1]) > 2)).toBe(true);
  });

  it("interpolates the four surrounding frames and transposes vertical coordinates", () => {
    const near00 = resolvePaperFoldFrame(0.5, 0, "horizontal");
    const near10 = resolvePaperFoldFrame(0.525, 0, "horizontal");
    const near01 = resolvePaperFoldFrame(0.5, 1 / 6, "horizontal");
    const near11 = resolvePaperFoldFrame(0.525, 1 / 6, "horizontal");
    const center = resolvePaperFoldFrame(0.5125, 1 / 12, "horizontal");
    center.back.forEach((point, index) => {
      const expected = [0, 1].map((slot) => (
        (near00.back[index][slot] + near10.back[index][slot]
          + near01.back[index][slot] + near11.back[index][slot]) / 4
      ));
      expect(point[0]).toBeCloseTo(expected[0], 8);
      expect(point[1]).toBeCloseTo(expected[1], 8);
    });

    const horizontalAtTilt = resolvePaperFoldFrame(0.5, 0.5, "horizontal");
    const vertical = resolvePaperFoldFrame(0.5, 0.5, "vertical");
    expect(vertical.back).toEqual(horizontalAtTilt.back.map(([x, y]) => [y, x]));
  });

  it("maps non-square avatar corners onto each projected back without mirroring", () => {
    const width = 320;
    const height = 568;
    const horizontalBack: MutablePolygon = [[360, 80], [120, 40], [180, 540], [420, 580]];
    const horizontalTransform = paperFoldAvatarTransform(horizontalBack, width, height, "horizontal");
    expect(horizontalTransform).toBeTruthy();
    const [a, b, c, d, tx, ty] = matrixValues(horizontalTransform ?? "");
    const map = (x: number, y: number): MutablePoint => [
      a * x + c * y + tx,
      b * x + d * y + ty,
    ];
    // Horizontal turns swap the top source edges, while the left edge remains left.
    expect(map(0, 0)[0]).toBeCloseTo(38.4, 8);
    expect(map(0, 0)[1]).toBeCloseTo(22.72, 8);
    expect(map(width, 0)[0]).toBeCloseTo(115.2, 8);
    expect(map(width, 0)[1]).toBeCloseTo(45.44, 8);
    expect(map(0, height)[0]).toBeCloseTo(57.6, 8);
    expect(map(0, height)[1]).toBeCloseTo(306.72, 8);
    expect(a * d - b * c).toBeGreaterThan(0);

    const verticalBack: MutablePolygon = [[420, 580], [120, 40], [360, 80], [180, 540]];
    const verticalTransform = paperFoldAvatarTransform(verticalBack, width, height, "vertical");
    expect(verticalTransform).toBeTruthy();
    const verticalValues = matrixValues(verticalTransform ?? "");
    const verticalMap = (x: number, y: number): MutablePoint => [
      verticalValues[0] * x + verticalValues[2] * y + verticalValues[4],
      verticalValues[1] * x + verticalValues[3] * y + verticalValues[5],
    ];
    // A vertical turn swaps the source edges that the transposed fold exposes.
    expect(verticalMap(0, 0)[0]).toBeCloseTo(38.4, 8);
    expect(verticalMap(0, 0)[1]).toBeCloseTo(22.72, 8);
    expect(verticalMap(width, 0)[0]).toBeCloseTo(115.2, 8);
    expect(verticalMap(width, 0)[1]).toBeCloseTo(45.44, 8);
    expect(verticalMap(0, height)[0]).toBeCloseTo(134.4, 8);
    expect(verticalMap(0, height)[1]).toBeCloseTo(329.44, 8);
    expect(verticalValues[0] * verticalValues[3]
      - verticalValues[1] * verticalValues[2]).toBeGreaterThan(0);

    for (const axis of ["horizontal", "vertical"] as const) {
      const frame = resolvePaperFoldFrame(0.5, 0, axis);
      const transform = paperFoldAvatarTransform(frame.back, width, height, axis);
      expect(transform).toBeTruthy();
      const values = matrixValues(transform ?? "");
      expect(values[0]).toBeGreaterThan(0);
      expect(values[3]).toBeGreaterThan(0);
      expect(Math.abs(values[1])).toBeLessThan(0.001);
      expect(Math.abs(values[2])).toBeLessThan(0.001);
      expect(values[0] * values[3] - values[1] * values[2]).toBeGreaterThan(0);
    }

    expect(paperFoldAvatarTransform(horizontalBack, 0, height, "horizontal")).toBeNull();
    expect(paperFoldAvatarTransform(horizontalBack, width, Number.NaN, "vertical")).toBeNull();
    expect(paperFoldAvatarTransform([[0, 0], [100, 0], [100, 100]], width, height, "horizontal")).toBeNull();
    expect(paperFoldAvatarTransform(
      [[0, 0], [Number.NaN, 0], [100, 100], [0, 100]],
      width,
      height,
      "vertical",
    )).toBeNull();
  });

  it("generates byte-identical checked-in output", () => {
    const directory = mkdtempSync(join(tmpdir(), "bubu-paper-fold-"));
    const script = fileURLToPath(new URL("../scripts/generate-paper-fold.mjs", import.meta.url));
    const committed = fileURLToPath(new URL("../src/gestures/paper-fold-frames.json", import.meta.url));
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    try {
      execFileSync(process.execPath, [script, first]);
      execFileSync(process.execPath, [script, second]);
      expect(readFileSync(first, "utf8")).toBe(readFileSync(second, "utf8"));
      expect(readFileSync(first, "utf8")).toBe(readFileSync(committed, "utf8"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("paper-fold gesture mapping", () => {
  it("uses outgoing progress for next and reversed incoming progress for previous", () => {
    expect(resolvePaperFoldMotion({
      axis: "horizontal", direction: "next", phase: "drag",
      displacement: -160, crossDisplacement: 20, size: 320,
    })).toEqual({ progress: 0.5, tilt: 0.2 });

    expect(resolvePaperFoldMotion({
      axis: "horizontal", direction: "prev", phase: "drag",
      displacement: 160, crossDisplacement: 20, size: 320,
    })).toEqual({ progress: 0.5, tilt: 0.2 });

    expect(resolvePaperFoldMotion({
      axis: "vertical", direction: "prev", phase: "drag",
      displacement: 160, crossDisplacement: 20, size: 400,
    })).toEqual({ progress: 0.6, tilt: -0.2 });
  });

  it("follows cross-axis reversal and rejects invalid touch values", () => {
    const positive = resolvePaperFoldMotion({
      axis: "horizontal", direction: "next", phase: "drag",
      displacement: -120, crossDisplacement: 30, size: 320,
    });
    const negative = resolvePaperFoldMotion({
      axis: "horizontal", direction: "next", phase: "drag",
      displacement: -120, crossDisplacement: -30, size: 320,
    });
    expect(positive.tilt).toBeGreaterThan(0);
    expect(negative.tilt).toBeLessThan(0);
    expect(negative.tilt).toBeCloseTo(-positive.tilt, 12);

    expect(resolvePaperFoldMotion({
      axis: "horizontal", direction: "next", phase: "drag",
      displacement: Number.NaN, crossDisplacement: Number.POSITIVE_INFINITY, size: Number.NaN,
    })).toEqual({ progress: 0, tilt: 0 });
  });

  it("keeps release timing available for preset playback", () => {
    expect(paperTurnTransition("drag")).toEqual({ durationMs: 0, property: "none" });
    expect(paperTurnTransition("recoil")).toEqual({ durationMs: 180, property: "transform" });
    expect(paperTurnTransition("complete")).toEqual({ durationMs: 300, property: "transform" });
    expect(paperTurnTransition("complete", true)).toEqual({ durationMs: 0, property: "transform" });
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
    expect(state.paperTurn.phase).toBe("idle");
    expect(state.paperTurn.displacement).toBe(0);

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
