export type PaperTurnAxis = "horizontal" | "vertical";
export type PaperTurnDirection = "prev" | "next";
export type PaperTurnPhase = "idle" | "drag" | "recoil" | "complete";
export type PaperTurnSide = "current" | "neighbor";

export interface PaperTurnInput {
  axis: PaperTurnAxis;
  direction: PaperTurnDirection;
  phase: PaperTurnPhase;
  /** Signed finger displacement in physical CSS pixels. */
  displacement: number;
  /** Viewport width for horizontal turns and height for vertical turns. */
  size: number;
  side: PaperTurnSide;
}

export interface PaperCurlInput {
  axis: PaperTurnAxis;
  phase: PaperTurnPhase;
  /** Signed primary-axis finger displacement in physical CSS pixels. */
  displacement: number;
  /** Signed cross-axis displacement: dy for horizontal, dx for vertical. */
  crossDisplacement?: number;
  /** Stable viewport-local first touch. */
  origin?: { x: number; y: number };
  width: number;
  height: number;
  reducedMotion?: boolean;
}

export interface PaperCurl {
  /** Signed decorative-edge inclination in degrees, bounded by the visual design. */
  angle: number;
  curlSize: number;
  shadowOpacity: number;
  originX: number;
  originY: number;
}

export interface PaperFoldGeometryInput {
  axis: PaperTurnAxis;
  width: number;
  height: number;
  /** Curl seam inclination in degrees. */
  angle: number;
  /** Width of the attached curl perpendicular to its moving edge. */
  curlSize: number;
  /** Maximum distance either seam endpoint may trail the moving edge. */
  band?: number;
}

export interface PaperDecorationGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
  transformOrigin: string;
}

export interface PaperFoldGeometry {
  clipPath: string;
  /** At y=0 for horizontal folds and x=0 for vertical folds. */
  seamStart: number;
  /** At the opposite viewport edge along the cross axis. */
  seamEnd: number;
  /** Seam delta in primary-axis pixels per cross-axis pixel. */
  slope: number;
  /** Exact skew angle whose tangent is slope. */
  skewAngle: number;
  curl: PaperDecorationGeometry;
  shadow: PaperDecorationGeometry;
}

export interface PaperTurnTransform {
  x: number;
  y: number;
  /** 0 until the moving sheet crosses the viewport edge. */
  progress: number;
}

const finite = (value: number | undefined): number => (
  typeof value === "number" && Number.isFinite(value) ? value : 0
);

/**
 * Direct-manipulation geometry. A rightward finger turns previous: the current
 * sheet stays put and its left-hand neighbor slides over it. A leftward finger
 * turns next by moving the current sheet away from the pre-rendered neighbor.
 */
export function resolvePaperTurnTransform(input: PaperTurnInput): PaperTurnTransform {
  const size = Math.max(1, finite(input.size));
  const displacement = finite(input.displacement);
  const distance = Math.min(size, Math.max(0, Math.abs(displacement)));
  const progress = distance / size;

  if (input.direction === "next" && input.side === "current") {
    return input.axis === "horizontal"
      ? { x: displacement, y: 0, progress }
      : { x: 0, y: displacement, progress };
  }
  if (input.direction === "prev" && input.side === "neighbor") {
    return input.axis === "horizontal"
      ? { x: -size + displacement, y: 0, progress }
      : { x: 0, y: -size + displacement, progress };
  }
  return { x: 0, y: 0, progress };
}

/** The displacement that completes the chosen turn geometry. */
export function completedPaperTurnDisplacement(
  axis: PaperTurnAxis,
  direction: PaperTurnDirection,
  size: number,
): number {
  const magnitude = Math.max(1, finite(size));
  if (direction === "prev") return magnitude;
  return -magnitude;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Smoothly opens the curl and fully opens it before the commit threshold. */
const smoothDistanceGate = (distance: number): number => {
  const amount = clamp(distance / 56, 0, 1);
  return amount * amount * (3 - 2 * amount);
};

/**
 * Pure touch-following curl. The primary displacement controls how far the sheet
 * has lifted, while the cross displacement inclines its decorative edge.
 * Ending phases intentionally return zero motion so CSS can animate the landing.
 */
export function resolvePaperCurl(input: PaperCurlInput): PaperCurl {
  const width = Math.max(1, finite(input.width));
  const height = Math.max(1, finite(input.height));
  const originX = clamp(finite(input.origin?.x), 0, width);
  const originY = clamp(finite(input.origin?.y), 0, height);
  const inactive = input.phase !== "drag" || input.reducedMotion === true;
  if (inactive) {
    return { angle: 0, curlSize: 0, shadowOpacity: 0, originX, originY };
  }

  const primary = finite(input.displacement);
  const cross = finite(input.crossDisplacement);
  const distance = Math.abs(primary);
  const gate = smoothDistanceGate(distance);
  const size = input.axis === "vertical" ? height : width;
  const progress = clamp(distance / size, 0, 1);
  const rawAngle = Math.atan2(cross, distance) * 180 / Math.PI;
  const scaledRawAngle = rawAngle * 0.3;
  const angle = clamp((input.axis === "vertical" ? -scaledRawAngle : scaledRawAngle) * gate, -8, 8);
  const curlSize = (12 + 20 * progress) * gate;
  const shadowOpacity = (0.08 + 0.22 * progress) * gate;

  return { angle, curlSize, shadowOpacity, originX, originY };
}

/**
 * One coherent fold geometry for the clipped moving sheet, curl, and cast
 * shadow. Both turn directions move toward the same visible boundary (right or
 * bottom), so direction never changes the seam or its attached decorations.
 */
export function resolvePaperFoldGeometry(input: PaperFoldGeometryInput): PaperFoldGeometry {
  const width = Math.max(1, finite(input.width));
  const height = Math.max(1, finite(input.height));
  const horizontal = input.axis === "horizontal";
  const crossSize = horizontal ? height : width;
  const band = clamp(finite(input.band), 0, crossSize);
  const angle = clamp(finite(input.angle), -45, 45);
  const angleRadians = angle * Math.PI / 180;
  const rawSlope = horizontal ? -Math.tan(angleRadians) : Math.tan(angleRadians);
  const slopeLimit = band / crossSize;
  const signedSlope = Math.sign(rawSlope) * Math.min(Math.abs(rawSlope), slopeLimit);
  const boundedSlope = signedSlope === 0 ? 0 : signedSlope;
  const skewAngle = Math.atan(boundedSlope);
  const curlSize = clamp(finite(input.curlSize), 0, band);
  const skew = `skew${horizontal ? "X" : "Y"}(${skewAngle}rad)`;

  if (input.axis === "horizontal") {
    const seamStart = width - Math.max(0, boundedSlope * height);
    const seamEnd = seamStart + boundedSlope * height;
    return {
      clipPath: `polygon(0% 0%, ${seamStart}px 0%, ${seamEnd}px 100%, 0% 100%)`,
      seamStart,
      seamEnd,
      slope: boundedSlope,
      skewAngle,
      curl: {
        left: seamStart - curlSize,
        top: 0,
        width: curlSize,
        height,
        transform: skew,
        transformOrigin: "100% 0%",
      },
      shadow: {
        left: seamStart - 2,
        top: 0,
        width: 18,
        height,
        transform: skew,
        transformOrigin: "0% 0%",
      },
    };
  }

  const seamStart = height - Math.max(0, boundedSlope * width);
  const seamEnd = seamStart + boundedSlope * width;
  return {
    clipPath: `polygon(0% 0%, 100% 0%, 100% ${seamEnd}px, 0% ${seamStart}px)`,
    seamStart,
    seamEnd,
    slope: boundedSlope,
    skewAngle,
    curl: {
      left: 0,
      top: seamStart - curlSize,
      width,
      height: curlSize,
      transform: skew,
      transformOrigin: "0% 100%",
    },
    shadow: {
      left: 0,
      top: seamStart - 2,
      width,
      height: 18,
      transform: skew,
      transformOrigin: "0% 0%",
    },
  };
}

export function paperTurnTransition(phase: PaperTurnPhase, reducedMotion = false): {
  durationMs: number;
  property: "none" | "transform";
} {
  if (phase === "drag" || phase === "idle") return { durationMs: 0, property: "none" };
  if (phase === "recoil") return { durationMs: reducedMotion ? 0 : 180, property: "transform" };
  return { durationMs: reducedMotion ? 0 : 300, property: "transform" };
}
