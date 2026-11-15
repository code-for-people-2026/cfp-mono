import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aliyunRequest, idAgeBand, interpretAliyun, verifyAliyunAge } from "./aliyun";

// Checksum-valid strings use a non-existent area code and never leave these mocks.
const syntheticId = (birthday: string) => {
  const prefix = `990000${birthday}001`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return prefix + "10X98765432"[weights.reduce((sum, weight, index) => sum + Number(prefix[index]) * weight, 0) % 11];
};
const now = new Date("2026-10-13T16:00:00Z");
const result = (BizCode: unknown) => ({ Code: "200", RequestId: "synthetic-request", ResultObject: { BizCode } });
beforeEach(() => {
  for (const [key, value] of Object.entries({ HELLO_AGE_PROVIDER: "aliyun", HELLO_AGE_SECRET_ID: "fake", HELLO_AGE_SECRET_KEY: "fake", HELLO_AGE_PROVIDER_APPROVED: "true", HELLO_AGE_PROVIDER_DISCLOSURE: "仅用于隔离测试" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No live identity queries in tests")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("身份证格式或生日只能分段，必须姓名证件匹配成功才接受年龄证据", () => {
  const adult = syntheticId("20081014");
  expect(idAgeBand(adult, now)).toBe("adult");
  expect(interpretAliyun(result("1"), adult, now)).toEqual({ state: "adult", ageBand: "adult", reference: "synthetic-request" });
  expect(interpretAliyun(result("1"), syntheticId("20081015"), now).state).toBe("minor");
  for (const value of [{}, { Code: "200" }, result(1), result("3"), result("2"), { ...result("1"), Code: "InvalidAccessKeyId.NotFound" }, { ...result("1"), RequestId: undefined }]) {
    expect(interpretAliyun(value, adult, now).state).not.toBe("adult");
  }
  for (const id of [adult.slice(0, 17) + (adult[17] === "0" ? "1" : "0"), syntheticId("20000230"), syntheticId("20261015"), "000000200001010000"]) expect(interpretAliyun(result("1"), id, now).state).not.toBe("adult");
});
it("北京时间当天14和18岁边界，闰年日期均按完整生日计算", () => {
  expect(idAgeBand(syntheticId("20121014"), now)).toBe("14to17");
  expect(idAgeBand(syntheticId("20121015"), now)).toBe("under14");
  expect(idAgeBand(syntheticId("20081014"), new Date("2026-10-13T15:59:59Z"))).toBe("14to17");
  expect(idAgeBand(syntheticId("20080229"), new Date("2026-02-28T00:00:00Z"))).toBe("14to17");
  expect(idAgeBand(syntheticId("20080229"), new Date("2026-03-01T00:00:00Z"))).toBe("adult");
});
it("HTTPS POST正文调用固定阿里云接口，证件不进入URL，异常内容不回显", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(result("1"))); vi.stubGlobal("fetch", fetch);
  expect((await verifyAliyunAge({ name: "隔离测试", idCard: syntheticId("20000101") })).state).toBe("adult");
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://cloudauth.cn-shanghai.aliyuncs.com/");
  expect(options.method).toBe("POST"); expect(options.redirect).toBe("error");
  const body = new URLSearchParams(options.body);
  expect(body.get("Action")).toBe("Id2MetaVerify"); expect(body.get("IdentifyNum")).toBe(syntheticId("20000101"));
  expect(body.get("Signature")).toBeTruthy();
  fetch.mockRejectedValueOnce(new Error("private name, ID and credential"));
  expect(await verifyAliyunAge({ name: "隔离测试", idCard: syntheticId("20000101") })).toEqual({ state: "unavailable" });
});
it("配置未启用、证件无效或证件显示未满14岁时不调用供应商", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  expect((await verifyAliyunAge({ name: "隔离测试", idCard: syntheticId("20200101") })).state).toBe("needs_review");
  expect((await verifyAliyunAge({ name: "隔离测试", idCard: "invalid" })).state).toBe("failed");
  vi.stubEnv("HELLO_AGE_PROVIDER_APPROVED", "false");
  expect((await verifyAliyunAge({ name: "隔离测试", idCard: syntheticId("20000101") })).state).toBe("unavailable");
  expect(fetch).not.toHaveBeenCalled();
});
it("签名覆盖Unicode与特殊字符，STS令牌留在请求体内", () => {
  const body = new URLSearchParams(aliyunRequest({ name: "测试& +", idCard: "synthetic" }, "key", "secret", now, "nonce", "sts-token").body);
  expect(body.get("UserName")).toBe("测试& +"); expect(body.get("SecurityToken")).toBe("sts-token");
  expect(body.get("Timestamp")).toBe("2026-10-13T16:00:00Z");
  const other = new URLSearchParams(aliyunRequest({ name: "测试& +", idCard: "changed" }, "key", "secret", now, "nonce", "sts-token").body);
  expect(other.get("Signature")).not.toBe(body.get("Signature"));
});
