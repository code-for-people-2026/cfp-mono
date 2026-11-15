import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatformSpeechDriver } from "../src/chat/speech-platform";

const taro = vi.hoisted(() => ({ authorize: vi.fn(), requirePlugin: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: taro }));
beforeEach(() => {
  vi.stubEnv("TARO_ENV", "weapp");
  vi.stubGlobal("HELLO_WECHAT_SI_ENABLED", true);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const callbacks = () => ({
  started: vi.fn(),
  finished: vi.fn(),
  failed: vi.fn(),
});
function manager() {
  const value = {
    start: vi.fn(),
    stop: vi.fn(),
    onStart: () => {},
    onStop: (_value: { result: string }) => {},
    onError: () => {},
  };
  taro.requirePlugin.mockReturnValue({
    getRecordRecognitionManager: () => value,
  });
  return value;
}
describe("微信语音适配", () => {
  it("切换输入方式后仍等待全局录音结束，避免旧结果混入新录音", async () => {
    const recognition = manager();
    taro.authorize.mockResolvedValue({});
    const first = createPlatformSpeechDriver();
    first.start(callbacks());
    await vi.waitFor(() => expect(recognition.start).toHaveBeenCalledOnce());
    recognition.onStart();
    first.dispose();
    const second = createPlatformSpeechDriver();
    expect(() => second.start(callbacks())).toThrow("上一段录音仍在结束");
    recognition.onStop({ result: "已取消" });
    second.start(callbacks());
    await vi.waitFor(() => expect(recognition.start).toHaveBeenCalledTimes(2));
    recognition.onStop({ result: "新文字" });
    second.dispose();
  });
  it("未开通插件时明确拒绝，不触发授权或录音", () => {
    vi.stubGlobal("HELLO_WECHAT_SI_ENABLED", false);
    expect(() => createPlatformSpeechDriver().start(callbacks())).toThrow(
      "尚未开通",
    );
    expect(taro.authorize).not.toHaveBeenCalled();
    expect(taro.requirePlugin).not.toHaveBeenCalled();
  });
  it("授权成功才录音，识别完成只传文字，不读取或上传录音文件", async () => {
    const recognition = manager();
    taro.authorize.mockResolvedValue({});
    const events = callbacks();
    const driver = createPlatformSpeechDriver();
    driver.start(events);
    await vi.waitFor(() =>
      expect(recognition.start).toHaveBeenCalledWith({
        lang: "zh_CN",
        duration: 60_000,
      }),
    );
    recognition.onStart();
    recognition.onStop({ result: "今天很开心" });
    expect(events.started).toHaveBeenCalledOnce();
    expect(events.finished).toHaveBeenCalledWith("今天很开心");
    driver.dispose();
  });
  it("授权拒绝不启动，授权等待中退出页面也不启动", async () => {
    const recognition = manager();
    taro.authorize.mockRejectedValue(new Error("拒绝"));
    const events = callbacks();
    createPlatformSpeechDriver().start(events);
    await vi.waitFor(() =>
      expect(events.failed).toHaveBeenCalledWith(
        expect.stringContaining("权限"),
      ),
    );
    expect(recognition.start).not.toHaveBeenCalled();
    let allow: (() => void) | undefined;
    taro.authorize.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          allow = resolve;
        }),
    );
    const driver = createPlatformSpeechDriver();
    driver.start(callbacks());
    driver.dispose();
    allow!();
    await Promise.resolve();
    expect(recognition.start).not.toHaveBeenCalled();
  });
});
describe("H5 语音适配", () => {
  it("不支持的浏览器明确回退键盘", () => {
    vi.stubEnv("TARO_ENV", "h5");
    vi.stubGlobal("window", {});
    expect(() => createPlatformSpeechDriver().start(callbacks())).toThrow(
      "不支持语音",
    );
  });
  it("使用浏览器识别，累积多段文字，结束后清理回调和麦克风", () => {
    vi.stubEnv("TARO_ENV", "h5");
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onresult:
        | ((event: { results: { transcript: string }[][] }) => void)
        | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
    }
    const recognition = new Recognition();
    const Constructor = vi.fn(() => recognition);
    vi.stubGlobal("window", {
      webkitSpeechRecognition: Constructor,
      isSecureContext: true,
    });
    const driver = createPlatformSpeechDriver();
    const events = callbacks();
    driver.start(events);
    expect(recognition.lang).toBe("zh-CN");
    recognition.onstart?.();
    recognition.onresult?.({
      results: [[{ transcript: "今天" }], [{ transcript: "很开心" }]],
    });
    expect(events.finished).not.toHaveBeenCalled();
    driver.stop();
    recognition.onend?.();
    expect(events.finished).toHaveBeenCalledWith("今天很开心");
    driver.dispose();
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
  });
});
