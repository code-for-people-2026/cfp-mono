import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgeStatus } from "@cfp/a-j-oker-contracts";
import { CheckboxGroup } from "@tarojs/components";

const platform = vi.hoisted(() => ({
  params: {} as Record<string, string>, didShow: undefined as undefined | (() => void),
  getCurrentPages: vi.fn(() => [{}, {}]), navigateBack: vi.fn(), reLaunch: vi.fn(),
}));
const api = vi.hoisted(() => ({
  loginWechat: vi.fn(), cancelAge: vi.fn(), beginAge: vi.fn(), submitAge: vi.fn(),
  requestAgeReview: vi.fn(), beginAgeReview: vi.fn(), getLegal: vi.fn(),
  establishIdentity: vi.fn(), getSafety: vi.fn(), getAge: vi.fn(), submitSafety: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({
  default: platform,
  useRouter: () => ({ params: platform.params }),
  useDidShow: (callback: () => void) => { platform.didShow = callback; useEffect(callback, []); },
}));
vi.mock("../src/chat/api", () => api);
vi.mock("@tarojs/components", () => ({ Button: "button", View: "view", Text: "text", Image: "image", Input: "input", Textarea: "textarea", Checkbox: "checkbox", CheckboxGroup: "checkbox-group", Label: "label", Picker: "picker", ScrollView: "scroll-view" }));
import { AgeGate } from "../src/chat/age";
import { HelpPage } from "../src/chat/safety";

const review = (state: "request_required" | "pending" | "approved" | "rejected") => ({
  state, receipt: state === "request_required" ? null : "AGE-SYNTHETIC-001", caseStatus: state === "pending" ? "in_progress" as const : state === "request_required" ? null : "resolved" as const,
  result: state === "approved" ? "permit_fresh_verification" as const : state === "rejected" ? "maintain_restriction" as const : null,
  reply: state === "rejected" ? "合成回复：当前信息仍需维持限制。" : null, requestedAt: null, decidedAt: null,
  helpPath: "/pages/help/index?category=age_verification" as const,
});
const base: AgeStatus = {
  loggedIn: true, state: "needs_review", declaration: "adult", allowed: false, verifiedAt: null, expiresAt: null, source: null,
  assurance: null, additionalVerification: "required", notice: { version: "notice-synthetic", paragraphs: [] },
  configuration: { wechat: true, provider: true, providerName: "aliyun" },
  review: review("request_required"), actions: { requestReview: true, checkReviewStatus: false, startReverification: false },
};
const props = { status: base, privacyReady: false, onLogin: vi.fn(), onClose: vi.fn(), onChange: vi.fn(), onRefresh: vi.fn(), onPrivacy: vi.fn(), onHelp: vi.fn() };
let renderer: ReactTestRenderer;
const text = () => JSON.stringify(renderer.toJSON());
const buttonText = (label: string) => renderer.root.findAllByType("button").find((node) => node.children.includes(label) || node.findAllByType("text").some((child) => child.children.join("") === label));

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("TARO_ENV", "weapp"); platform.params = {}; platform.didShow = undefined;
  api.getLegal.mockResolvedValue({ contact: "合成联系渠道" }); api.establishIdentity.mockResolvedValue(undefined);
  api.getSafety.mockResolvedValue({ cases: [], configuration: { configured: false, notice: "" } }); api.getAge.mockResolvedValue(base);
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllEnvs(); });

describe("年龄限制恢复窗口", () => {
  it("解释限制和下一步，申请复核双击也只产生一个案件请求", async () => {
    api.requestAgeReview.mockResolvedValue({ ...base, review: review("pending"), actions: { requestReview: false, checkReviewStatus: true, startReverification: false } });
    act(() => { renderer = create(createElement(AgeGate, props)); });
    expect(text()).toContain("工作人员下一步处理");
    const request = buttonText("申请年龄复核")!;
    await act(async () => { request.props.onClick(); request.props.onClick(); });
    expect(api.requestAgeReview).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ review: expect.objectContaining({ state: "pending" }) }));
  });

  it("待处理只查询状态；拒绝显示服务端回复但不提供重新核验", async () => {
    act(() => { renderer = create(createElement(AgeGate, { ...props, status: { ...base, review: review("pending"), actions: { requestReview: false, checkReviewStatus: true, startReverification: false } } })); });
    expect(text()).toContain("下一步由工作人员查看");
    await act(async () => { buttonText("查询复核状态")!.props.onClick(); });
    expect(props.onRefresh).toHaveBeenCalledOnce();
    act(() => { renderer.update(createElement(AgeGate, { ...props, status: { ...base, review: review("rejected"), actions: { requestReview: false, checkReviewStatus: false, startReverification: false } } })); });
    expect(text()).toContain("合成回复：当前信息仍需维持限制");
    expect(buttonText("开始重新核验")).toBeUndefined();
  });

  it("批准仍保持阻断，单独同意后才发起新挑战并清空临时身份字段", async () => {
    const approved = { ...base, review: review("approved"), actions: { requestReview: false, checkReviewStatus: false, startReverification: true } };
    api.beginAgeReview.mockResolvedValue({ status: approved, challenge: "synthetic-review-challenge" });
    api.submitAge.mockResolvedValue({ ...approved, state: "failed" });
    act(() => { renderer = create(createElement(AgeGate, { ...props, status: approved })); });
    expect(text()).toContain("不代表已经成年");
    act(() => { buttonText("开始重新核验")!.props.onClick(); });
    const inputs = renderer.root.findAllByType("input");
    act(() => { inputs[0].props.onInput({ detail: { value: "合成测试" } }); inputs[1].props.onInput({ detail: { value: "000000200001010000" } }); });
    expect(buttonText("同意并核验")!.props.disabled).toBe(true);
    act(() => { renderer.root.findByType(CheckboxGroup).props.onChange({ detail: { value: ["age"] } }); });
    await act(async () => { buttonText("同意并核验")!.props.onClick(); });
    expect(api.beginAgeReview).toHaveBeenCalledWith({ noticeVersion: "notice-synthetic", consent: true });
    expect(api.submitAge).toHaveBeenCalledWith({ challenge: "synthetic-review-challenge", name: "合成测试", idCard: "000000200001010000" });
    expect(renderer.root.findAllByType("input").every((input) => input.props.value === "")).toBe(true);
  });

  it("提供方不可用时不启动重新核验；旧响应缺少可选字段也安全降级", () => {
    act(() => { renderer = create(createElement(AgeGate, { ...props, status: { ...base, configuration: { ...base.configuration, provider: false }, review: review("approved"), actions: { requestReview: false, checkReviewStatus: false, startReverification: true } } })); });
    expect(buttonText("核验服务暂不可用")!.props.disabled).toBe(true);
    act(() => { renderer.update(createElement(AgeGate, { ...props, status: { ...base, review: undefined, actions: undefined } })); });
    expect(text()).toContain("较早版本"); expect(text()).toContain("年龄核验帮助");
  });
});

describe("年龄核验帮助页", () => {
  it("深链直接打开专用恢复面板，显示回执状态回复且没有证件反馈表单", async () => {
    platform.params = { category: "age_verification" };
    api.getAge.mockResolvedValue({ ...base, review: review("rejected"), actions: { requestReview: false, checkReviewStatus: false, startReverification: false } });
    await act(async () => { renderer = create(createElement(HelpPage)); });
    expect(text()).toContain("年龄核验与账号恢复"); expect(text()).toContain("AGE-SYNTHETIC-001"); expect(text()).toContain("合成回复");
    expect(text()).toContain("请不要在反馈中填写姓名、身份证号码或上传证件照片");
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
  });

  it("页面重新显示时刷新服务端年龄复核状态", async () => {
    platform.params = { category: "age_verification" };
    await act(async () => { renderer = create(createElement(HelpPage)); });
    expect(api.getAge).toHaveBeenCalledTimes(1);
    await act(async () => { platform.didShow?.(); });
    expect(api.getAge).toHaveBeenCalledTimes(2);
  });
});
