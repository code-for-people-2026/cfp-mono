import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./composer";

vi.mock("./taro-components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Textarea: "textarea",
}));
vi.mock("./taro", () => ({
  default: { onAppHide: vi.fn(), offAppHide: vi.fn() },
}));

let renderer: ReactTestRenderer | undefined;
const root = () => renderer!;
const defaults = () => ({
  inputMode: "keyboard" as const,
  text: "",
  attachments: [],
  disabled: false,
  voiceDisabled: false,
  ready: true,
  busy: false,
  uploading: false,
  placeholder: "Host placeholder",
  maxTextLength: 12,
  maxAttachments: 2,
  attachmentLimit: "Host attachment limit",
  voicePrivacy: "Host voice privacy",
  renderIcon: (name: string, options?: { inverted?: boolean }) =>
    `${options?.inverted ? "inverted-" : ""}${name}`,
  voiceInput: () => "host-voice-input",
  onMode: vi.fn(),
  onText: vi.fn(),
  onVoiceText: vi.fn(),
  onImage: vi.fn(),
  onRemoveImage: vi.fn(),
  onSend: vi.fn(),
});

beforeEach(() => {
  vi.stubEnv("TARO_ENV", "weapp");
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllEnvs();
});

describe("ChatComposer", () => {
  it("uses host placeholder, limits, icons, and voice UI", () => {
    act(() => {
      renderer = create(createElement(ChatComposer, defaults()));
    });
    const textarea = root().root.findByType("textarea");
    expect(textarea.props.placeholder).toBe("Host placeholder");
    expect(textarea.props.maxlength).toBe(12);
    expect(
      root().root.findAll((node) => node.children.includes("camera")),
    ).toHaveLength(1);

    act(() => {
      root().root
        .findAllByType("button")
        .find((button) => button.props.ariaLabel === "展开图片工具")!
        .props.onClick();
    });
    expect(root().root.findAll((node) => node.children.includes("Host attachment limit"))).toHaveLength(1);
    expect(root().root.findAll((node) => node.children.includes("Host voice privacy"))).toHaveLength(1);
  });

  it("keeps attachment ids generic and honors the injected attachment limit", () => {
    const props = {
      ...defaults(),
      attachments: [
        { id: "attachment-one", src: "one.png" },
        { id: 42, src: "42.png" },
      ],
    };
    act(() => {
      renderer = create(createElement(ChatComposer, props));
    });
    const addButton = root().root
      .findAllByType("button")
      .find((button) => button.props.ariaLabel === "添加图片")!;
    expect(addButton.props.disabled).toBe(true);
    act(() => addButton.props.onClick());
    expect(props.onImage).not.toHaveBeenCalled();
    act(() =>
      root().root
        .findAllByType("button")
        .find((button) => button.props.ariaLabel === "移除第 2 张图片")!
        .props.onClick(),
    );
    expect(props.onRemoveImage).toHaveBeenCalledWith(42);
  });

  it("keeps voice drafts out of the hidden send action", () => {
    const props = { ...defaults(), inputMode: "voice" as const, text: "draft" };
    act(() => {
      renderer = create(createElement(ChatComposer, props));
    });
    const actions = root().root
      .findAllByType("button")
      .map((button) => button.props.ariaLabel);
    expect(actions).not.toContain("发送消息");
    expect(
      root().root.findAll((node) => node.children.includes("host-voice-input")),
    ).toHaveLength(1);
  });
});
