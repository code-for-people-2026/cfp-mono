import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatDock } from "../src/chat/dock";

const events = vi.hoisted(() => ({
  keyboard: undefined as undefined | ((event: { height: number }) => void),
  resize: undefined as undefined | (() => void),
  hide: undefined as undefined | (() => void),
  show: undefined as undefined | (() => void),
}));
const platform = vi.hoisted(() => ({
  getWindowInfo: vi.fn(() => ({ windowHeight: 800 })),
}));
vi.mock("@tarojs/components", () => ({ View: "view" }));
vi.mock("@tarojs/taro", () => ({
  default: {
    onKeyboardHeightChange: (fn: typeof events.keyboard) => {
      events.keyboard = fn;
    },
    offKeyboardHeightChange: () => {
      events.keyboard = undefined;
    },
    onWindowResize: (fn: typeof events.resize) => {
      events.resize = fn;
    },
    offWindowResize: () => {
      events.resize = undefined;
    },
    onAppHide: (fn: typeof events.hide) => {
      events.hide = fn;
    },
    offAppHide: () => {
      events.hide = undefined;
    },
    onAppShow: (fn: typeof events.show) => {
      events.show = fn;
    },
    offAppShow: () => {
      events.show = undefined;
    },
    getWindowInfo: platform.getWindowInfo,
    createSelectorQuery: () => ({
      select: () => ({
        boundingClientRect: (fn: (rect: { height: number }) => void) => {
          fn({ height: 120 });
          return { exec: () => undefined };
        },
      }),
    }),
  },
}));

let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("输入栏键盘几何", () => {
  it("覆盖视口时输入和发送一起上移，失焦、收起、切后台和卸载都恢复", () => {
    vi.stubEnv("TARO_ENV", "weapp");
    const overlay = vi.fn();
    act(() => {
      renderer = create(
        createElement(ChatDock, {
          active: true,
          children: "input and send",
          onOverlayChange: overlay,
        }),
      );
    });
    const dock = () => renderer.root.findAllByType("view")
      .find((node) => {
        const name = String(node.props.className);
        return name === "chat-dock" || name.startsWith("chat-dock ");
      })!;
    expect(dock().props.style).toBeUndefined();
    act(() => events.keyboard?.({ height: 320 }));
    expect(dock().props.className).toContain("is-keyboard-overlay");
    expect(dock().props.style).toMatchObject({
      position: "fixed",
      bottom: "320px",
    });
    expect(
      renderer.root.findByProps({ className: "chat-dock-space" }).props.style
        .height,
    ).toBe("440px");
    expect(overlay).toHaveBeenLastCalledWith(true);

    act(() => renderer.update(
      createElement(ChatDock, {
        active: false,
        children: "input and send",
        onOverlayChange: overlay,
      }),
    ));
    expect(dock().props.style).toBeUndefined();
    expect(overlay).toHaveBeenLastCalledWith(false);

    act(() => renderer.update(
      createElement(ChatDock, {
        active: true,
        children: "input and send",
        onOverlayChange: overlay,
      }),
    ));
    act(() => events.keyboard?.({ height: 320 }));
    act(() => events.keyboard?.({ height: 0 }));
    expect(dock().props.style).toBeUndefined();
    act(() => events.keyboard?.({ height: 300 }));
    act(() => events.hide?.());
    expect(dock().props.style).toBeUndefined();
    act(() => renderer.unmount());
    expect(events.keyboard).toBeUndefined();
    expect(events.resize).toBeUndefined();
    expect(events.hide).toBeUndefined();
    expect(events.show).toBeUndefined();
  });

  it("键盘压缩视口时保持粘性布局，避免二次上移", () => {
    vi.stubEnv("TARO_ENV", "weapp");
    platform.getWindowInfo.mockReturnValue({ windowHeight: 800 });
    act(() => {
      renderer = create(
        createElement(ChatDock, { active: true, children: "input and send" }),
      );
    });
    act(() => events.keyboard?.({ height: 300 }));
    expect(
      renderer.root.findAllByType("view")
        .find((node) => {
          const name = String(node.props.className);
          return name === "chat-dock" || name.startsWith("chat-dock ");
        })!
        .props.style,
    ).toMatchObject({ bottom: "300px" });
    platform.getWindowInfo.mockReturnValue({ windowHeight: 500 });
    act(() => events.resize?.());
    expect(
      renderer.root.findAllByType("view")
        .find((node) => {
          const name = String(node.props.className);
          return name === "chat-dock" || name.startsWith("chat-dock ");
        })!
        .props.style,
    ).toBeUndefined();
    expect(
      renderer.root.findAllByProps({ className: "chat-dock-space" }),
    ).toHaveLength(0);
  });

  it("视口 resize 先于文本框高度和聚焦时仍使用缩放前基线", () => {
    vi.stubEnv("TARO_ENV", "weapp");
    platform.getWindowInfo.mockReturnValue({ windowHeight: 800 });
    act(() => {
      renderer = create(createElement(ChatDock, {
        active: false,
        keyboardHeight: 0,
        children: "input and send",
      }));
    });
    platform.getWindowInfo.mockReturnValue({ windowHeight: 500 });
    act(() => events.resize?.());
    act(() => renderer.update(createElement(ChatDock, {
      active: false,
      keyboardHeight: 300,
      children: "input and send",
    })));
    act(() => renderer.update(createElement(ChatDock, {
      active: true,
      keyboardHeight: 300,
      children: "input and send",
    })));
    expect(renderer.root.findByProps({ className: "chat-dock" }).props.style)
      .toBeUndefined();
  });

  it("失焦时连续 resize 会确认旋转后的稳定视口", () => {
    vi.stubEnv("TARO_ENV", "weapp");
    platform.getWindowInfo.mockReturnValue({ windowHeight: 800 });
    act(() => {
      renderer = create(createElement(ChatDock, {
        active: false,
        children: "input and send",
      }));
    });
    platform.getWindowInfo.mockReturnValue({ windowHeight: 600 });
    act(() => events.resize?.());
    act(() => events.resize?.());
    act(() => renderer.update(createElement(ChatDock, {
      active: true,
      keyboardHeight: 300,
      children: "input and send",
    })));
    expect(renderer.root.findByProps({ className: "chat-dock is-keyboard-overlay" })
      .props.style).toMatchObject({ bottom: "300px" });
  });

  it("H5保留浏览器视口行为，内联表单聚焦时也不接管键盘", () => {
    vi.stubEnv("TARO_ENV", "h5");
    act(() => {
      renderer = create(
        createElement(ChatDock, { active: false, children: "inline form" }),
      );
    });
    expect(events.keyboard).toBeUndefined();
    expect(events.resize).toBeUndefined();
    expect(
      renderer.root.findByProps({ className: "chat-dock" }).props.style,
    ).toBeUndefined();
  });
});
