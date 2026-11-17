import { describe, expect, it } from "vitest";
import { resolveExpertAvatarSource } from "../src/chat/expert-avatars";

describe("expert avatar references", () => {
  it("resolves every bundled AJ expert", () => {
    for (const approach of [
      "supportive",
      "cbt",
      "act",
      "dbt",
      "behavioral",
      "solution_focused",
      "self_compassion",
      "positive_psychology",
    ]) {
      expect(resolveExpertAvatarSource(`aj-expert:${approach}`)).toBeTruthy();
    }
  });

  it("does not turn a presentation reference into arbitrary URL loading", () => {
    expect(resolveExpertAvatarSource("https://example.com/expert.png")).toBeUndefined();
    expect(resolveExpertAvatarSource("aj-expert:unknown")).toBeUndefined();
    for (const inheritedKey of ["constructor", "toString", "__proto__"]) {
      expect(resolveExpertAvatarSource(inheritedKey)).toBeUndefined();
    }
    expect(resolveExpertAvatarSource(undefined)).toBeUndefined();
  });
});
