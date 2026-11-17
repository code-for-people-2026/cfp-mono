import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), chooseImage: vi.fn(), downloadFile: vi.fn(), shareFileMessage: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: mocks }));
afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("网络响应不能靠泛型强信任", () => {
  it.each(["h5", "weapp"])("%s 不能从旧调用入口发送密钥、签发外部令牌或以外部模式整理记忆", async (environment) => {
    vi.stubEnv("TARO_ENV", environment);
    vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
    const api = await import("../src/chat/api");
    await expect(api.generate(1, crypto.randomUUID(), "byok", { text: "测试", mediaIds: [] }, "test-key-only")).rejects.toThrow(/仅开放平台/);
    await expect(api.generate(1, crypto.randomUUID(), "platform", { text: "测试", mediaIds: [] }, "test-key-only")).rejects.toThrow(/仅开放平台/);
    expect(() => api.compactMemory(1, crypto.randomUUID(), "external")).toThrow(/仅开放平台/);
    expect(() => api.compactPreview(1, crypto.randomUUID(), 1, "byok", "test-key-only")).toThrow(/仅开放平台/);
    expect(() => api.resumeImage(1, crypto.randomUUID(), "test-key-only")).toThrow(/仅开放平台/);
    await expect(api.mintMcpToken()).rejects.toThrow(/仅开放平台/);
    expect(mocks.request).not.toHaveBeenCalled();
  });
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

describe("AJ 表单引用", () => {
  it("新客户的展示引用与本次 controller requestId 一起发送", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
    const id = "13b11c49-812c-4193-9b10-530d8ae94d09";
    const presentation = {
      presentationId: "urn:cfp:a-j-oker:turn:3",
      revision: 1,
      formId: "thought_record",
    };
    const input = {
      text: "提交练习表单",
      mediaIds: [],
      formResponse: {
        turnId: 3,
        artifactId: "thought_record",
        values: { intensity: 0 },
        presentation,
      },
    };
    const turn = {
      id: 4,
      input,
      status: "completed",
      mode: "platform",
      greeting: "已接着回应",
      createdAt: "2026-11-13",
    };
    mocks.request.mockImplementation(async ({ url }) => ({
      statusCode: 200,
      data: url.endsWith("/ag-ui")
        ? [
            { type: "RUN_STARTED", runId: id },
            { type: "RUN_FINISHED", runId: id },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("")
        : { turn },
    }));
    const api = await import("../src/chat/api");

    await expect(api.generate(1, id, "platform", input)).resolves.toEqual(turn);

    const run = mocks.request.mock.calls.find(([options]) =>
      options.url.endsWith("/ag-ui"),
    )?.[0];
    expect(run.data.forwardedProps.clientEvent.action.context.submission).toEqual({
      requestId: id,
      ...presentation,
    });
  });

  it("过期引用不会被改成 revision 1 后发出", async () => {
    vi.stubEnv("TARO_ENV", "weapp");
    vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
    const api = await import("../src/chat/api");

    await expect(
      api.generate(1, "13b11c49-812c-4193-9b10-530d8ae94d09", "platform", {
        text: "提交过期表单",
        mediaIds: [],
        formResponse: {
          turnId: 3,
          artifactId: "thought_record",
          values: { intensity: 0 },
          presentation: {
            presentationId: "urn:cfp:a-j-oker:turn:3",
            revision: 2,
            formId: "thought_record",
          },
        },
      }),
    ).rejects.toThrow(/版本不匹配/);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

it.each([[413, "申请完整副本"], [429, "一分钟后"], [401, "设备凭证无效"], [500, "稍后重试"]])("微信导出失败 %s 不分享错误文件，并解释可恢复的原因", async (statusCode, message) => {
  vi.stubEnv("TARO_ENV", "weapp");
  vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
  mocks.downloadFile.mockResolvedValue({ statusCode, tempFilePath: "error-response.json" });
  const api = await import("../src/chat/api");
  await expect(api.exportPersonalData()).rejects.toThrow(String(message));
  expect(mocks.shareFileMessage).not.toHaveBeenCalled();
});
