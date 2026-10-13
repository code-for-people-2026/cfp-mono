import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  getWindowInfo: vi.fn(),
  getMenuButtonBoundingClientRect: vi.fn(),
  nextTick: vi.fn((fn: () => void) => fn()),
  onWindowResize: vi.fn(),
  offWindowResize: vi.fn(),
  useDidHide: vi.fn(),
  useDidShow: vi.fn(),
  navigateTo: vi.fn().mockResolvedValue({}),
  getCurrentPages: vi.fn(() => [{}, {}]),
  navigateBack: vi.fn().mockResolvedValue({}),
  reLaunch: vi.fn().mockResolvedValue({}),
}));
const api = vi.hoisted(() => ({
  establishIdentity: vi.fn().mockResolvedValue(undefined),
  getSettings: vi
    .fn()
    .mockResolvedValue({
      model: "test-model",
      origin: "https://example.test",
      platformConfigured: true,
    }),
  getPrivacy: vi.fn().mockResolvedValue({ policy: { version: "test" }, state: "active", consent: { version: "test", external: true }, expiresAt: null }),
  mintMcpToken: vi.fn(),
  copy: vi.fn().mockResolvedValue(undefined),
  openCms: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({
  default: platform,
  useDidHide: platform.useDidHide,
  useDidShow: platform.useDidShow,
}));
vi.mock("../src/chat/api", () => api);
vi.mock("@tarojs/components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Input: "input",
  ScrollView: "scroll-view",
}));

let page: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubEnv("TARO_ENV", "weapp");
  vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
  vi.stubGlobal("definePageConfig", (config: unknown) => config);
  vi.stubGlobal("defineAppConfig", (config: unknown) => config);
  platform.getWindowInfo.mockReturnValue({
    windowWidth: 390,
    statusBarHeight: 47,
  });
  platform.getMenuButtonBoundingClientRect.mockReturnValue({
    top: 51,
    left: 296,
    height: 32,
  });
});
afterEach(() => {
  act(() => page?.unmount());
  page = undefined;
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("聊天只用自定义标题，设置是原生返回的子页面，胶囊区域不放功能按钮", async () => {
  const { default: app } = await import("../src/app.config");
  const { default: chat } = await import("../src/pages/chat/index.config");
  const { default: settings } =
    await import("../src/pages/settings/index.config");
  expect(app.pages).toContain("pages/settings/index");
  expect(chat.navigationStyle).toBe("custom");
  expect(settings.navigationStyle).toBe("default");
  const { ChatNavigation } = await import("../src/chat/navigation");
  const open = vi.fn();
  act(() => {
    page = create(
      createElement(ChatNavigation, {
        open: false,
        sessions: [],
        disabled: false,
        memoryFull: false,
        onOpen: open,
        onClose: vi.fn(),
        onNew: vi.fn(),
        onSelect: vi.fn(),
        onMemory: vi.fn(),
        onSettings: vi.fn(),
      }),
    );
  });
  const byClass = (name: string) =>
    page!.root
      .findAllByType("view")
      .find((node) => node.props.className?.split(" ").includes(name))!;
  expect(byClass("chat-header").props.style.paddingTop).toBe("47px");
  expect(byClass("navigation-row").props.style.height).toBe("44px");
  expect(byClass("nav-identity").props.style.right).toBe("102px");
  expect(byClass("nav-right")).toBeUndefined();
  expect(
    page!.root
      .findAllByType("text")
      .filter((node) => node.children.includes("阿 J 先生")),
  ).toHaveLength(1);
  act(() =>
    page!.root
      .findAllByType("button")
      .find((node) => node.props.ariaLabel === "打开会话导航")!
      .props.onClick(),
  );
  expect(open).toHaveBeenCalledOnce();
  platform.getWindowInfo.mockReturnValue({
    windowWidth: 430,
    statusBarHeight: 44,
  });
  platform.getMenuButtonBoundingClientRect.mockReturnValue({
    top: 50,
    left: 332,
    height: 32,
  });
  act(() => platform.onWindowResize.mock.calls[0][0]());
  expect(byClass("chat-header").props.style.paddingTop).toBe("44px");
  expect(byClass("nav-identity").props.style.right).toBe("106px");
});

it("胶囊冷启动返回空矩形时，仍预留状态栏和右侧位置", async () => {
  platform.getMenuButtonBoundingClientRect.mockReturnValue({
    top: 0,
    left: 0,
    height: 0,
  });
  const { readNavigationLayout } =
    await import("../src/chat/navigation-layout");
  expect(readNavigationLayout()).toEqual({
    statusBarHeight: 47,
    height: 48,
    side: 104,
  });
});

async function mountSettings() {
  const { default: SettingsPage } = await import("../src/pages/connection/index");
  await act(async () => {
    page = create(createElement(SettingsPage));
  });
}
function modeButton(index: number) {
  return page!.root
    .findAllByType("button")
    .filter((node) => node.props.className.includes("mode-option"))[index];
}
function button(label: string) {
  return page!.root
    .findAllByType("button")
    .find((node) => node.children.includes(label))!;
}

it("连接方式子页面原地选择方式，供仍在页面栈内的聊天读取，不再渲染弹窗", async () => {
  await mountSettings();
  const { useChatMode } = await import("../src/chat/preferences");
  function ModeConsumer() {
    return createElement("text", {}, useChatMode());
  }
  let consumer: ReactTestRenderer;
  act(() => {
    consumer = create(createElement(ModeConsumer));
  });
  act(() => modeButton(1).props.onClick());
  expect(consumer!.toJSON()).toMatchObject({ children: ["byok"] });
  expect(modeButton(1).props.className).toContain("selected");
  expect(JSON.stringify(page!.toJSON())).not.toContain("sheet-overlay");
  expect(JSON.stringify(page!.toJSON())).not.toContain("settings-header");
  act(() => consumer!.unmount());
});

it("离开连接方式后，迟到的 MCP 令牌不能重新出现在返回后的页面", async () => {
  await mountSettings();
  act(() => modeButton(2).props.onClick());
  let resolve!: (value: { token: string }) => void;
  api.mintMcpToken.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let pending: Promise<void>;
  await act(async () => {
    pending = button("生成专用连接令牌").props.onClick();
    await Promise.resolve();
  });
  act(() => platform.useDidHide.mock.calls.at(-1)![0]());
  act(() => platform.useDidShow.mock.calls.at(-1)![0]());
  await act(async () => {
    resolve({ token: "late-test-token" });
    await pending;
  });
  expect(button("复制 MCP 连接配置")).toBeUndefined();
  api.mintMcpToken.mockResolvedValueOnce({ token: "visible-test-token" });
  await act(async () => {
    await button("生成专用连接令牌").props.onClick();
  });
  await act(async () => {
    await button("复制 MCP 连接配置").props.onClick();
  });
  expect(
    JSON.parse(api.copy.mock.calls[0][0]).mcpServers["hello-agent"].headers
      .Authorization,
  ).toBe("Bearer visible-test-token");
  act(() => platform.useDidHide.mock.calls.at(-1)![0]());
  expect(button("复制 MCP 连接配置")).toBeUndefined();
});

it.each([1, 2])("网页连接方式的返回支持页面栈深度 %s", async (depth) => {
  vi.stubEnv("TARO_ENV", "h5");
  platform.getCurrentPages.mockReturnValue(
    Array.from({ length: depth }, () => ({})),
  );
  await mountSettings();
  await act(async () => {
    await page!.root
      .findAllByType("button")
      .find((node) => node.props.ariaLabel === "返回设置")!
      .props.onClick();
  });
  if (depth > 1) expect(platform.navigateBack).toHaveBeenCalledOnce();
  else
    expect(platform.reLaunch).toHaveBeenCalledWith({
      url: "/pages/chat/index",
    });
});
