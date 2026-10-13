import type { Payload } from "payload";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../domain/contracts";
import { recoveryResponse } from "./http";
import { failure } from "../server/http";
const stubs = vi.hoisted(() => ({ recover: vi.fn(), mint: vi.fn() }));
vi.mock("./service", () => ({ recoverOwner: stubs.recover }));
vi.mock("../server/auth", async (original) => ({ ...await original<typeof import("../server/auth")>(), mintCredential: stubs.mint }));
let now = Date.now();
beforeEach(() => {
  vi.useFakeTimers(); now += 60_001; vi.setSystemTime(now);
  vi.stubEnv("HELLO_DEPLOYED", "true"); vi.stubEnv("HELLO_TRUST_PROXY", "true");
  stubs.recover.mockReset().mockResolvedValue("recovered");
  stubs.mint.mockReset().mockResolvedValue({ owner: "recovered", token: "new-credential" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function recover(ip: string | undefined, body = JSON.stringify({ native: true, code: "a".repeat(43) }), extraHeaders = {}) {
  const headers = { ...extraHeaders, ...(ip ? { "x-real-ip": ip } : {}) };
  try { return await recoveryResponse({} as Payload, new Request("http://localhost/api/hello/privacy-recover", { method: "POST", headers, body })); }
  catch (error) { return failure(error); }
}
it("单个来源的畸形请求及被拒重试不会封锁其他人的恢复", async () => {
  for (let index = 0; index < 20; index++) expect((await recover("192.0.2.1", "{")).status).toBe(400);
  for (let index = 0; index < 50; index++) expect((await recover("192.0.2.1")).status).toBe(429);
  expect((await recover("192.0.2.2")).status).toBe(200);
  expect(stubs.recover).toHaveBeenCalledTimes(1);
});
it("格式正确但无效的恢复码也按来源限流，另一来源仍可恢复", async () => {
  stubs.recover.mockRejectedValue(new AppError(401, "恢复码无效"));
  for (let index = 0; index < 20; index++) expect((await recover("192.0.2.3")).status).toBe(401);
  expect((await recover("192.0.2.3")).status).toBe(429);
  stubs.recover.mockResolvedValue("recovered");
  expect((await recover("192.0.2.4")).status).toBe(200);
});
it("伪造转发链不能改变可信代理传入的调用者额度", async () => {
  for (let index = 0; index < 20; index++) expect((await recover("192.0.2.5", "null", { "x-forwarded-for": `198.51.100.${index}` })).status).toBe(400);
  expect((await recover("192.0.2.5", undefined, { "x-forwarded-for": "203.0.113.99" })).status).toBe(429);
});
it("部署缺少可信来源或代理配置时拒绝，不访问恢复数据", async () => {
  for (const ip of [undefined, "bad", "192.0.2.1, 192.0.2.2"]) expect((await recover(ip)).status).toBe(503);
  vi.stubEnv("HELLO_TRUST_PROXY", "false");
  expect((await recover("192.0.2.1")).status).toBe(503);
  expect(stubs.recover).not.toHaveBeenCalled();
});
it("有效请求另受较大的全局上限保护，窗口到期后恢复", async () => {
  for (let index = 0; index < 200; index++) expect((await recover(`198.51.100.${index + 1}`)).status).toBe(200);
  expect((await recover("203.0.113.1")).status).toBe(429);
  expect(stubs.recover).toHaveBeenCalledTimes(200);
  vi.advanceTimersByTime(60_001);
  expect((await recover("203.0.113.1")).status).toBe(200);
});
