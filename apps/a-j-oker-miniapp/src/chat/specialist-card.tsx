import {
  AJ_BUILT_IN_EXPERT_SUBTITLES,
  ajPresentationOrigin,
} from "@cfp/a-j-oker-contracts";
import { legacyArtifactsSchema } from "@cfp/base-chat-protocol";
import type { Turn } from "./model";

export type SpecialistFormState = "current" | "replaced" | "expired";

function hasForm(turn: Turn) {
  const parsed = legacyArtifactsSchema.safeParse(turn.artifacts ?? [], {
    jitless: true,
  });
  return parsed.success && parsed.data.some((artifact) => artifact.kind === "form");
}

export function specialistPresentationForTurn(turn: Turn) {
  if (
    turn.status !== "completed" ||
    !turn.specialist ||
    turn.specialist.status === "unavailable" ||
    turn.input.action ||
    turn.model === "product-guidance"
  )
    return undefined;
  const origin = ajPresentationOrigin(turn.specialist);
  return origin.subtitle
    ? origin
    : {
        ...origin,
        subtitle: AJ_BUILT_IN_EXPERT_SUBTITLES[turn.specialist.expertId],
      };
}

export function activeSpecialistTurn(history: readonly Turn[]) {
  let active: Turn | undefined;
  for (const turn of [...history].sort((left, right) => left.id - right.id)) {
    if (turn.status !== "completed") continue;
    if (turn.input.action) {
      active = undefined;
      continue;
    }
    if (!turn.specialist) continue;
    if (turn.specialist.status === "active" && turn.model !== "product-guidance")
      active = turn;
    else if (active?.specialist?.taskId === turn.specialist.taskId)
      active = undefined;
  }
  return active;
}

/** Mirrors the server's expert-form lifecycle check for presentation only. */
export function specialistFormStateForTurn(
  history: readonly Turn[],
  source: Turn,
): SpecialistFormState | undefined {
  if (source.status !== "completed" || !source.specialist || !hasForm(source))
    return undefined;
  const taskId = source.specialist.taskId;
  const active = activeSpecialistTurn(history);
  if (active?.specialist?.taskId !== taskId) return "expired";
  const replaced = history.some(
    (turn) =>
      turn.id > source.id &&
      turn.status === "completed" &&
      turn.specialist?.taskId === taskId &&
      hasForm(turn),
  );
  return replaced ? "replaced" : "current";
}
