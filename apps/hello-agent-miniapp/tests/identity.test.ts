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
  it("H5 身份过期后需要明确恢复，普通重试不能静默换身份", async () => {
    vi.stubEnv("TARO_ENV", "h5");
    mocks.request.mockResolvedValueOnce({
      statusCode: 200,
      data: { owner: "old-owner" },
    });
    const api = await import("../src/chat/api");
    await api.establishIdentity();
    mocks.request.mockResolvedValueOnce({ statusCode: 401, data: {} });
    await expect(api.getSessions()).rejects.toBeInstanceOf(api.IdentityExpiredError);
    await api.establishIdentity();
    expect(mocks.request).toHaveBeenCalledTimes(2);

    mocks.request.mockResolvedValueOnce({
      statusCode: 503,
      data: { error: "暂不能建立身份" },
    });
    await expect(api.restartIdentity()).rejects.toThrow("暂不能建立身份");
    await api.establishIdentity();
    expect(mocks.request).toHaveBeenCalledTimes(3);

    mocks.request.mockResolvedValueOnce({ statusCode: 200, data: { owner: "new-owner" } });
    await api.restartIdentity();
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({
      url: "/api/hello/identity",
      method: "POST",
      header: { "Content-Type": "application/json" },
    }));
    await api.establishIdentity();
    expect(mocks.request).toHaveBeenCalledTimes(4);
    expect(mocks.setStorageSync).not.toHaveBeenCalled();
    mocks.request.mockResolvedValueOnce({ statusCode: 200, data: [] });
    await expect(api.getSessions()).resolves.toEqual([]);
  });
  it("重新建立身份失败时不覆盖原凭证，也不静默丢弃原身份", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "https://preview.example.test");
    mocks.getStorageSync.mockReturnValue("old-device-token");
    mocks.request.mockImplementation(
      async (options: { url: string; header: { Authorization?: string } }) => {
        if (options.url.endsWith("/miniapp-identity"))
          return { statusCode: 503, data: { error: "暂不能建立身份" } };
        expect(options.header.Authorization).toBe("Bearer old-device-token");
        return { statusCode: 401, data: { error: "过期" } };
      },
    );
    const api = await import("../src/chat/api");
    await api.establishIdentity();
    await expect(api.restartIdentity()).rejects.toThrow("暂不能建立身份");
    expect(mocks.setStorageSync).not.toHaveBeenCalled();
    await expect(api.getSessions()).rejects.toBeInstanceOf(
      api.IdentityExpiredError,
    );
  });
  it("远程环境不会复用旧的本机凭证", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "https://preview.example.test");
    mocks.getStorageSync.mockImplementation((key) =>
      key === "hello-miniapp-identity" ? "local-token" : "",
    );
    mocks.request.mockResolvedValue({
      statusCode: 200,
      data: { token: "remote-token", expiresAt: "2026-11-03T00:00:00Z" },
    });
    const { establishIdentity } = await import("../src/chat/api");
    await establishIdentity();
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://preview.example.test/api/hello/miniapp-identity",
        header: { "Content-Type": "application/json" },
      }),
    );
    expect(mocks.setStorageSync).toHaveBeenCalledWith(
      "hello-miniapp-identity:https://preview.example.test",
      "remote-token",
    );
  });

  it("本机升级保留原先的聊天身份", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "http://127.0.0.1:3310");
    mocks.getStorageSync.mockImplementation((key) =>
      key === "hello-miniapp-identity" ? "local-token" : "",
    );
    const { establishIdentity } = await import("../src/chat/api");
    await establishIdentity();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.setStorageSync).toHaveBeenCalledWith(
      "hello-miniapp-identity:http://127.0.0.1:3310",
      "local-token",
    );
  });
});
