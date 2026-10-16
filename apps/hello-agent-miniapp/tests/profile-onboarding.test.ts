import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgeStatus } from "@cfp/hello-agent-protocol";
import { CheckboxGroup, Picker } from "@tarojs/components";

const api = vi.hoisted(() => ({ loginWechat: vi.fn(), cancelAge: vi.fn(), beginAge: vi.fn(), submitAge: vi.fn() }));
vi.mock("../src/chat/api", () => api);
vi.mock("@tarojs/components", () => ({ Button: "button", View: "view", Text: "text", Image: "image", Input: "input", Checkbox: "checkbox", CheckboxGroup: "checkbox-group", Label: "label", Picker: "picker", ScrollView: "scroll-view" }));
import { AgeGate } from "../src/chat/age";

const status: AgeStatus = { loggedIn: false, state: "unverified", allowed: false, verifiedAt: null, expiresAt: null, source: null, assurance: null, additionalVerification: "not_requested", notice: { version: "test", paragraphs: ["很长的说明只在链接后展示"] }, configuration: { wechat: true, provider: false, previewOnly: true } };
let renderer: ReactTestRenderer;
const onLogin = vi.fn(), onClose = vi.fn();
const props = { status, privacyReady: false, onLogin, onClose, onChange: vi.fn(), onRefresh: vi.fn(), onPrivacy: vi.fn(), onHelp: vi.fn() };
const button = (className: string) => renderer.root.findAllByType("button").find((item) => item.props.className.includes(className))!;
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("TARO_ENV", "weapp"); api.loginWechat.mockResolvedValue({}); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("未登录窗口默认填好昵称，直接登录提交所见昵称，详细说明默认收起", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  const nickname = renderer.root.findByType("input").props.value;
  expect(nickname.length).toBeGreaterThan(0);
  expect(nickname.length).toBeLessThanOrEqual(24);
  expect(button("age-close")).toBeUndefined();
  expect(JSON.stringify(renderer.toJSON())).not.toContain("很长的说明");
  expect(button("age-primary").props.disabled).toBeUndefined();
  await act(async () => { await button("age-primary").props.onClick(); });
  expect(api.loginWechat).toHaveBeenCalledWith(false, "test", { nickname, avatarPath: "" });
  expect(onLogin).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
});
it("微信昵称自动填充的失焦事件与原生头像选择进入同一次登录", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  const input = renderer.root.findByType("input");
  expect(input.props.type).toBe("nickname");
  expect(input.props.focus).toBe(false);
  act(() => { button("age-wechat-nickname").props.onClick(); });
  expect(input.props.focus).toBe(true);
  expect(button("age-avatar-picker").props.openType).toBe("chooseAvatar");
  act(() => { input.props.onBlur({ detail: { value: "微信昵称" } }); button("age-avatar-picker").props.onChooseAvatar({ detail: { avatarUrl: "wxfile://avatar.jpg" } }); });
  expect(input.props.focus).toBe(false);
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

it("已选头像可以清除并改用随机头像", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  const nickname = renderer.root.findByType("input").props.value;
  act(() => { button("age-avatar-picker").props.onChooseAvatar({ detail: { avatarUrl: "wxfile://avatar.jpg" } }); });
  act(() => { button("age-avatar-reset").props.onClick(); });
  expect(renderer.root.findAllByType("image")).toHaveLength(0);
  await act(async () => { await button("age-primary").props.onClick(); });
  expect(api.loginWechat).toHaveBeenCalledWith(false, "test", { nickname, avatarPath: "" });
});

it("重新生成每次换一个昵称，查看说明不重置选择，登录提交最后一个", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  let nickname = renderer.root.findByType("input").props.value;
  for (let index = 0; index < 5; index++) {
    act(() => { button("age-regenerate-nickname").props.onClick(); });
    const next = renderer.root.findByType("input").props.value;
    expect(next).not.toBe(nickname);
    nickname = next;
  }
  act(() => { button("age-link").props.onClick(); });
  act(() => { button("age-link").props.onClick(); });
  expect(renderer.root.findByType("input").props.value).toBe(nickname);
  await act(async () => { await button("age-primary").props.onClick(); });
  expect(api.loginWechat).toHaveBeenCalledWith(false, "test", { nickname, avatarPath: "" });
});

it("清空建议昵称后仍可登录，由服务端补全资料", async () => {
  act(() => { renderer = create(createElement(AgeGate, props)); });
  act(() => { renderer.root.findByType("input").props.onInput({ detail: { value: "" } }); });
  await act(async () => { await button("age-primary").props.onClick(); });
  expect(api.loginWechat).toHaveBeenCalledWith(false, "test", { nickname: "", avatarPath: "" });
});

it("误填生日被拦截后明确说明无法对话，并允许通过身份证重新核验", () => {
  act(() => { renderer = create(createElement(AgeGate, { ...props, status: { ...status, loggedIn: true, state: "minor", declaration: "under14", configuration: { ...status.configuration, provider: true } } })); });
  expect(JSON.stringify(renderer.toJSON())).toContain("暂时无法开始对话");
  const correct = button("age-correct");
  expect(correct).toBeDefined();
  act(() => { correct.props.onClick(); });
  expect(JSON.stringify(renderer.toJSON())).toContain("身份证");
  expect(renderer.root.findAllByType(Picker)).toHaveLength(0);
  expect(button("age-primary").props.disabled).toBe(true);
});

it.each([ ["2016-01-01", "under14"], ["2010-01-01", "14to17"] ] as const)("首次误填生日 %s 后保存年龄段，重新打开仍可通过身份证更正", async (birthday, declaration) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
  const initial: AgeStatus = { ...status, loggedIn: true, configuration: { ...status.configuration, previewOnly: false, provider: true, providerName: "aliyun" } };
  const declared: AgeStatus = { ...initial, declaration, state: declaration === "under14" ? "minor" : "unverified" };
  const verified: AgeStatus = { ...declared, declaration: "adult", state: "adult", allowed: true, assurance: "identity_details_match" };
  api.beginAge.mockResolvedValueOnce({ status: declared }).mockResolvedValueOnce({ status: declared, challenge: "synthetic-correction" });
  api.submitAge.mockResolvedValue(verified);
  act(() => { renderer = create(createElement(AgeGate, { ...props, status: initial })); });
  act(() => { renderer.root.findByType(Picker).props.onChange({ detail: { value: birthday } }); });
  await act(async () => { button("age-primary").props.onClick(); });
  expect(api.beginAge).toHaveBeenNthCalledWith(1, { declaration, noticeVersion: "test", consent: true });
  expect(props.onChange).toHaveBeenCalledWith(declared);
  expect(JSON.stringify(renderer.toJSON())).toContain("暂时无法开始对话");
  expect(api.submitAge).not.toHaveBeenCalled();
  act(() => { renderer.unmount(); renderer = create(createElement(AgeGate, { ...props, status: declared })); });
  act(() => { button("age-correct").props.onClick(); });
  const inputs = renderer.root.findAllByType("input");
  act(() => { inputs[0].props.onInput({ detail: { value: "隔离测试" } }); inputs[1].props.onInput({ detail: { value: "000000200001010000" } }); });
  expect(button("age-primary").props.disabled).toBe(true);
  act(() => { renderer.root.findByType(CheckboxGroup).props.onChange({ detail: { value: ["age"] } }); });
  await act(async () => { button("age-primary").props.onClick(); });
  expect(api.beginAge).toHaveBeenNthCalledWith(2, { declaration: "unknown", correction: true, noticeVersion: "test", consent: true });
  expect(api.submitAge).toHaveBeenCalledWith({ challenge: "synthetic-correction", name: "隔离测试", idCard: "000000200001010000" });
  expect(props.onChange).toHaveBeenLastCalledWith(verified);
});

it("更正生日提交单独同意和身份证，核验失败保留更正入口且清除敏感表单", async () => {
  const minor: AgeStatus = { ...status, loggedIn: true, state: "minor", declaration: "under14", configuration: { ...status.configuration, provider: true, providerName: "aliyun" } };
  api.beginAge.mockResolvedValue({ status: minor, challenge: "synthetic-challenge" });
  api.submitAge.mockResolvedValue({ ...minor, state: "failed" });
  act(() => { renderer = create(createElement(AgeGate, { ...props, status: minor })); });
  act(() => { button("age-correct").props.onClick(); });
  const inputs = renderer.root.findAllByType("input");
  act(() => { inputs[0].props.onInput({ detail: { value: "隔离测试" } }); inputs[1].props.onInput({ detail: { value: "000000200001010000" } }); });
  expect(button("age-primary").props.disabled).toBe(true);
  act(() => { renderer.root.findByType(CheckboxGroup).props.onChange({ detail: { value: ["age"] } }); });
  await act(async () => { await button("age-primary").props.onClick(); });
  expect(api.beginAge).toHaveBeenCalledWith({ declaration: "unknown", correction: true, consent: true, noticeVersion: "test" });
  expect(api.submitAge).toHaveBeenCalledWith({ challenge: "synthetic-challenge", name: "隔离测试", idCard: "000000200001010000" });
  expect(renderer.root.findAllByType("input").every((input) => input.props.value === "")).toBe(true);
});

it("真实核验为未成年或被要求复核时不能用生日更正入口绕过", () => {
  act(() => { renderer = create(createElement(AgeGate, { ...props, status: { ...status, loggedIn: true, state: "minor", assurance: "identity_details_match" } })); });
  expect(button("age-correct")).toBeUndefined();
  act(() => { renderer.update(createElement(AgeGate, { ...props, status: { ...status, loggedIn: true, state: "needs_review", additionalVerification: "required" } })); });
  expect(button("age-correct")).toBeUndefined();
});
