import configPromise from "@payload-config";
import { getPayload } from "payload";
import { afterAll, describe, expect, it, vi } from "vitest";
import { GET as health } from "./route";
import { probeCmsDatabase, readyResponse, verifyCmsDatabaseReady } from "../ready/route";
import { migrations } from "../../../../migrations/generated";

const request = (token = "internal-value") =>
  new Request("http://cms/api/ready", { headers: { "x-internal-token": token } });

describe("CMS probes", () => {
  it("keeps liveness independent of the database", async () => {
    expect(await (await health()).json()).toEqual({ status: "ok" });
  });

  it("rejects readiness before probing when internal auth fails", async () => {
    const probe = vi.fn();
    const response = await readyResponse(request("wrong"), { internalToken: "internal-value", probe });
    expect(response.status).toBe(503);
    expect(probe).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: false, service: "cms", category: "internal_auth_failed" });
  });

  it("reports ready after the authenticated PostgreSQL schema probe succeeds", async () => {
    const response = await readyResponse(request(), {
      internalToken: "internal-value",
      probe: vi.fn().mockResolvedValue(undefined),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "cms" });
  });

  it("requires the exact committed migration head when schema push is disabled", async () => {
    const findSeller = vi.fn();
    const missingHead = vi.fn()
      .mockResolvedValueOnce({ rows: [{ relation: null }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(verifyCmsDatabaseReady({
      dbName: "postgres",
      pushEnabled: false,
      query: missingHead,
      findSeller,
    })).rejects.toThrow(/migration head mismatch/);
    expect(findSeller).not.toHaveBeenCalled();

    const exactHead = vi.fn()
      .mockResolvedValueOnce({ rows: [{ relation: "cms.payload_migrations" }] })
      .mockResolvedValueOnce({ rows: migrations.map(({ name }) => ({ name, batch: 1 })) });
    await expect(verifyCmsDatabaseReady({
      dbName: "postgres",
      pushEnabled: false,
      query: exactHead,
      findSeller,
    })).resolves.toBeUndefined();
    expect(findSeller).toHaveBeenCalledOnce();
  });

  it("redacts PostgreSQL or schema probe failures", async () => {
    const response = await readyResponse(request(), {
      internalToken: "internal-value",
      probe: vi.fn().mockRejectedValue(new Error("postgres://secret@db/cfp cms missing")),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, service: "cms", category: "database_unavailable" });
  });

  it("bounds a stalled PostgreSQL probe and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      const stalled = readyResponse(request(), {
        internalToken: "internal-value",
        probe: () => new Promise<void>(() => undefined),
        timeoutMs: 5_000,
      });
      const sentinel = Symbol("hung");
      const outcome = Promise.race([
        stalled,
        new Promise<typeof sentinel>((resolve) => setTimeout(() => resolve(sentinel), 5_001)),
      ]);
      await vi.advanceTimersByTimeAsync(5_001);
      const response = await outcome;
      expect(response).not.toBe(sentinel);
      expect((response as Response).status).toBe(503);
      expect(await (response as Response).json()).toEqual({
        ok: false,
        service: "cms",
        category: "database_unavailable",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!process.env.PAYLOAD_DATABASE_URL)("CMS PostgreSQL readiness", () => {
  afterAll(async () => (await getPayload({ config: configPromise })).destroy());

  it("queries the configured cms schema", async () => {
    const response = await readyResponse(request(), { internalToken: "internal-value", probe: probeCmsDatabase });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "cms" });
  });
});
