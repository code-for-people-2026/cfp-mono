import { describe, expect, it } from "vitest";
import { protectRecordPhotos } from "../src/media";

describe("private record photo projection", () => {
  it("preserves photo field states while protecting nested fact and revision URLs", () => {
    for (const state of ["known", "pending", "unknown", "not_applicable", "not_yet"]) {
      const event = { id: "event", legacyId: "activity", babyId: "baby-a", states: { poopPhotoUrl: state }, facts: { poopPhotoUrl: "https://old.invalid/photo.png" }, revision: { before: { states: { poopPhotoUrl: state }, facts: { poopPhotoUrl: "https://old.invalid/previous.png" } } } };
      const protectedUrl = "/api/app/media/activities/activity?babyId=baby-a";
      expect(protectRecordPhotos(event, "baby-a")).toEqual({ ...event, facts: { poopPhotoUrl: protectedUrl }, revision: { before: { states: { poopPhotoUrl: state }, facts: { poopPhotoUrl: protectedUrl } } } });
    }
  });
});
