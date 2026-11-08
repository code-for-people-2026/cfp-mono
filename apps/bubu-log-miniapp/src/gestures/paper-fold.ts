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
  crossSize?: number;
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

export interface PaperFoldFocusState {
  /** Logical completion of a turn, independent of table direction. */
  completion: number;
  /** Blur for the outgoing current page; 0 is sharp. */
  outgoingBlur: number;
  /** Blur for the incoming adjacent page; 6 is fully deferred focus. */
  incomingBlur: number;
}

export interface PaperFoldTileGrid {
  columns: number;
  rows: number;
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

/** Derive depth-of-field from the same table position that draws the fold. */
export function resolvePaperFoldFocusState(
  progress: number,
  direction: PaperTurnDirection,
): PaperFoldFocusState {
  const canonicalProgress = clamp(finite(progress), 0, 1);
  const completion = direction === "next"
    ? canonicalProgress
    : 1 - canonicalProgress;
  return {
    completion,
    outgoingBlur: 6 * completion,
    incomingBlur: 6 * (1 - completion),
  };
}

/** Convert touch values to a table coordinate. This performs no fold geometry. */
export function resolvePaperFoldMotion(input: PaperFoldMotionInput): PaperFoldMotion {
  const size = Math.max(1, finite(input.size));
  const crossSize = Math.max(1, finite(input.crossSize ?? input.size));
  const displacement = finite(input.displacement);
  const progress = clamp(Math.abs(displacement) / size, 0, 1);
  const cross = finite(input.crossDisplacement);
  const tilt = clamp(
    cross / Math.max(56, Math.abs(displacement)) * 1.6 * crossSize / size,
    -1,
    1,
  );
  const canonicalProgress = input.direction === "prev" ? 1 - progress : progress;
  return {
    progress: input.phase === "drag" ? canonicalProgress : 0,
    tilt: input.phase === "drag" ? tilt : 0,
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

/**
 * Map a full-sheet avatar image onto three projected backside corners.
 *
 * Each turn axis sees a different projected corner order. Keeping the three
 * source-to-target edges explicit avoids mirroring the printed backside.
 */
export function paperFoldAvatarTransform(
  back: PaperFoldPolygon,
  width: number,
  height: number,
  axis: PaperTurnAxis,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) return null;
  if (back.length < 4 || back.some((point) => point.length < 2
    || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return null;

  const [projectedTopRight, topLeft, projectedBottomLeft] = back;
  const targetTopRight = axis === "horizontal" ? projectedTopRight : projectedBottomLeft;
  const targetBottomLeft = axis === "horizontal" ? projectedBottomLeft : projectedTopRight;
  const q0 = [targetTopRight[0] / 1000, targetTopRight[1] / 1000] as const;
  const q1 = [topLeft[0] / 1000, topLeft[1] / 1000] as const;
  const q2 = [targetBottomLeft[0] / 1000, targetBottomLeft[1] / 1000] as const;
  const a = q0[0] - q1[0];
  const b = (q0[1] - q1[1]) * height / width;
  const c = (q2[0] - q1[0]) * width / height;
  const d = q2[1] - q1[1];
  const tx = q1[0] * width;
  const ty = q1[1] * height;
  const values = [a, b, c, d, tx, ty];
  return values.every(Number.isFinite) ? `matrix(${values.join(", ")})` : null;
}

/**
 * Align the narrow crease shadow with flat polygon edge 1 -> 2.
 *
 * The matrix is a horizontal translation and shear; no trigonometry is
 * required. The component offsets the strip by one pixel so its sharp edge sits
 * on the crease while the gradient extends toward the exposed page.
 */
export function paperFoldCreaseShadowTransform(
  flat: PaperFoldPolygon,
  width: number,
  height: number,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (flat.length < 3 || flat.some((point) => point.length < 2
    || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return null;

  const xTop = flat[1][0] / 1000 * width;
  const xBottom = flat[2][0] / 1000 * width;
  const values = [1, 0, (xBottom - xTop) / height, 1, xTop - 1, 0];
  return values.every(Number.isFinite) ? `matrix(${values.join(", ")})` : null;
}

/**
 * Bound the image-node wallpaper to a little larger than a phone screen.  CSS
 * percentage/vw units ultimately decide each tile's rendered size; this count
 * only ensures enough nodes exist before that sheet is clipped.
 */
export function resolvePaperFoldTileGrid(
  windowWidth: number,
  sheetHeight: number,
): PaperFoldTileGrid {
  const width = boundFiniteScreenDimension(windowWidth);
  const height = boundFiniteScreenDimension(sheetHeight);
  if (width < 120 || height === 0) return { columns: 0, rows: 0 };

  const tileSize = width / 2;
  return {
    columns: 2,
    rows: Math.max(1, Math.ceil(height / tileSize)),
  };
}

function boundFiniteScreenDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Keep malformed platform input from creating an unbounded wallpaper while
  // allowing every plausible phone/window height.
  return Math.min(value, 10000);
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
