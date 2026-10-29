import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatDock } from "../src/chat/dock";

const events = vi.hoisted(() => ({ keyboard: undefined as undefined | ((e: { height: number }) => void), hide: undefined as undefined | (() => void) }));
vi.mock("@tarojs/components", () => ({ View: "view" }));
vi.mock("@tarojs/taro", () => ({ default: {
  onKeyboardHeightChange: (fn: typeof events.keyboard) => { events.keyboard = fn; },
  offKeyboardHeightChange: () => { events.keyboard = undefined; },
  onAppHide: (fn: typeof events.hide) => { events.hide = fn; },
  offAppHide: () => { events.hide = undefined; },
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: (fn: (r: { height: number }) => void) => {
    fn({ height: 120 }); return { exec: () => {} };
  } }) }),
} }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllEnvs(); });
describe("输入栏随安卓键盘整体上移", () => {
  it("输入和发送一起避开键盘，收起及切后台后恢复，卸载清理监听", () => {
    vi.stubEnv("TARO_ENV", "weapp");
    act(() => { renderer = create(createElement(ChatDock, { children: "input and send" })); });
    const dock = () => renderer.root.findByProps({ className: "chat-dock" });
    expect(dock().props.style).toBeUndefined();
    act(() => events.keyboard?.({ height: 320 }));
    expect(dock().props.style).toMatchObject({ position: "fixed", bottom: "320px" });
    expect(renderer.root.findByProps({ className: "chat-dock-space" }).props.style.height).toBe("440px");
    act(() => events.keyboard?.({ height: 0 }));
    expect(dock().props.style).toBeUndefined();
    act(() => events.keyboard?.({ height: 300 }));
    act(() => events.hide?.());
    expect(dock().props.style).toBeUndefined();
    act(() => renderer.unmount());
    expect(events.keyboard).toBeUndefined();
    expect(events.hide).toBeUndefined();
  });
  it("H5保留浏览器视口行为", () => {
    vi.stubEnv("TARO_ENV", "h5");
    act(() => { renderer = create(createElement(ChatDock, { children: "input and send" })); });
    expect(events.keyboard).toBeUndefined();
    expect(renderer.root.findByProps({ className: "chat-dock" }).props.style).toBeUndefined();
  });
});
