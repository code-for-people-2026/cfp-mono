import { afterEach, describe, expect, it, vi } from "vitest";
import { getWechatSpeechPlugin } from "../config/speech";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("微信语音构建配置", () => {
  it("默认固定用户已授权的插件版本", () => {
    vi.stubEnv("HELLO_WECHAT_SI_VERSION", "");
    delete process.env.HELLO_WECHAT_SI_VERSION;
    expect(getWechatSpeechPlugin()).toEqual({
      version: "0.3.10",
      provider: "wx069ba97219f66d99",
    });
  });
  it("环境变量可以明确禁用插件", () => {
    vi.stubEnv("HELLO_WECHAT_SI_VERSION", "");
    expect(getWechatSpeechPlugin()).toBeUndefined();
  });
  it("允许显式选择其他已经授权的版本", () => {
    vi.stubEnv("HELLO_WECHAT_SI_VERSION", "0.3.9");
    expect(getWechatSpeechPlugin()?.version).toBe("0.3.9");
  });
  it("应用声明真实插件，不把录音运行时授权误写成配置权限", async () => {
    vi.stubEnv("HELLO_WECHAT_SI_VERSION", "0.3.10");
    vi.stubGlobal("defineAppConfig", (config: unknown) => config);
    const { default: config } = await import("../src/app.config");
    expect(config.plugins?.WechatSI).toEqual(getWechatSpeechPlugin());
    expect(config.permission ?? {}).not.toHaveProperty("scope.record");
  });
});
