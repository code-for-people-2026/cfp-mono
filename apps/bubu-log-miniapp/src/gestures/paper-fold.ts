import foldTableJson from "./paper-fold-frames.json";
import type { PaperTurnAxis, PaperTurnDirection, PaperTurnPhase } from "./paper-turn";

export type PaperFoldPoint = readonly [number, number];
export type PaperFoldPolygon = readonly PaperFoldPoint[];

interface PaperFoldTable {
  version: number;
  progressSteps: number;
  tiltSteps: number;
  frames: readonly (readonly [PaperFoldPolygon, PaperFoldPolygon, PaperFoldPolygon])[];
}

export interface PaperFoldMotionInput {
  axis: PaperTurnAxis;
  direction: PaperTurnDirection | null;
  phase: PaperTurnPhase;
  displacement: number;
  crossDisplacement?: number;
  size: number;
}

export interface PaperFoldMotion {
  /** Position in the canonical fold table; 0 is fully open and 1 is fully turned. */
  progress: number;
  /** Normalized crease slope in the table's -1..1 range. */
  tilt: number;
}

export interface PaperFoldFrame {
  flat: PaperFoldPolygon;
  back: PaperFoldPolygon;
  shadow: PaperFoldPolygon;
  flatClipPath: string;
  backClipPath: string;
  shadowClipPath: string;
}

const foldTable = foldTableJson as unknown as PaperFoldTable;
const { progressSteps, tiltSteps, frames } = foldTable;
const maxProgressIndex = progressSteps - 1;
const maxTiltIndex = tiltSteps - 1;

const finite = (value: number | undefined): number => (
  typeof value === "number" && Number.isFinite(value) ? value : 0
);

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

/** Convert touch values to a table coordinate. This performs no fold geometry. */
export function resolvePaperFoldMotion(input: PaperFoldMotionInput): PaperFoldMotion {
  const size = Math.max(1, finite(input.size));
  const displacement = finite(input.displacement);
  const progress = clamp(Math.abs(displacement) / size, 0, 1);
  const cross = finite(input.crossDisplacement);
  const tilt = clamp(cross / Math.max(56, Math.abs(displacement)) * 1.6, -1, 1);
  const signedTilt = input.axis === "horizontal" ? tilt : -tilt;
  const canonicalProgress = input.direction === "prev" ? 1 - progress : progress;
  return {
    progress: input.phase === "drag" ? canonicalProgress : 0,
    tilt: input.phase === "drag" ? signedTilt : 0,
  };
}

/** Bilinear lookup plus fixed-array interpolation against four preset frames. */
export function resolvePaperFoldFrame(
  progress: number,
  tilt: number,
  axis: PaperTurnAxis,
): PaperFoldFrame {
  const boundedProgress = clamp(finite(progress), 0, 1);
  const boundedTilt = clamp(finite(tilt), -1, 1);
  const progressPosition = boundedProgress * maxProgressIndex;
  const tiltPosition = (boundedTilt + 1) / 2 * maxTiltIndex;
  const lowerProgress = Math.floor(progressPosition);
  const upperProgress = Math.min(maxProgressIndex, lowerProgress + 1);
  const lowerTilt = Math.floor(tiltPosition);
  const upperTilt = Math.min(maxTiltIndex, lowerTilt + 1);
  const progressAmount = progressPosition - lowerProgress;
  const tiltAmount = tiltPosition - lowerTilt;

  const polygon = (slot: 0 | 1 | 2): PaperFoldPolygon => {
    const pointCount = frames[lowerTilt * progressSteps + lowerProgress][slot].length;
    return Array.from({ length: pointCount }, (_, index) => {
      const pointAt = (tiltIndex: number, progressIndex: number): PaperFoldPoint => (
        frames[tiltIndex * progressSteps + progressIndex][slot][index]
      );
      const lowerTiltPoint = interpolatePoint(
        pointAt(lowerTilt, lowerProgress),
        pointAt(lowerTilt, upperProgress),
        progressAmount,
      );
      const upperTiltPoint = interpolatePoint(
        pointAt(upperTilt, lowerProgress),
        pointAt(upperTilt, upperProgress),
        progressAmount,
      );
      const point = interpolatePoint(lowerTiltPoint, upperTiltPoint, tiltAmount);
      return axis === "horizontal" ? point : ([point[1], point[0]] as PaperFoldPoint);
    });
  };

  const flat = polygon(0);
  const back = polygon(1);
  const shadow = polygon(2);
  return {
    flat,
    back,
    shadow,
    flatClipPath: polygonClipPath(flat),
    backClipPath: polygonClipPath(back),
    shadowClipPath: polygonClipPath(shadow),
  };
}

function interpolatePoint(from: PaperFoldPoint, to: PaperFoldPoint, amount: number): PaperFoldPoint {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
  ];
}

function polygonClipPath(polygon: PaperFoldPolygon): string {
  return `polygon(${polygon.map(([x, y]) => `${formatPercent(x)} ${formatPercent(y)}`).join(", ")})`;
}

function formatPercent(value: number): string {
  return `${(value / 10).toFixed(1)}%`;
}
