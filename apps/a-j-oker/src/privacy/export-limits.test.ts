import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginPrivacyExport } from "./export-limits";
import { privacyGet } from "./http";
import type { Payload } from "payload";

const data = vi.hoisted(() => ({ exportData: vi.fn() }));
vi.mock("./service", () => ({ privacyService: () => data, withRecoveredOwner: vi.fn() }));
let nextCaller = 0;
const addresses = new Map<string, string>();
const requestFor = (caller: string) => {
  if (!addresses.has(caller)) addresses.set(caller, `2001:db8::${(++nextCaller).toString(16)}`);
  return new Request("http://localhost/api/hello/privacy/export", { headers: { "x-real-ip": addresses.get(caller)! } });
};
const begin = (owner: string, caller = owner) => beginPrivacyExport(owner, requestFor(caller));
let now = Date.now();
beforeEach(() => { vi.stubEnv("HELLO_TRUST_PROXY", "true"); vi.stubEnv("HELLO_DEPLOYED", "true"); vi.useFakeTimers(); now += 60_001; vi.setSystemTime(now); data.exportData.mockReset(); });
afterEach(() => { now = Date.now(); vi.useRealTimers(); vi.unstubAllEnvs(); });
it("每个身份每分钟最多两次导出", () => {
  begin("owner")(); begin("owner")();
  expect(() => begin("owner")).toThrow("一分钟");
});
it("更换身份不能绕过每分钟全局二十次限制", () => {
  for (let index = 0; index < 20; index++) begin(`fresh-${index}`)();
  expect(() => begin("another-new-owner")).toThrow("一分钟");
});
it("最多同时进行两次导出，释放只能生效一次", () => {
  const first = begin("one"), second = begin("two");
  try {
    expect(() => begin("three")).toThrow("稍后重试");
    first(); first();
    const third = begin("four");
    try { expect(() => begin("five")).toThrow("稍后重试"); } finally { third(); }
  } finally { first(); second(); }
});
it("GET 导出失败会释放并发名额，成功才返回附件", async () => {
  const payload = {} as Payload;
  data.exportData.mockRejectedValue(new Error("too large"));
  for (let index = 0; index < 3; index++) await expect(privacyGet(payload, { id: `failed-${index}`, auth: "cookie" }, "export", requestFor(`failed-${index}`))).rejects.toThrow("too large");
  data.exportData.mockResolvedValue({ format: "test" });
  const response = await privacyGet(payload, { id: "success", auth: "cookie" }, "export", requestFor("success"));
  expect(response.headers.get("Content-Disposition")).toContain("attachment");
  expect(await response.json()).toEqual({ format: "test" });
});

it("单个已限流身份反复重试，不消耗其他人的全局额度", () => {
  begin("noisy-owner")(); begin("noisy-owner")();
  for (let attempt = 0; attempt < 50; attempt++) expect(() => begin("noisy-owner")).toThrow("一分钟");
  for (let index = 0; index < 18; index++) begin(`other-owner-${index}`)();
  expect(() => begin("global-is-now-full")).toThrow("一分钟");
});
it("全局拒绝也不扣身份额度，下一窗口仍可正常导出", () => {
  for (let index = 0; index < 20; index++) begin(`fill-${index}`)();
  vi.advanceTimersByTime(30_000);
  for (let attempt = 0; attempt < 2; attempt++) expect(() => begin("waiting-owner")).toThrow("一分钟");
  vi.advanceTimersByTime(30_001);
  begin("waiting-owner")(); begin("waiting-owner")();
});
it("并发已满的重试不扣身份或全局额度", () => {
  const first = begin("busy-one"), second = begin("busy-two");
  try {
    for (let attempt = 0; attempt < 30; attempt++) expect(() => begin("waiting-for-slot")).toThrow("稍后重试");
  } finally { first(); second(); }
  begin("waiting-for-slot")(); begin("waiting-for-slot")();
});

it("更换十个身份并反复重试也只能花同一来源的四次额度，其他来源仍可导出", () => {
  for (let index = 0; index < 4; index++) begin(`disposable-${index}`, "noisy-source")();
  for (let index = 0; index < 50; index++) expect(() => begin(`more-disposable-${index}`, "noisy-source")).toThrow("一分钟");
  for (let index = 0; index < 16; index++) begin(`other-source-${index}`)();
  expect(() => begin("global-now-full")).toThrow("一分钟");
});
it("同来源只能占一个并发位，另一来源始终保留并发机会", () => {
  const first = begin("caller-first", "same-source");
  try {
    expect(() => begin("caller-second", "same-source")).toThrow("稍后重试");
    const other = begin("different-source"); other();
  } finally { first(); }
  begin("caller-second", "same-source")();
});
it("部署缺少可信来源或代理配置时拒绝导出，不读取数据", async () => {
  const payload = {} as Payload;
  for (const ip of ["", "bad", "192.0.2.1, 192.0.2.2"]) {
    const request = new Request("http://localhost", { headers: { "x-real-ip": ip, "x-forwarded-for": "192.0.2.1" } });
    await expect(privacyGet(payload, { id: "source-missing", auth: "cookie" }, "export", request)).rejects.toMatchObject({ status: 503 });
  }
  vi.stubEnv("HELLO_TRUST_PROXY", "false");
  await expect(privacyGet(payload, { id: "proxy-missing", auth: "cookie" }, "export", requestFor("valid-ip"))).rejects.toMatchObject({ status: 503 });
  expect(data.exportData).not.toHaveBeenCalled();
});
it("伪造转发链不能改变代理确认的导出额度", () => {
  for (let index = 0; index < 4; index++) begin(`forwarded-${index}`, "proxy-confirmed")();
  const request = requestFor("proxy-confirmed"); request.headers.set("x-forwarded-for", "203.0.113.12");
  expect(() => beginPrivacyExport("new-forwarded-owner", request)).toThrow("一分钟");
  begin("honest-other-source")();
});
