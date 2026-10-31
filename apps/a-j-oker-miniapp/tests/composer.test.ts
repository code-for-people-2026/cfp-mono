import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../src/chat/composer";

vi.mock("@tarojs/components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Textarea: "textarea",
}));
vi.mock("@tarojs/taro", () => ({
  default: { onAppHide: vi.fn(), offAppHide: vi.fn() },
}));
let renderer: ReactTestRenderer;
const defaults = () => ({
  inputMode: "voice" as const,
  text: "",
  attachments: [],
  disabled: false,
  voiceDisabled: false,
  ready: false,
  busy: false,
  uploading: false,
  onMode: vi.fn(),
  onText: vi.fn(),
  onVoiceText: vi.fn(),
  onImage: vi.fn(),
  onRemoveImage: vi.fn(),
  onSend: vi.fn(),
});
const button = (label: string) =>
  renderer.root
    .findAllByType("button")
    .find((item) => item.props.ariaLabel === label)!;
beforeEach(() => {
  vi.stubEnv("TARO_ENV", "weapp");
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllEnvs();
});

describe("紧凑输入栏", () => {
  it.each(["voice", "keyboard"] as const)(
    "%s 模式依次排列图片、输入、切换和更多，图标是随包内置的 Lucide SVG",
    (inputMode) => {
      act(() => {
        renderer = create(
          createElement(ChatComposer, { ...defaults(), inputMode }),
        );
      });
      const bar = renderer.root
        .findAllByType("view")
        .find((item) => item.props.className?.split(" ").includes("composer"))!;
      const actions = bar
        .findAllByType("button")
        .filter((item) => item.props.ariaLabel);
      expect(actions.map((item) => item.props.ariaLabel)).toEqual([
        "添加图片",
        inputMode === "voice" ? "切换到键盘输入" : "切换到语音输入",
        "展开图片工具",
      ]);
      for (const icon of bar.findAllByType("image")) {
        expect(icon.props.src).toMatch(/^data:image\/svg\+xml,/);
        expect(decodeURIComponent(icon.props.src)).toContain("lucide");
        expect(decodeURIComponent(icon.props.src)).not.toContain(
          "currentColor",
        );
      }
      expect(renderer.root.findAllByType("textarea")).toHaveLength(
        inputMode === "voice" ? 0 : 1,
      );
    },
  );

  it("有草稿时显示有可读标签的发送图标，禁用规则来自原发送状态", () => {
    const props = {
      ...defaults(),
      inputMode: "keyboard" as const,
      text: "测试草稿",
      ready: true,
    };
    act(() => {
      renderer = create(createElement(ChatComposer, props));
    });
    expect(button("展开图片工具")).toBeUndefined();
    expect(button("发送消息").props.disabled).toBeUndefined();
    act(() => button("发送消息").props.onClick());
    expect(props.onSend).toHaveBeenCalledOnce();
    act(() =>
      renderer.update(createElement(ChatComposer, { ...props, ready: false })),
    );
    expect(button("发送消息").props.disabled).toBe(true);
  });

  it("语音模式的未发送草稿不会被隐藏的发送按钮直接提交", () => {
    const props = { ...defaults(), text: "保留的草稿", ready: true };
    act(() => {
      renderer = create(createElement(ChatComposer, props));
    });
    expect(button("发送消息")).toBeUndefined();
    act(() => button("切换到键盘输入").props.onClick());
    expect(props.onMode).toHaveBeenCalledWith("keyboard");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("图片入口保留系统选择器，更多中的拍照与相册使用对应来源", () => {
    const props = defaults();
    act(() => {
      renderer = create(createElement(ChatComposer, props));
    });
    act(() => button("添加图片").props.onClick());
    expect(props.onImage).toHaveBeenLastCalledWith(undefined);
    act(() => button("展开图片工具").props.onClick());
    act(() => button("从相册选择图片").props.onClick());
    expect(props.onImage).toHaveBeenLastCalledWith("album");
    expect(button("从相册选择图片")).toBeUndefined();
    act(() => button("展开图片工具").props.onClick());
    act(() => button("拍照").props.onClick());
    expect(props.onImage).toHaveBeenLastCalledWith("camera");
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("纯图片可以发送，满三张禁用继续添加，仍可移除", () => {
    const props = {
      ...defaults(),
      inputMode: "keyboard" as const,
      ready: true,
      attachments: [1, 2, 3].map((id) => ({ id, src: `fixture-${id}.png` })),
    };
    act(() => {
      renderer = create(createElement(ChatComposer, props));
    });
    expect(button("发送消息").props.disabled).toBeUndefined();
    expect(button("添加图片").props.disabled).toBe(true);
    act(() => button("添加图片").props.onClick());
    expect(props.onImage).not.toHaveBeenCalled();
    act(() => button("移除第 2 张图片").props.onClick());
    expect(props.onRemoveImage).toHaveBeenCalledWith(2);
  });
});
