import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "../src/chat/model";

const platform = vi.hoisted(() => ({
  request: vi.fn(),
  downloadFile: vi.fn(),
  getStorageSync: vi.fn(() => "fixture-device-token"),
  nextTick: vi.fn((fn: () => void) => fn()),
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
  history = [structuredClone(initial)];
  platform.request.mockImplementation(async ({ url }: { url: string }) => {
    const route = url.split("/api/hello/")[1];
    const data =
      route === "config"
        ? { platformConfigured: true, model: "test-model", advertisement }
        : route === "identity"
          ? {}
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
async function mount() {
  const { default: Chat } = await import("../src/pages/chat/index");
  await act(async () => {
    renderer = create(createElement(Chat));
  });
}
const text = () => JSON.stringify(renderer?.toJSON());

describe("聊天历史与图片失败隔离", () => {
  it("图片返回 503 时仍恢复文字产物和记忆血条", async () => {
    await mount();
    expect(text()).toContain("已经保存的日常");
    expect(text()).toContain("仍能看见的好彩头");
    expect(text()).toContain("87");
    expect(text()).toContain("图片暂不可用");
    expect(renderer!.root.findByType("textarea").props.disabled).toBe(false);
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
    expect(renderer!.root.findAllByType("image")).toHaveLength(5);
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
    const image = renderer!.root.findByType("image");
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
