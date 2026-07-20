import { describe, expect, it } from "vitest";
import { resolveReleaseSha } from "./release";

const releaseSha = "a".repeat(40);
const vercelSha = "b".repeat(40);

describe("resolveReleaseSha", () => {
  it("prefers the immutable self-hosted image revision", () => {
    expect(
      resolveReleaseSha({
        RELEASE_SHA: releaseSha,
        VERCEL_GIT_COMMIT_SHA: vercelSha,
      }),
    ).toBe(releaseSha);
  });

  it("uses the Vercel commit SHA when no image revision is available", () => {
    expect(resolveReleaseSha({ VERCEL_GIT_COMMIT_SHA: vercelSha })).toBe(vercelSha);
  });

  it("does not expose malformed release identifiers", () => {
    expect(
      resolveReleaseSha({
        RELEASE_SHA: "unknown",
        VERCEL_GIT_COMMIT_SHA: "ABCDEF",
      }),
    ).toBe("unknown");
    expect(resolveReleaseSha({})).toBe("unknown");
  });
});
