import { afterEach, describe, expect, it, vi } from "vitest";

const payloadMocks = vi.hoisted(() => ({ getPayload: vi.fn() }));

vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: payloadMocks.getPayload,
}));

import { GET, readyResponse, verifyWebsiteDatabaseReady } from "./route";

const releaseSha = "d".repeat(40);

afterEach(() => {
  payloadMocks.getPayload.mockReset();
  vi.unstubAllEnvs();
});

describe("GET /api/ready", () => {
  it("uses Payload to read the production website schema", async () => {
    const find = vi.fn(async () => ({ docs: [] }));
    payloadMocks.getPayload.mockResolvedValue({ db: { name: "postgres" }, find });
    vi.stubEnv("RELEASE_SHA", releaseSha);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "website",
      releaseSha,
    });
    expect(find).toHaveBeenCalledWith({
      collection: "site-documents",
      depth: 0,
      limit: 1,
      overrideAccess: true,
    });
  });
});

describe("verifyWebsiteDatabaseReady", () => {
  it("requires Postgres and reads the website schema", async () => {
    const findDocument = vi.fn(async () => undefined);

    await expect(
      verifyWebsiteDatabaseReady({ dbName: "postgres", findDocument }),
    ).resolves.toBeUndefined();
    expect(findDocument).toHaveBeenCalledOnce();
  });

  it("rejects a non-Postgres production database", async () => {
    await expect(
      verifyWebsiteDatabaseReady({
        dbName: "sqlite",
        findDocument: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("PostgreSQL required");
  });
});

describe("readyResponse", () => {
  it("reports the release only after the database probe succeeds", async () => {
    const probe = vi.fn(async () => undefined);

    const response = await readyResponse({ probe, releaseSha });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "website",
      releaseSha,
    });
    expect(probe).toHaveBeenCalledOnce();
  });

  it("fails closed without leaking database errors", async () => {
    const response = await readyResponse({
      probe: vi.fn(async () => {
        throw new Error("password=do-not-leak");
      }),
      releaseSha,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: "website",
      releaseSha,
      category: "database_unavailable",
    });
  });

  it("times out a stalled database probe", async () => {
    const response = await readyResponse({
      probe: () => new Promise(() => undefined),
      releaseSha,
      timeoutMs: 1,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      category: "database_unavailable",
    });
  });
});
