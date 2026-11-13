import type { Moderator } from "../src/domain/moderation";

// Injected only by isolated persistence/protocol fixtures with scripted models.
// No runtime switch; real allow/block/unavailable behavior has dedicated moderation checks.
export const ordinaryInteraction = {
  minor: false,
  crisis: false,
  dependency: false,
  overuse: false,
  exit: false,
  forget_context: false,
  image_requested: false,
} as const;

export const imageInteraction = (imageRequested: boolean) => ({
  ...ordinaryInteraction,
  image_requested: imageRequested,
} as const);

export const imageReview = (imageRequested: boolean) => ({
  serviceScope: "support" as const,
  interaction: imageInteraction(imageRequested),
});

export const syntheticTextReview: Moderator = async request => {
  if (request.stage === "output") return request.serviceScope ? { serviceScope: "support" as const } : undefined;
  if (request.purpose === "image_generation") return imageReview(false);
  return {
    ...(request.serviceScope ? { serviceScope: "support" as const } : {}),
    ...(request.interaction ? { interaction: ordinaryInteraction } : {}),
  };
};
