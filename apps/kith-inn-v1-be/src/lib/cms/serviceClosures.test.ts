import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CmsServiceClosureError,
  createServiceClosure,
  deleteServiceClosure,
  listServiceClosures
} from "./serviceClosures";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});
const closure = { id: 41, sellerId: 7, date: "2026-07-27", occasion: null, note: "休息" };
const response = (body: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  }))
});

describe("CMS service closure client", () => {
  it("lists, creates and deletes through seller-scoped CMS routes", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const listed = response({ docs: [closure] });
    await expect(listServiceClosures("jwt", { from: "2026-07-01", to: "2026-07-31" }, listed))
      .resolves.toEqual([closure]);
    expect(listed.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/service-closures?from=2026-07-01&to=2026-07-31",
      { headers: { "x-kith-inn-v1-operator": "jwt" } }
    );

    const created = response({ doc: closure }, 201);
    await expect(createServiceClosure("jwt", {
      date: "2026-07-27", occasion: null, note: null
    }, created)).resolves.toEqual(closure);
    expect(created.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/service-closures",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ date: "2026-07-27", occasion: null, note: null }),
        headers: expect.objectContaining({ "x-kith-inn-v1-internal": "internal" })
      })
    );

    const deleted = response(null, 204);
    await expect(deleteServiceClosure("jwt", 41, deleted)).resolves.toBeUndefined();
    expect(deleted.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/service-closures/41",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("preserves CMS errors and rejects malformed success payloads", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(listServiceClosures("jwt", { from: "2026-07-01", to: "2026-07-31" },
      response({ error: "seller-inactive", message: "停用" }, 403)))
      .rejects.toMatchObject({ status: 403, code: "seller-inactive", message: "停用" });
    await expect(createServiceClosure("jwt", {
      date: "2026-07-27", occasion: null, note: null
    }, response({})))
      .rejects.toBeInstanceOf(CmsServiceClosureError);
    await expect(createServiceClosure("jwt", {
      date: "2026-07-27", occasion: null, note: null
    }, response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(createServiceClosure("jwt", {
      date: "2026-07-27", occasion: null, note: null
    }, response("bad")))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(listServiceClosures("jwt", { from: "2026-07-01", to: "2026-07-31" }, response({ docs: [{}] })))
      .rejects.toMatchObject({ status: 502, code: "invalid-cms-response" });
    await expect(deleteServiceClosure("jwt", 41, response({ error: "not-found" }, 404)))
      .rejects.toMatchObject({ status: 404, code: "not-found", message: "营业安排服务失败" });
    await expect(deleteServiceClosure("jwt", 41, response("bad", 500)))
      .rejects.toMatchObject({ status: 500, code: "cms-service-closure-failed" });
  });

  it("uses global fetch and fails explicitly without CMS_BASE_URL", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    vi.stubGlobal("fetch", response({ docs: [] }).fetch);
    await expect(listServiceClosures("jwt", { from: "2026-07-01", to: "2026-07-31" }))
      .resolves.toEqual([]);
    delete process.env.CMS_BASE_URL;
    await expect(listServiceClosures("jwt", { from: "2026-07-01", to: "2026-07-31" }))
      .rejects.toThrow(/CMS_BASE_URL/);
  });
});
