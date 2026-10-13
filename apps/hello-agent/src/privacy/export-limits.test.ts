import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginPrivacyExport } from "./export-limits";
import { privacyGet } from "./http";
import type { Payload } from "payload";

const data = vi.hoisted(() => ({ exportData: vi.fn() }));
vi.mock("./service", () => ({ privacyService: () => data, recoverOwner: vi.fn() }));
let now = Date.now();
beforeEach(() => { vi.useFakeTimers(); now += 60_001; vi.setSystemTime(now); data.exportData.mockReset(); });
afterEach(() => vi.useRealTimers());
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
