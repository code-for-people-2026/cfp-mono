import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretTencent, tencentRequest, verifyTencentAge } from "./provider";
import { exchangeWechat } from "./wechat";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const result = (Result: unknown, AgeRange?: unknown) => ({ Response: { Result, AgeRange, RequestId: "synthetic-request-1" } });
describe("腾讯年龄结果严格映射", () => {
  it("仅明确成年且区间一致才允许成年状态", () => {
    expect(interpretTencent(result("0", "[18,+)" )).state).toBe("adult");
    for (const data of [result(0, "[18,+)"), result("0", "[16,18)"), result("0"), {}, { Response: { Result: "0", AgeRange: "[18,+)" } }]) expect(interpretTencent(data).state).not.toBe("adult");
  });
  it.each(["[0,8)", "[8,16)", "[16,18)"])("未成年区间 %s 不伪造14岁边界", (range) => expect(interpretTencent(result("-1", range)).state).toBe("minor"));
  it.each([["-2", "unknown"], ["-7", "unknown"], ["-3", "failed"], ["-4", "failed"], ["-5", "failed"], ["-6", "unavailable"], ["-8", "unavailable"], ["unrecognized", "unavailable"]])("%s 保持安全状态", (code, expected) => expect(interpretTencent(result(code)).state).toBe(expected));
  it("不回显供应商错误、描述或身份信息", () => {
    const output = interpretTencent({ Response: { Error: { Message: "synthetic secret identity" }, Description: "private data" } });
    expect(JSON.stringify(output)).not.toMatch(/secret|private/);
  });
  it("TC3签名固定官方操作与JSON字节，不使用手机号或Region", () => {
    const signed = tencentRequest({ name: "合成测试", idCard: "000000200001010000" }, "synthetic-id", "synthetic-key", Date.UTC(2026, 9, 13));
    expect(JSON.parse(signed.body)).toEqual({ Type: "1", Name: "合成测试", IdCard: "000000200001010000" });
    expect(signed.headers["X-TC-Action"]).toBe("MinorsVerification");
    expect(signed.headers.Authorization).toMatch(/^TC3-HMAC-SHA256 Credential=synthetic-id\/2026-10-13\/faceid\/tc3_request, SignedHeaders=content-type;host, Signature=[a-f0-9]{64}$/);
    expect(signed.headers).not.toHaveProperty("X-TC-Region");
  });
  it("未配置或未审核受托说明时不发出请求", async () => {
    vi.stubEnv("HELLO_AGE_PROVIDER_APPROVED", "false");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await verifyTencentAge({ name: "合成测试", idCard: "000000200001010000" })).state).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("网络异常不泄露供应商原始异常", async () => {
    for (const [key, value] of Object.entries({ HELLO_AGE_SECRET_ID: "fake", HELLO_AGE_SECRET_KEY: "fake", HELLO_AGE_PROVIDER_APPROVED: "true", HELLO_AGE_PROVIDER_DISCLOSURE: "合成说明" })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("name and ID and secret")));
    expect(await verifyTencentAge({ name: "合成测试", idCard: "000000200001010000" })).toEqual({ state: "unavailable" });
  });
});
describe("微信服务端交换", () => {
  it("缺配置不能登录", async () => {
    vi.stubEnv("HELLO_WECHAT_APP_SECRET", "");
    await expect(exchangeWechat("synthetic-code")).rejects.toThrow("尚未配置");
  });
  it("错误回包或网络异常不暴露code和secret", async () => {
    vi.stubEnv("HELLO_WECHAT_APP_ID", "synthetic-app"); vi.stubEnv("HELLO_WECHAT_APP_SECRET", "do-not-expose");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("do-not-expose")));
    await expect(exchangeWechat("synthetic-code")).rejects.toThrow("微信登录未完成");
  });
  it("只产生AppID范围内的OpenID摘要，不返回session_key", async () => {
    vi.stubEnv("HELLO_WECHAT_APP_ID", "synthetic-app"); vi.stubEnv("HELLO_WECHAT_APP_SECRET", "fake");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ openid: "synthetic-openid-01", session_key: "discard-me" })));
    expect(await exchangeWechat("synthetic-code")).toMatch(/^[a-f0-9]{64}$/);
  });
});
