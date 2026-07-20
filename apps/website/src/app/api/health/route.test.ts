import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports liveness and the immutable release SHA", async () => {
    const releaseSha = "c".repeat(40);
    vi.stubEnv("RELEASE_SHA", releaseSha);

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", releaseSha });
  });

  it("uses an explicit unknown identity outside a release image", async () => {
    vi.stubEnv("RELEASE_SHA", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");

    await expect(GET().json()).resolves.toEqual({ status: "ok", releaseSha: "unknown" });
  });
});
