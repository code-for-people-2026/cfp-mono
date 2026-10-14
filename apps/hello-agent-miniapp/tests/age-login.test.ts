import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ request: vi.fn(), getStorageSync: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn(), requirePrivacyAuthorize: vi.fn(), login: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: calls }));
beforeEach(() => { vi.resetModules(); Object.values(calls).forEach((fn) => fn.mockReset()); vi.stubEnv("TARO_ENV", "weapp"); vi.stubGlobal("HELLO_API_ORIGIN", "http://127.0.0.1:3347"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("统一登录与年龄引导的请求边界", () => {
  it("打开仅恢复访客状态，不静默调用微信登录或提交证件", async () => {
    calls.request.mockResolvedValue({ statusCode: 200, data: { token: "visitor", expiresAt: "2026-11-01T00:00:00Z" } });
    const api = await import("../src/chat/api"); await api.establishIdentity();
    expect(calls.login).not.toHaveBeenCalled(); expect(calls.requirePrivacyAuthorize).not.toHaveBeenCalled();
    expect(calls.request).toHaveBeenCalledTimes(1);
    expect(calls.request.mock.calls[0][0].url).toContain("miniapp-identity");
  });
  it("拒绝平台隐私授权时不取code也不发起微信交换", async () => {
    calls.requirePrivacyAuthorize.mockImplementation(({ fail }) => fail());
    const api = await import("../src/chat/api");
    await expect(api.loginWechat(false, "notice-test")).rejects.toThrow("取消或拒绝");
    expect(calls.login).not.toHaveBeenCalled(); expect(calls.request).not.toHaveBeenCalled();
  });
  it("明确操作后先平台授权再wx.login，只交换code与绑定选择", async () => {
    const sequence: string[] = [];
    calls.requirePrivacyAuthorize.mockImplementation(({ success }) => { sequence.push("privacy"); success(); });
    calls.login.mockImplementation(async () => { sequence.push("login"); return { code: "one-use-code" }; });
    calls.request.mockImplementation(async () => { sequence.push("exchange"); return { statusCode: 200, data: { token: "verified-wechat-token", history: "kept", owner: "wechat-owner", expiresAt: "2026-11-01T00:00:00Z" } }; });
    const api = await import("../src/chat/api"); await api.loginWechat(true, "notice-test");
    expect(sequence).toEqual(["privacy", "login", "exchange"]);
    expect(calls.request.mock.calls[0][0].data).toEqual({ code: "one-use-code", consent: true, noticeVersion: "notice-test", migrateCurrent: true });
    expect(calls.setStorageSync).toHaveBeenCalledWith("hello-miniapp-identity:http://127.0.0.1:3347", "verified-wechat-token");
  });
  it("恢复已有凭证时不自动替换身份，也不调用微信登录", async () => {
    calls.getStorageSync.mockReturnValue("existing-token");
    const api = await import("../src/chat/api"); await api.establishIdentity();
    expect(calls.request).not.toHaveBeenCalled();
    expect(calls.login).not.toHaveBeenCalled();
    expect(calls.setStorageSync).not.toHaveBeenCalled();
  });
  it("身份证提交后不写本地storage，只有显式submit携带敏感字段", async () => {
    calls.request.mockResolvedValue({ statusCode: 200, data: { loggedIn: true, state: "unknown", allowed: false, verifiedAt: null, expiresAt: null, source: null, assurance: null, additionalVerification: "not_requested", notice: { version: "test", paragraphs: [] }, configuration: { wechat: true, provider: true } } });
    const api = await import("../src/chat/api");
    await api.submitAge({ challenge: "synthetic-challenge", name: "合成", idCard: "000000200001010000" });
    expect(calls.setStorageSync).not.toHaveBeenCalled();
    expect(calls.request.mock.calls[0][0].url).toContain("age/submit");
  });
  it("H5不调用微信接口", async () => {
    vi.stubEnv("TARO_ENV", "h5"); const api = await import("../src/chat/api");
    await expect(api.loginWechat(false, "notice-test")).rejects.toThrow("微信小程序");
    expect(calls.request).not.toHaveBeenCalled();
  });
});
