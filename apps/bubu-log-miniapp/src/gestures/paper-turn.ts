export type PaperTurnAxis = "horizontal" | "vertical";
export type PaperTurnDirection = "prev" | "next";
export type PaperTurnPhase = "idle" | "drag" | "recoil" | "complete";

export function paperTurnTransition(phase: PaperTurnPhase, reducedMotion = false): {
  durationMs: number;
  property: "none" | "transform";
} {
  if (phase === "drag" || phase === "idle") return { durationMs: 0, property: "none" };
  if (phase === "recoil") return { durationMs: reducedMotion ? 0 : 180, property: "transform" };
  return { durationMs: reducedMotion ? 0 : 300, property: "transform" };
}
