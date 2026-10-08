import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "../src/chat/model";

const platform = vi.hoisted(() => ({
  request: vi.fn(),
  downloadFile: vi.fn(),
  getStorageSync: vi.fn(() => "fixture-device-token"),
  setStorageSync: vi.fn(),
  showModal: vi.fn(),
  nextTick: vi.fn((fn: () => void) => fn()),
  onAppHide: vi.fn(),
  offAppHide: vi.fn(),
  authorize: vi.fn(),
  requirePlugin: vi.fn(),
}));
// 仅替换平台组件与网络边界；渲染真实聊天页、真实 api 和记忆组件。
vi.mock("@tarojs/taro", () => ({ default: platform }));
vi.mock("@tarojs/components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Input: "input",
  Textarea: "textarea",
  ScrollView: "scroll-view",
}));

let renderer: ReactTestRenderer | undefined;
let history: Turn[];
const initial: Turn = {
  id: 1,
  input: { text: "已经保存的日常", mediaIds: [1] },
  status: "completed",
  mode: "platform",
  greeting: "仍能看见的好彩头",
  model: "test-model",
  createdAt: "2026-10-02T00:00:00.000Z",
};
const advertisement = { mode: "disabled", adUnitId: "", demoSeconds: 5 };

beforeEach(() => {
  vi.stubEnv("TARO_ENV", "weapp");
  vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
  vi.stubGlobal("HELLO_WECHAT_SI_ENABLED", false);
  history = [structuredClone(initial)];
  platform.request.mockImplementation(async ({ url }: { url: string }) => {
    const route = url.split("/api/hello/")[1];
    const data =
      route === "config"
        ? {
            platformConfigured: true,
            model: "test-model",
            origin: "https://example.test",
            advertisement,
          }
        : route === "identity"
          ? { owner: "fixture-owner" }
          : route === "sessions"
            ? [{ id: 1, title: "日常" }]
            : route === "sessions/1"
              ? history
              : route === "context/1"
                ? {
                    usedTokens: 100,
                    budgetTokens: 18000,
                    remainingPercent: 87,
                    level: "healthy",
                    canCompact: false,
                    candidateCount: 0,
                    recentTurns: 1,
                    compressions: 0,
                    summary: "",
                    rewardReady: false,
                    advertisement,
                  }
                : null;
    if (!data) throw new Error(`未配置的测试请求 ${route}`);
    return { statusCode: 200, data };
  });
  platform.downloadFile.mockResolvedValue({
    statusCode: 503,
    tempFilePath: "",
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function mount(keyboard = true) {
  const { default: Chat } = await import("../src/pages/chat/index");
  await act(async () => {
    renderer = create(createElement(Chat));
  });
  // 首屏默认语音；本组原有恢复用例从用户点击键盘开始。
  if (keyboard)
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("keyboard-toggle"))!
        .props.onClick(),
    );
}
const text = () => JSON.stringify(renderer?.toJSON());

describe("聊天历史与图片失败隔离", () => {
  it("首页恢复三条快捷建议，点击后切到键盘填入草稿但不自动发送", async () => {
    history = [];
    await mount(false);
    const suggestions = renderer!.root
      .findAllByType("button")
      .filter((button) =>
        button.props.className.split(" ").includes("suggestion"),
      );
    expect(suggestions).toHaveLength(3);
    expect(text()).toContain("窗台上的小番茄红了");
    expect(text()).toContain("明天要开始一份新工作");
    expect(text()).toContain("最近有些累，想慢一点");
    act(() => suggestions[2].props.onClick());
    expect(renderer!.root.findByType("textarea").props.value).toBe(
      "最近有些累，想慢一点",
    );
    expect(
      platform.request.mock.calls.some(([options]) =>
        options.url.endsWith("/greet"),
      ),
    ).toBe(false);
  });
  it("欢迎词和静态界面中的中文与英文字母之间保留空格", async () => {
    history = [];
    await mount(false);
    expect(text()).toContain("我是阿 J");
    expect(text()).toContain("阿 Q 先生");
    expect(text()).not.toMatch(
      /[\p{Script=Han}][A-Za-z]|[A-Za-z][\p{Script=Han}]/u,
    );
  });
  it("语音识别结果追加到原草稿，必须确认后才提交给后端", async () => {
    vi.stubGlobal("HELLO_WECHAT_SI_ENABLED", true);
    const recognition = {
      start: vi.fn(),
      stop: vi.fn(),
      onStart: () => {},
      onStop: (_result: { result: string }) => {},
      onError: () => {},
    };
    platform.authorize.mockResolvedValue({});
    platform.requirePlugin.mockReturnValue({
      getRecordRecognitionManager: () => recognition,
    });
    await mount();
    act(() =>
      renderer!.root
        .findByType("textarea")
        .props.onInput({ detail: { value: "原来的草稿" } }),
    );
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("voice-toggle"))!
        .props.onClick(),
    );
    const hold = () =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("voice-hold"))!;
    await act(async () => {
      hold().props.onTouchStart();
    });
    expect(recognition.start).toHaveBeenCalledOnce();
    act(() => recognition.onStart());
    act(() => hold().props.onTouchEnd());
    act(() => recognition.onStop({ result: "今天想慢一点" }));
    expect(renderer!.root.findByType("textarea").props.value).toBe(
      "原来的草稿\n今天想慢一点",
    );
    expect(
      platform.request.mock.calls.some(([options]) =>
        options.url.endsWith("/greet"),
      ),
    ).toBe(false);
  });
  it("首屏展示阿 J 和欢迎词，默认语音，键盘来回切换保留草稿", async () => {
    history = [];
    await mount(false);
    expect(text()).toContain("嗨，我是阿 J");
    expect(text()).toContain("不自欺，不欺软怕硬");
    expect(text()).toContain("按住说话");
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    expect(text()).not.toContain("mode-chip");
    expect(text()).not.toContain("memory-track");
    const click = (name: string) =>
      act(() =>
        renderer!.root
          .findAllByType("button")
          .find((button) => button.props.className.includes(name))!
          .props.onClick(),
      );
    click("keyboard-toggle");
    act(() =>
      renderer!.root
        .findByType("textarea")
        .props.onInput({ detail: { value: "留着这句烦心事" } }),
    );
    click("voice-toggle");
    expect(text()).toContain("有未发送的文字");
    click("keyboard-toggle");
    expect(renderer!.root.findByType("textarea").props.value).toBe(
      "留着这句烦心事",
    );
  });
  it("语音未开通时显示真实原因，键盘仍可用，不发请求生成", async () => {
    vi.stubGlobal("HELLO_WECHAT_SI_ENABLED", false);
    await mount(false);
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("voice-hold"))!
        .props.onTouchStart(),
    );
    expect(text()).toContain("小程序语音尚未开通");
    expect(
      platform.request.mock.calls.some(([options]) =>
        options.url.endsWith("/greet"),
      ),
    ).toBe(false);
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("keyboard-toggle"))!
        .props.onClick(),
    );
    expect(renderer!.root.findByType("textarea").props.disabled).toBe(false);
  });
  it("服务端仍在处理时只查状态，不启动第二次生成", async () => {
    const originalRequest = platform.request.getMockImplementation()!;
    platform.request.mockImplementation(
      async (options: { url: string; data?: { input: Turn["input"] } }) => {
        if (options.url.endsWith("/greet")) {
          history.push({
            ...initial,
            id: 2,
            input: options.data!.input,
            status: "running",
            greeting: null,
          });
          throw new Error("等待回复超时");
        }
        if (options.url.includes("/requests/"))
          return { statusCode: 200, data: { turn: history.at(-1) } };
        return originalRequest(options);
      },
    );
    await mount();
    act(() =>
      renderer!.root
        .findByType("textarea")
        .props.onInput({ detail: { value: "还在处理的一次提交" } }),
    );
    const send = () =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("send-button"))!;
    await act(async () => {
      await send().props.onClick();
    });
    await act(async () => {
      await send().props.onClick();
    });
    expect(text()).toContain("上次提交仍在处理");
    expect(
      platform.request.mock.calls.filter(([options]) =>
        options.url.endsWith("/greet"),
      ),
    ).toHaveLength(1);
  });
  it("BYOK 响应丢失后可不重填密钥，只查询上次结果", async () => {
    const originalRequest = platform.request.getMockImplementation()!;
    let checks = 0;
    platform.request.mockImplementation(
      async (options: { url: string; data?: { input: Turn["input"] } }) => {
        if (options.url.endsWith("/greet")) {
          history.push({
            ...initial,
            id: 2,
            input: options.data!.input,
            mode: "byok",
            greeting: "自带密钥生成过的回复",
          });
          throw new Error("成功响应丢失");
        }
        if (options.url.includes("/requests/")) {
          if (++checks === 1) throw new Error("查询暂时断网");
          return { statusCode: 200, data: { turn: history.at(-1) } };
        }
        return originalRequest(options);
      },
    );
    await mount();
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("设置"))!
        .props.onClick(),
    );
    act(() =>
      renderer!.root
        .findAllByType("button")
        .filter((button) => button.props.className.includes("mode-option"))[1]
        .props.onClick(),
    );
    act(() => {
      renderer!.root
        .findByType("input")
        .props.onInput({ detail: { value: "fixture-key-not-real" } });
      renderer!.root
        .findByType("textarea")
        .props.onInput({ detail: { value: "仅确认已生成的回复" } });
    });
    await act(async () => {
      await renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("send-button"))!
        .props.onClick();
    });
    expect(renderer!.root.findByType("input").props.value).toBe("");
    const check = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.className.includes("check-submission"));
    expect(check).toBeDefined();
    await act(async () => {
      await check!.props.onClick();
    });
    expect(renderer!.root.findByType("textarea").props.value).toBe("");
    expect(
      platform.request.mock.calls.filter(([options]) =>
        options.url.endsWith("/greet"),
      ),
    ).toHaveLength(1);
  });
  it.each([false, true])(
    "响应与查询均断网后重试，已保存=%s 时不重复产生回复",
    async (savedOnServer) => {
      const originalRequest = platform.request.getMockImplementation()!;
      const ids: string[] = [];
      let statusChecks = 0;
      platform.request.mockImplementation(
        async (options: {
          url: string;
          data?: { requestId: string; input: Turn["input"] };
        }) => {
          if (options.url.includes("/requests/")) {
            if (++statusChecks === 1) throw new Error("状态查询也断网");
            return {
              statusCode: 200,
              data: { turn: savedOnServer ? history.at(-1) : null },
            };
          }
          if (options.url.endsWith("/greet")) {
            const args = options.data!;
            ids.push(args.requestId);
            if (ids.length === 1 && !savedOnServer)
              throw new Error("请求尚未送达");
            const row = {
              ...initial,
              id: 2,
              input: args.input,
              greeting: "只保存一份的回复",
            };
            history.push(row);
            if (ids.length === 1) throw new Error("成功响应丢失");
            return { statusCode: 200, data: row };
          }
          return originalRequest(options);
        },
      );
      await mount();
      act(() =>
        renderer!.root
          .findByType("textarea")
          .props.onInput({ detail: { value: "网络重试不是新消息" } }),
      );
      const send = () =>
        renderer!.root
          .findAllByType("button")
          .find((button) => button.props.className.includes("send-button"))!;
      await act(async () => {
        await send().props.onClick();
      });
      expect(renderer!.root.findByType("textarea").props.value).toBe(
        "网络重试不是新消息",
      );
      await act(async () => {
        await send().props.onClick();
      });
      expect(new Set(ids).size).toBe(1);
      expect(ids).toHaveLength(savedOnServer ? 1 : 2);
      expect(
        history.filter((row) => row.input.text === "网络重试不是新消息"),
      ).toHaveLength(1);
      expect(renderer!.root.findByType("textarea").props.value).toBe("");
    },
  );
  it("广告禁用的测试版仍可明确免费整理记忆，不发广告请求", async () => {
    const originalRequest = platform.request.getMockImplementation()!;
    platform.request.mockImplementation(async (options: { url: string }) => {
      if (
        options.url.endsWith("/context/1") ||
        options.url.endsWith("/context/preview-compact")
      ) {
        const compacted = options.url.endsWith("/preview-compact");
        return {
          statusCode: 200,
          data: {
            usedTokens: compacted ? 1000 : 22000,
            budgetTokens: 18000,
            remainingPercent: compacted ? 90 : 0,
            level: compacted ? "healthy" : "empty",
            canCompact: !compacted,
            candidateCount: compacted ? 0 : 1,
            recentTurns: 2,
            compressions: compacted ? 1 : 0,
            summary: compacted ? "测试摘要" : "",
            rewardReady: false,
            recoveryMode: "preview",
            advertisement,
          },
        };
      }
      return originalRequest(options);
    });
    await mount();
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("memory-shortcut"))!
        .props.onClick(),
    );
    const recover = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.className.includes("memory-recover"))!;
    expect(recover.props.disabled).not.toBe(true);
    expect(text()).toContain("测试版免费整理");
    await act(async () => {
      await recover.props.onClick();
    });
    expect(text()).toContain("记忆已整理");
    expect(text()).toContain("仍能看见的好彩头");
    expect(
      platform.request.mock.calls.filter(
        ([options]) =>
          options.url.includes("ad-start") ||
          options.url.includes("ad-complete"),
      ),
    ).toHaveLength(0);
    expect(
      platform.request.mock.calls.filter(([options]) =>
        options.url.endsWith("/preview-compact"),
      ),
    ).toHaveLength(1);
  });
  it("设备凭证过期时不静默换身份，取消保留现场，确认后才能重新开始", async () => {
    const originalRequest = platform.request.getMockImplementation()!;
    let renewed = false;
    platform.request.mockImplementation(
      async (options: { url: string; header: { Authorization?: string } }) => {
        if (options.url.endsWith("/miniapp-identity")) {
          expect(options.header.Authorization).toBeUndefined();
          renewed = true;
          return {
            statusCode: 200,
            data: {
              token: "new-device-token",
              expiresAt: "2026-11-03T00:00:00Z",
            },
          };
        }
        if (options.url.endsWith("/sessions")) {
          if (!renewed)
            return { statusCode: 401, data: { error: "连接凭证无效或已过期" } };
          expect(options.header.Authorization).toBe("Bearer new-device-token");
          return { statusCode: 200, data: [] };
        }
        return originalRequest(options);
      },
    );
    await mount();
    expect(renewed).toBe(false);
    expect(text()).toContain("旧聊天记录不会删除");
    const restart = () =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("restart-identity"))!;
    platform.showModal.mockResolvedValueOnce({ confirm: false, cancel: true });
    await act(async () => {
      await restart().props.onClick();
    });
    expect(renewed).toBe(false);
    expect(platform.setStorageSync).not.toHaveBeenCalled();
    platform.showModal.mockResolvedValueOnce({ confirm: true, cancel: false });
    await act(async () => {
      await restart().props.onClick();
    });
    expect(renewed).toBe(true);
    expect(text()).not.toContain("旧聊天记录不会删除");
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props.className.includes("keyboard-toggle"))!
        .props.onClick(),
    );
    expect(renderer!.root.findByType("textarea").props.disabled).toBe(false);
  });
  it("保存成功但响应丢失时，确认原请求后不再把输入放回草稿", async () => {
    const originalRequest = platform.request.getMockImplementation()!;
    let submittedId = "";
    platform.request.mockImplementation(
      async (options: {
        url: string;
        data?: { requestId: string; input: Turn["input"] };
      }) => {
        if (options.url.endsWith("/greet")) {
          submittedId = options.data!.requestId;
          history.push({
            ...initial,
            id: 2,
            input: options.data!.input,
            greeting: "响应虽丢失但已经保存",
          });
          throw new Error("合成故障：保存后连接中断");
        }
        if (
          submittedId &&
          options.url.endsWith(`/sessions/1/requests/${submittedId}`)
        )
          return { statusCode: 200, data: { turn: history.at(-1) } };
        return originalRequest(options);
      },
    );
    await mount();
    act(() =>
      renderer!.root
        .findByType("textarea")
        .props.onInput({ detail: { value: "只发一次" } }),
    );
    const send = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.className.includes("send-button"))!;
    await act(async () => {
      await send.props.onClick();
    });
    expect(text()).toContain("响应虽丢失但已经保存");
    expect(renderer!.root.findByType("textarea").props.value).toBe("");
    expect(
      platform.request.mock.calls.filter(([options]) =>
        options.url.endsWith("/greet"),
      ),
    ).toHaveLength(1);
  });
  it("图片返回 503 时仍恢复文字产物和记忆血条", async () => {
    await mount();
    expect(text()).toContain("已经保存的日常");
    expect(text()).toContain("仍能看见的好彩头");
    expect(text()).toContain("图片暂不可用");
    expect(renderer!.root.findByType("textarea").props.disabled).toBe(false);
    act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("设置"))!
        .props.onClick(),
    );
    expect(text()).toContain("87");
  });
  it("多张历史图片慢速下载时可以先聊天，最多占用三个下载连接", async () => {
    history = [
      { ...initial, input: { ...initial.input, mediaIds: [1, 2, 3] } },
      { ...initial, id: 2, input: { text: "第二段日常", mediaIds: [4, 5, 6] } },
    ];
    let active = 0;
    let peak = 0;
    const pending: (() => void)[] = [];
    platform.downloadFile.mockImplementation(({ url }: { url: string }) => {
      active++;
      peak = Math.max(peak, active);
      return new Promise((resolve) =>
        pending.push(() => {
          active--;
          resolve({
            statusCode: url.endsWith("/1") ? 503 : 200,
            tempFilePath: `fixture://${url.split("/").pop()}`,
          });
        }),
      );
    });
    await mount();
    expect(text()).toContain("第二段日常");
    expect(renderer!.root.findByType("textarea").props.disabled).toBe(false);
    expect(peak).toBeLessThanOrEqual(3);
    while (pending.length) {
      await act(async () => {
        pending.splice(0).forEach((finish) => finish());
      });
    }
    expect(
      renderer!.root
        .findAllByType("image")
        .filter((image) => image.props.className === "message-image"),
    ).toHaveLength(5);
    expect(text()).toContain("图片暂不可用");
    expect(peak).toBeLessThanOrEqual(3);
  });
  it("回复已保存但历史刷新失败时，不把已发送输入放回草稿", async () => {
    const originalRequest = platform.request.getMockImplementation()!;
    let saved = false;
    platform.request.mockImplementation(async (options: { url: string }) => {
      if (options.url.endsWith("/greet")) {
        saved = true;
        return {
          statusCode: 200,
          data: {
            ...initial,
            id: 2,
            input: { text: "今天要加油", mediaIds: [] },
            greeting: "已经保存的新回复",
          },
        };
      }
      if (saved && options.url.endsWith("/sessions/1"))
        throw new Error("历史暂不可用");
      return originalRequest(options);
    });
    await mount();
    act(() =>
      renderer!.root
        .findByType("textarea")
        .props.onInput({ detail: { value: "今天要加油" } }),
    );
    const send = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.className.includes("send-button"))!;
    await act(async () => {
      await send.props.onClick();
    });
    expect(renderer!.root.findByType("textarea").props.value).toBe("");
    expect(text()).toContain("已经保存的新回复");
    expect(text()).toContain("回复已保存");
    expect(
      platform.request.mock.calls.filter(([options]) =>
        options.url.endsWith("/greet"),
      ),
    ).toHaveLength(1);
  });
  it("H5 图片加载失败也只替换该图的占位", async () => {
    vi.stubEnv("TARO_ENV", "h5");
    await mount();
    const image = renderer!.root
      .findAllByType("image")
      .find((item) => item.props.className === "message-image")!;
    expect(image.props.src).toBe("/api/hello/media/1");
    act(() => image.props.onError());
    expect(text()).toContain("仍能看见的好彩头");
    expect(text()).toContain("图片暂不可用");
    expect(platform.downloadFile).not.toHaveBeenCalled();
  });
  it("真正发送失败时仍保留原草稿，允许用户重试", async () => {
    const originalRequest = platform.request.getMockImplementation()!;
    platform.request.mockImplementation(async (options: { url: string }) =>
      options.url.endsWith("/greet")
        ? { statusCode: 503, data: { error: "生成暂不可用" } }
        : originalRequest(options),
    );
    await mount();
    act(() =>
      renderer!.root
        .findByType("textarea")
        .props.onInput({ detail: { value: "请保留草稿" } }),
    );
    const send = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.className.includes("send-button"))!;
    await act(async () => {
      await send.props.onClick();
    });
    expect(renderer!.root.findByType("textarea").props.value).toBe(
      "请保留草稿",
    );
    expect(text()).toContain("生成暂不可用");
  });
});
