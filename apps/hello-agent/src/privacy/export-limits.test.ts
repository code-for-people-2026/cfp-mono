import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginPrivacyExport } from "./export-limits";
import { privacyGet } from "./http";
import type { Payload } from "payload";

const data = vi.hoisted(() => ({ exportData: vi.fn() }));
vi.mock("./service", () => ({ privacyService: () => data, recoverOwner: vi.fn() }));
let now = Date.now();
beforeEach(() => { vi.useFakeTimers(); now += 60_001; vi.setSystemTime(now); data.exportData.mockReset(); });
afterEach(() => { now = Date.now(); vi.useRealTimers(); });
it("每个身份每分钟最多两次导出", () => {
  beginPrivacyExport("owner")(); beginPrivacyExport("owner")();
  expect(() => beginPrivacyExport("owner")).toThrow("一分钟");
});
it("更换身份不能绕过每分钟全局二十次限制", () => {
  for (let index = 0; index < 20; index++) beginPrivacyExport(`fresh-${index}`)();
  expect(() => beginPrivacyExport("another-new-owner")).toThrow("一分钟");
});
it("最多同时进行两次导出，释放只能生效一次", () => {
  const first = beginPrivacyExport("one"), second = beginPrivacyExport("two");
  try {
    expect(() => beginPrivacyExport("three")).toThrow("稍后重试");
    first(); first();
    const third = beginPrivacyExport("four");
    try { expect(() => beginPrivacyExport("five")).toThrow("稍后重试"); } finally { third(); }
  } finally { first(); second(); }
});
it("GET 导出失败会释放并发名额，成功才返回附件", async () => {
  const payload = {} as Payload;
  data.exportData.mockRejectedValue(new Error("too large"));
  for (let index = 0; index < 3; index++) await expect(privacyGet(payload, { id: `failed-${index}`, auth: "cookie" }, "export")).rejects.toThrow("too large");
  data.exportData.mockResolvedValue({ format: "test" });
  const response = await privacyGet(payload, { id: "success", auth: "cookie" }, "export");
  expect(response.headers.get("Content-Disposition")).toContain("attachment");
  expect(await response.json()).toEqual({ format: "test" });
});

it("单个已限流身份反复重试，不消耗其他人的全局额度", () => {
  beginPrivacyExport("noisy-owner")(); beginPrivacyExport("noisy-owner")();
  for (let attempt = 0; attempt < 50; attempt++) expect(() => beginPrivacyExport("noisy-owner")).toThrow("一分钟");
  for (let index = 0; index < 18; index++) beginPrivacyExport(`other-owner-${index}`)();
  expect(() => beginPrivacyExport("global-is-now-full")).toThrow("一分钟");
});
it("全局拒绝也不扣身份额度，下一窗口仍可正常导出", () => {
  for (let index = 0; index < 20; index++) beginPrivacyExport(`fill-${index}`)();
  vi.advanceTimersByTime(30_000);
  for (let attempt = 0; attempt < 2; attempt++) expect(() => beginPrivacyExport("waiting-owner")).toThrow("一分钟");
  vi.advanceTimersByTime(30_001);
  beginPrivacyExport("waiting-owner")(); beginPrivacyExport("waiting-owner")();
});
it("并发已满的重试不扣身份或全局额度", () => {
  const first = beginPrivacyExport("busy-one"), second = beginPrivacyExport("busy-two");
  try {
    for (let attempt = 0; attempt < 30; attempt++) expect(() => beginPrivacyExport("waiting-for-slot")).toThrow("稍后重试");
  } finally { first(); second(); }
  beginPrivacyExport("waiting-for-slot")(); beginPrivacyExport("waiting-for-slot")();
});
