import { describe, expect, it } from "vitest";
import { protectRecordPhotos } from "../src/media";
import type { CareEvent, FieldState } from "../src/records/types";

const photoEvent = (legacyId: string, state: FieldState): CareEvent => ({
  id: `event-${legacyId}`, legacyId, babyId: "baby-a", version: 2,
  facts: { type: "DIAPER", startTime: "2026-11-13T08:00:00+08:00", poopPhotoUrl: `https://old.invalid/${legacyId}.png` },
  states: { poopPhotoUrl: state }, progress: "ended", evidence: [], missing: [], conflicts: [], complete: false,
  lifecycle: "active", duplicateCandidates: [], sources: [], attachmentIds: [], actor: { kind: "caregiver", id: "parent", sessionId: "session" },
  projection: "synced", projected: null, createdAt: "2026-11-13T08:01:00+08:00", updatedAt: "2026-11-13T08:02:00+08:00",
});

describe("private record photo projection", () => {
  it("preserves photo field states while protecting nested fact and revision URLs", () => {
    for (const state of ["known", "pending", "unknown", "not_applicable", "not_yet"] as const) {
      const before = photoEvent("activity-before", state);
      const after = photoEvent("activity-after", state);
      const source = { events: [after], revisions: [{ id: `revision-${state}`, eventId: after.id, babyId: "baby-a", version: 2, before, after, actor: after.actor, at: "2026-11-13T08:03:00+08:00" }] };
      const unchanged = structuredClone(source);
      const result = protectRecordPhotos(source, "baby-a") as typeof source;
      const protectedUrl = (legacyId: string) => `/api/app/media/activities/${legacyId}?babyId=baby-a`;

      expect(source).toEqual(unchanged);
      expect(result.events[0]!.facts.poopPhotoUrl).toBe(protectedUrl("activity-after"));
      expect(result.events[0]!.states.poopPhotoUrl).toBe(state);
      expect(result.revisions[0]!.before.facts.poopPhotoUrl).toBe(protectedUrl("activity-before"));
      expect(result.revisions[0]!.before.states.poopPhotoUrl).toBe(state);
      expect(result.revisions[0]!.after.facts.poopPhotoUrl).toBe(protectedUrl("activity-after"));
      expect(JSON.stringify(result)).not.toContain("https://old.invalid");
      expect(JSON.stringify(result)).not.toContain("/activities/event-");
      expect(JSON.stringify(result)).not.toContain(`/activities/revision-${state}`);
    }
  });
});
