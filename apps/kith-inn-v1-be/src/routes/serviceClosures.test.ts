import type { ServiceClosure } from "@cfp/kith-inn-v1-shared";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { describe, expect, it, vi } from "vitest";
import { CmsServiceClosureError } from "../lib/cms/serviceClosures";
import { serviceClosuresRoutes, type ServiceClosuresDeps } from "./serviceClosures";

const SECRET = "v1-secret";
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const closure: ServiceClosure = {
  id: 41, sellerId: 7, date: "2026-07-27", occasion: null, note: "休息"
};
const auth = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
const deps = (overrides: Partial<ServiceClosuresDeps> = {}): ServiceClosuresDeps => ({
  listClosures: vi.fn(async () => [closure]),
  createClosure: vi.fn(async () => closure),
  deleteClosure: vi.fn(async () => undefined),
  ...overrides
});

describe("merchant service closure routes", () => {
  it("lists, creates and deletes closures", async () => {
    const injected = deps();
    const app = serviceClosuresRoutes(SECRET, injected);
    const listed = await app.request("/?from=2026-07-01&to=2026-07-31", { headers: auth });
    await expect(listed.json()).resolves.toEqual({ docs: [closure] });
    expect(injected.listClosures).toHaveBeenCalledWith(token, { from: "2026-07-01", to: "2026-07-31" });
    const created = await app.request("/", {
      method: "POST", headers: auth, body: JSON.stringify({ date: "2026-07-27", note: " 休息 " })
    });
    expect(created.status).toBe(201);
    expect(injected.createClosure).toHaveBeenCalledWith(token, {
      date: "2026-07-27", occasion: null, note: "休息"
    });
    expect((await app.request("/41", { method: "DELETE", headers: auth })).status).toBe(204);
    expect(injected.deleteClosure).toHaveBeenCalledWith(token, "41");
  });

  it("validates input and maps CMS failures", async () => {
    const app = serviceClosuresRoutes(SECRET, deps());
    expect((await app.request("/", { headers: auth })).status).toBe(400);
    expect((await app.request("/", { method: "POST", headers: auth, body: "{" })).status).toBe(400);
    expect((await app.request("/", {
      method: "POST", headers: auth, body: JSON.stringify({ date: "bad" })
    })).status).toBe(422);
    const conflict = serviceClosuresRoutes(SECRET, deps({
      createClosure: vi.fn(async () => {
        throw new CmsServiceClosureError(409, "service-closure-in-use", "已有订单");
      })
    }));
    expect((await conflict.request("/", {
      method: "POST", headers: auth, body: JSON.stringify({ date: "2026-07-27" })
    })).status).toBe(409);
    const listFailed = serviceClosuresRoutes(SECRET, deps({
      listClosures: vi.fn(async () => { throw new CmsServiceClosureError(500, "list-failed", "失败"); })
    }));
    expect((await listFailed.request("/?from=2026-07-01&to=2026-07-31", { headers: auth })).status).toBe(502);
    const deleteFailed = serviceClosuresRoutes(SECRET, deps({
      deleteClosure: vi.fn(async () => { throw new CmsServiceClosureError(404, "not-found", "不存在"); })
    }));
    expect((await deleteFailed.request("/99", { method: "DELETE", headers: auth })).status).toBe(404);
    const unavailable = serviceClosuresRoutes(SECRET, deps({
      listClosures: vi.fn(async () => { throw new Error("offline"); })
    }));
    expect((await unavailable.request("/?from=2026-07-01&to=2026-07-31", { headers: auth })).status).toBe(502);
    const internalAuthFailed = serviceClosuresRoutes(SECRET, deps({
      createClosure: vi.fn(async () => {
        throw new CmsServiceClosureError(401, "internal-unauthorized", "营业安排服务失败");
      })
    }));
    expect((await internalAuthFailed.request("/", {
      method: "POST", headers: auth, body: JSON.stringify({ date: "2026-07-27" })
    })).status).toBe(502);
    const operatorAuthFailed = serviceClosuresRoutes(SECRET, deps({
      listClosures: vi.fn(async () => { throw new CmsServiceClosureError(401, "unauthorized", "登录失效"); })
    }));
    expect((await operatorAuthFailed.request("/?from=2026-07-01&to=2026-07-31", { headers: auth })).status).toBe(401);
  });
});
