import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgeStatus } from "@cfp/hello-agent-protocol";

const api = vi.hoisted(() => ({ loginWechat: vi.fn(), cancelAge: vi.fn(), beginAge: vi.fn() }));
vi.mock("../src/chat/api", () => api);
vi.mock("@tarojs/components", () => ({ Button: "button", View: "view", Text: "text", Image: "image", Input: "input", Checkbox: "checkbox", CheckboxGroup: "checkbox-group", Label: "label", Picker: "picker", ScrollView: "scroll-view" }));
import { AgeGate } from "../src/chat/age";

const status: AgeStatus = { loggedIn: false, state: "unverified", allowed: false, verifiedAt: null, expiresAt: null, source: null, assurance: null, additionalVerification: "not_requested", notice: { version: "test", paragraphs: ["很长的说明只在链接后展示"] }, configuration: { wechat: true, provider: false, previewOnly: true } };
let renderer: ReactTestRenderer;
const onLogin = vi.fn(), onClose = vi.fn();
const props = { status, privacyReady: false, onLogin, onClose, onChange: vi.fn(), onRefresh: vi.fn(), onPrivacy: vi.fn(), onHelp: vi.fn() };
const button = (className: string) => renderer.root.findAllByType("button").find((item) => item.props.className.includes(className))!;
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TARO_ENV", "weapp"); api.loginWechat.mockResolvedValue({}); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllEnvs(); });

it("未登录窗口不能关闭，空昵称头像也能继续，详细说明默认收起", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  expect(button("age-close")).toBeUndefined();
  expect(JSON.stringify(renderer.toJSON())).not.toContain("很长的说明");
  expect(button("age-primary").props.disabled).toBeUndefined();
  await act(async () => { await button("age-primary").props.onClick(); });
  expect(api.loginWechat).toHaveBeenCalledWith(false, "test", { nickname: "", avatarPath: "" });
  expect(onLogin).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
});
it("微信昵称自动填充的失焦事件与原生头像选择进入同一次登录", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  const input = renderer.root.findByType("input");
  expect(input.props.type).toBe("nickname");
  expect(button("age-avatar-picker").props.openType).toBe("chooseAvatar");
  act(() => { input.props.onBlur({ detail: { value: "微信昵称" } }); button("age-avatar-picker").props.onChooseAvatar({ detail: { avatarUrl: "wxfile://avatar.jpg" } }); });
  expect(renderer.root.findByType("image").props.src).toBe("wxfile://avatar.jpg");
  await act(async () => { await button("age-primary").props.onClick(); });
  expect(api.loginWechat).toHaveBeenCalledWith(false, "test", { nickname: "微信昵称", avatarPath: "wxfile://avatar.jpg" });
});
it("平台拒绝的昵称被清空，不提交该昵称；登录后生日窗口显示分配的资料", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  act(() => { renderer.root.findByType("input").props.onInput({ detail: { value: "不能使用" } }); });
  act(() => { renderer.root.findByType("input").props.onNickNameReview({ detail: { pass: false } }); });
  expect(renderer.root.findByType("input").props.value).toBe("");
  act(() => { renderer.update(createElement(AgeGate, { ...props, status: { ...status, loggedIn: true }, profile: { nickname: "会留白的水獭", avatar: { emoji: "🦦", color: "#e4eee5", image: false } } })); });
  expect(JSON.stringify(renderer.toJSON())).toContain("会留白的水獭");
  expect(JSON.stringify(renderer.toJSON())).toContain("你的生日是？");
  expect(button("age-close")).toBeDefined();
});
