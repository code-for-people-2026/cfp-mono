import type { Moderator } from "../src/domain/moderation";

// Injected only by isolated persistence/protocol fixtures with scripted models.
// No runtime switch; real allow/block/unavailable behavior has dedicated moderation checks.
export const syntheticTextReview: Moderator = async () => {};
