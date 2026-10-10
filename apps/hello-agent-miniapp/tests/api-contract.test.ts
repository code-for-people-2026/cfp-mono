import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), chooseImage: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: mocks }));
afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("网络响应不能靠泛型强信任", () => {
  it.each(["camera", "album"] as const)(
    "图片入口 %s 只请求用户选择的来源，取消不上传",
    async (source) => {
      vi.stubEnv("TARO_ENV", "weapp");
      vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
      mocks.chooseImage.mockRejectedValue({
        errMsg: "chooseImage:fail cancel",
      });
      const api = await import("../src/chat/api");
      await expect(api.addImage(source)).rejects.toEqual({
        errMsg: "chooseImage:fail cancel",
      });
      expect(mocks.chooseImage).toHaveBeenCalledWith({
        count: 1,
        sizeType: ["compressed"],
        sourceType: [source],
      });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("微信禁用动态函数时仍能解析合法配置和嵌套字段", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
    const api = await import("../src/chat/api");
    // 微信的 Function 构造器不一定抛错，也可能返回不可调用的对象。
    vi.stubGlobal("Function", function WechatFunction() {});
    const config = {
      platformConfigured: true,
      model: "deepseek-flash",
      origin: "https://example.test",
      advertisement: { mode: "disabled", adUnitId: "", demoSeconds: 5 },
    };
    mocks.request.mockResolvedValue({ statusCode: 200, data: config });
    await expect(api.getSettings()).resolves.toEqual(config);
  });
  it("微信禁用动态函数时仍能拦截错误数据并读取安全错误消息", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
    const api = await import("../src/chat/api");
    vi.stubGlobal("Function", function WechatFunction() {});
    mocks.request.mockResolvedValue({
      statusCode: 200,
      data: [{ id: "1", title: "错误编号" }],
    });
    await expect(api.getSessions()).rejects.toThrow("数据格式不符合约定");
    mocks.request.mockResolvedValue({
      statusCode: 503,
      data: { error: "服务暂时不可用，请稍后重试" },
    });
    await expect(api.getSettings()).rejects.toThrow("服务暂时不可用");
  });
  it("拒绝 200 响应中的错误字段类型", async () => {
    vi.stubEnv("TARO_ENV", "h5");
    mocks.request.mockResolvedValue({
      statusCode: 200,
      data: [{ id: "1", title: "错误编号" }],
    });
    const api = await import("../src/chat/api");
    await expect(api.getSessions()).rejects.toThrow("数据格式不符合约定");
  });
  it("解析后的正常响应只保留已声明字段", async () => {
    vi.stubEnv("TARO_ENV", "h5");
    mocks.request.mockResolvedValue({
      statusCode: 200,
      data: [{ id: 1, title: "日常", owner: "internal" }],
    });
    const api = await import("../src/chat/api");
    expect(await api.getSessions()).toEqual([{ id: 1, title: "日常" }]);
  });
  it("错误响应结构异常时给出安全提示", async () => {
    vi.stubEnv("TARO_ENV", "h5");
    mocks.request.mockResolvedValue({
      statusCode: 500,
      data: { error: { internal: "不要展示" } },
    });
    const api = await import("../src/chat/api");
    await expect(api.getSessions()).rejects.toThrow("暂时连接不上");
  });
});
