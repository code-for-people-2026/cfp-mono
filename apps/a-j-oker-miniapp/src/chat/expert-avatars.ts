import actAvatar from "../assets/experts/act.png";
import behavioralAvatar from "../assets/experts/behavioral.png";
import cbtAvatar from "../assets/experts/cbt.png";
import dbtAvatar from "../assets/experts/dbt.png";
import positivePsychologyAvatar from "../assets/experts/positive_psychology.png";
import selfCompassionAvatar from "../assets/experts/self_compassion.png";
import solutionFocusedAvatar from "../assets/experts/solution_focused.png";
import supportiveAvatar from "../assets/experts/supportive.png";

const bundledExpertAvatars = {
  "aj-expert:supportive": supportiveAvatar,
  "aj-expert:cbt": cbtAvatar,
  "aj-expert:act": actAvatar,
  "aj-expert:dbt": dbtAvatar,
  "aj-expert:behavioral": behavioralAvatar,
  "aj-expert:solution_focused": solutionFocusedAvatar,
  "aj-expert:self_compassion": selfCompassionAvatar,
  "aj-expert:positive_psychology": positivePsychologyAvatar,
} as const;

export type ExpertAvatarReference = keyof typeof bundledExpertAvatars;

/**
 * Presentation avatars are opaque references, not URLs. Only assets compiled
 * into this mini app may be resolved; every other historical reference uses
 * the shared presentation header's initial fallback.
 */
export function resolveExpertAvatarSource(
  reference: string | undefined,
): string | undefined {
  return reference &&
      Object.prototype.hasOwnProperty.call(bundledExpertAvatars, reference)
    ? bundledExpertAvatars[reference as ExpertAvatarReference]
    : undefined;
}
