import configPromise from "@payload-config";
import { getPayload } from "payload";
import { afterAll, describe, expect, it, vi } from "vitest";
import { GET as health } from "./route";
import { probeCmsDatabase, readyResponse } from "../ready/route";

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

  it("redacts PostgreSQL or schema probe failures", async () => {
    const response = await readyResponse(request(), {
      internalToken: "internal-value",
      probe: vi.fn().mockRejectedValue(new Error("postgres://secret@db/cfp cms missing")),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, service: "cms", category: "database_unavailable" });
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
