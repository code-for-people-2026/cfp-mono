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
  getPrivacy: vi.fn().mockResolvedValue({ policy: { version: "test" }, state: "active", consent: { version: "test", external: true, sensitive: true }, expiresAt: null }),
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

it("导航抽屉顶部只显示用户头像昵称，关闭按钮仍可用", async () => {
  const { ChatNavigation } = await import("../src/chat/navigation");
  const close = vi.fn();
  act(() => { page = create(createElement(ChatNavigation, { open: true, profile: { nickname: "会留白的小水豚", avatar: { emoji: "🦦", color: "#e4eee5", image: false } }, sessions: [], disabled: true, memoryFull: false, onOpen: vi.fn(), onClose: close, onNew: vi.fn(), onSelect: vi.fn(), onMemory: vi.fn(), onSettings: vi.fn() })); });
  const heading = page!.root.findAllByType("view").find((node) => node.props.className === "drawer-heading")!;
  expect(heading.findAllByType("text").map((node) => node.children.join("")).join(" ")).toContain("会留白的小水豚");
  expect(heading.findAllByType("text").map((node) => node.children.join("")).join(" ")).not.toContain("阿 J 先生");
  act(() => { heading.findByType("button").props.onClick(); });
  expect(close).toHaveBeenCalledOnce();
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
it.each(["h5", "weapp"])("%s 旧连接页面只显示平台服务，不提供密钥及外部令牌入口", async (environment) => {
  vi.stubEnv("TARO_ENV", environment);
  await mountSettings();
  const rendered = JSON.stringify(page!.toJSON());
  expect(rendered).toContain("平台助手");
  expect(rendered).toContain("万相");
  expect(page!.root.findAllByType("input")).toHaveLength(0);
  expect(rendered).not.toMatch(/mode-option|生成专用连接令牌|复制 MCP|连接我的 Agent/);
  expect(api.mintMcpToken).not.toHaveBeenCalled();
});

it("旧页面尝试切换 BYOK 或外部模式，不改变平台模式", async () => {
  const { useChatMode, selectChatMode } = await import("../src/chat/preferences");
  function Consumer() { return createElement("text", {}, useChatMode()); }
  act(() => { page = create(createElement(Consumer)); });
  for (const mode of ["byok", "external", "platform"] as const) {
    act(() => selectChatMode(mode));
    expect(page!.toJSON()).toMatchObject({ children: ["platform"] });
  }
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
