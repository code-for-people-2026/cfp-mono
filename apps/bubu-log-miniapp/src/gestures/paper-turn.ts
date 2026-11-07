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

export interface PaperTurnTransform {
  x: number;
  y: number;
  /** 0 until the moving sheet crosses the viewport edge. */
  progress: number;
}

const finite = (value: number): number => Number.isFinite(value) ? value : 0;

/**
 * Direct-manipulation geometry. Previous keeps the current sheet stationary and
 * slides its neighbor over it; next moves the current sheet away and reveals the
 * pre-rendered neighbor underneath.
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
      ? { x: size + displacement, y: 0, progress }
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
  if (direction === "prev") return axis === "horizontal" ? -magnitude : magnitude;
  return axis === "horizontal" ? magnitude : -magnitude;
}

export function paperTurnTransition(phase: PaperTurnPhase, reducedMotion = false): {
  durationMs: number;
  property: "none" | "transform";
} {
  if (phase === "drag" || phase === "idle") return { durationMs: 0, property: "none" };
  if (phase === "recoil") return { durationMs: reducedMotion ? 0 : 180, property: "transform" };
  return { durationMs: reducedMotion ? 0 : 300, property: "transform" };
}
