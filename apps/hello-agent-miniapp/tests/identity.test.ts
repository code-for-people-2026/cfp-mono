import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({ default: mocks }));

afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("不同后端的设备身份隔离", () => {
  it("远程环境不会复用旧的本机凭证", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "https://preview.example.test");
    mocks.getStorageSync.mockImplementation((key) => key === "hello-miniapp-identity" ? "local-token" : "");
    mocks.request.mockResolvedValue({ statusCode: 200, data: { token: "remote-token" } });
    const { establishIdentity } = await import("../src/chat/api");
    await establishIdentity();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://preview.example.test/api/hello/miniapp-identity",
      header: { "Content-Type": "application/json" },
    }));
    expect(mocks.setStorageSync).toHaveBeenCalledWith("hello-miniapp-identity:https://preview.example.test", "remote-token");
  });

  it("本机升级保留原先的聊天身份", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "http://127.0.0.1:3310");
    mocks.getStorageSync.mockImplementation((key) => key === "hello-miniapp-identity" ? "local-token" : "");
    const { establishIdentity } = await import("../src/chat/api");
    await establishIdentity();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.setStorageSync).toHaveBeenCalledWith("hello-miniapp-identity:http://127.0.0.1:3310", "local-token");
  });
});
