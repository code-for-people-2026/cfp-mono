import type { Payload } from "payload";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../domain/contracts";
import { recoveryResponse } from "./http";
import { failure } from "../server/http";
const stubs = vi.hoisted(() => ({ recover: vi.fn(), mint: vi.fn() }));
vi.mock("./service", () => ({ withRecoveredOwner: async (_payload: Payload, code: string, issue: (owner: string) => Promise<unknown>) => issue(await stubs.recover(code)) }));
vi.mock("../server/auth", async (original) => ({ ...await original<typeof import("../server/auth")>(), mintCredential: stubs.mint }));
let now = Date.now();
beforeEach(() => {
  vi.useFakeTimers(); now += 60_001; vi.setSystemTime(now);
  vi.stubEnv("HELLO_DEPLOYED", "true"); vi.stubEnv("HELLO_TRUST_PROXY", "true");
  stubs.recover.mockReset().mockResolvedValue("recovered");
  stubs.mint.mockReset().mockResolvedValue({ owner: "recovered", token: "new-credential" });
});
afterEach(() => { now = Date.now(); vi.useRealTimers(); vi.unstubAllEnvs(); });
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

it("同码并发恢复不会撤销第一个刚签发的凭证，冲突方明确重试", async () => {
  const mintStarted = Promise.withResolvers<void>(), finishMint = Promise.withResolvers<void>();
  const credentials = new Set<string>();
  stubs.recover.mockImplementation(async () => { credentials.clear(); return "recovered"; });
  stubs.mint.mockImplementation(async () => {
    credentials.add("issued-once"); mintStarted.resolve(); await finishMint.promise;
    return { token: "issued-once", owner: "recovered" };
  });
  const first = recover("192.0.2.10");
  try {
    await mintStarted.promise;
    const second = await recover("192.0.2.11");
    expect(second.status).toBe(409);
    expect(stubs.recover).toHaveBeenCalledTimes(1);
    expect(stubs.mint).toHaveBeenCalledTimes(1);
    finishMint.resolve();
    const response = await first;
    expect(response.status).toBe(200);
    expect(credentials.has((await response.json()).token)).toBe(true);
  } finally { finishMint.resolve(); await first; }
});
it("查找阶段就阻止同码并发，失败后释放保护允许重试", async () => {
  const lookupStarted = Promise.withResolvers<void>(), finishLookup = Promise.withResolvers<void>();
  stubs.recover.mockImplementationOnce(async () => {
    lookupStarted.resolve(); await finishLookup.promise; throw new AppError(401, "恢复码无效");
  });
  const first = recover("192.0.2.12");
  try {
    await lookupStarted.promise;
    expect((await recover("192.0.2.13")).status).toBe(409);
    finishLookup.resolve(); expect((await first).status).toBe(401);
    expect((await recover("192.0.2.13")).status).toBe(200);
  } finally { finishLookup.resolve(); await first; }
});
