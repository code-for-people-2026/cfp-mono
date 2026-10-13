import { createElement } from "react";
import { Checkbox } from "@tarojs/components";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  navigateTo: vi.fn(), navigateBack: vi.fn(), reLaunch: vi.fn(),
  getCurrentPages: vi.fn(() => ["chat", "settings"]),
  eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
}));
const api = vi.hoisted(() => ({
  getLegal: vi.fn(), getPrivacy: vi.fn(), establishIdentity: vi.fn(),
  getSafety: vi.fn(), submitSafety: vi.fn(), updateConsent: vi.fn(),
  deletePersonalData: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({ default: platform, useRouter: () => ({ params: platform.params }), useDidShow: vi.fn() }));
vi.mock("@tarojs/components", () => ({ Button: "button", View: "view", Text: "text", Input: "input", Textarea: "textarea", Checkbox: "checkbox", CheckboxGroup: "checkbox-group", Label: "label", ScrollView: "scroll-view" }));
vi.mock("../src/chat/api", () => api);
import { PrivacyHome, PrivacyAuthorization, PrivacyData } from "../src/chat/privacy";
import { HelpPage } from "../src/chat/safety";

let renderer: ReactTestRenderer;
const policy = { version: "v1", ready: true, contact: "test", documents: [{ title: "隐私政策", paragraphs: ["不应直接出现在首页的协议正文"] }] };
const button = (label: string) => renderer.root.findAllByType("button").find((item) => item.children.includes(label) || item.findAllByType("text").some((text) => text.children.join("") === label))!;
const view = () => JSON.stringify(renderer.toJSON());
async function mount(component: typeof PrivacyHome) { await act(async () => { renderer = create(createElement(component)); }); }
beforeEach(() => {
  vi.clearAllMocks(); platform.params = {};
  api.getLegal.mockResolvedValue(policy);
  api.establishIdentity.mockResolvedValue(undefined);
  api.getPrivacy.mockResolvedValue({ policy, state: "unaccepted", consent: null, expiresAt: null, hasRecoveryCode: false });
  api.getSafety.mockResolvedValue({ configuration: { configured: false }, cases: [] });
});
afterEach(() => { act(() => renderer?.unmount()); });

it("隐私首页只展示管理入口，授权和政策使用独立路由", async () => {
  await mount(PrivacyHome);
  expect(view()).toContain("授权管理"); expect(view()).toContain("导出数据"); expect(view()).toContain("删除数据");
  expect(view()).not.toContain("不应直接出现在首页");
  act(() => button("授权管理").props.onClick());
  expect(platform.navigateTo).toHaveBeenLastCalledWith({ url: "/pages/privacy/authorization/index" });
  act(() => button("政策与协议").props.onClick());
  expect(platform.navigateTo).toHaveBeenLastCalledWith({ url: "/pages/privacy/policies/index" });
});
it("首次授权不预选，缺少基础选择不能保存", async () => {
  await mount(PrivacyAuthorization);
  expect(renderer.root.findAllByType(Checkbox).every((item) => item.props.checked === false)).toBe(true);
  expect(button("保存授权选择").props.disabled).toBe(true);
  expect(api.updateConsent).not.toHaveBeenCalled();
});
it("删除需要完整确认短语，打开页面不会删除数据", async () => {
  platform.params = { action: "delete" };
  await mount(PrivacyData);
  expect(button("确认删除在线数据").props.disabled).toBe(true);
  act(() => renderer.root.findByType("input").props.onInput({ detail: { value: "删除" } }));
  expect(button("确认删除在线数据").props.disabled).toBe(true);
  expect(api.deletePersonalData).not.toHaveBeenCalled();
});
it("帮助右侧图标可刷新，刷新保留正在填写的反馈", async () => {
  await mount(HelpPage);
  act(() => renderer.root.findByType("textarea").props.onInput({ detail: { value: "这是一条合成反馈" } }));
  const refresh = renderer.root.findAllByType("button").find((item) => item.props["aria-label"] === "刷新受理记录")!;
  await act(async () => { refresh.props.onClick(); });
  expect(api.getSafety).toHaveBeenCalledTimes(2);
  expect(renderer.root.findByType("textarea").props.value).toBe("这是一条合成反馈");
  expect(renderer.root.findAllByType("button").some((item) => item.props["aria-label"] === "关闭帮助与反馈")).toBe(true);
});
it("反馈通过现有接口提交，只有成功返回才显示受理编号", async () => {
  api.submitSafety.mockRejectedValueOnce(new Error("后台暂未就绪"));
  await mount(HelpPage);
  act(() => renderer.root.findByType("textarea").props.onInput({ detail: { value: "这是一条合成反馈" } }));
  await act(async () => { button("提交反馈").props.onClick(); });
  expect(view()).toContain("后台暂未就绪"); expect(view()).not.toContain("已提交，受理编号");
  expect(renderer.root.findByType("textarea").props.value).toBe("这是一条合成反馈");
  api.submitSafety.mockResolvedValueOnce({ receipt: "synthetic-receipt" });
  await act(async () => { button("提交反馈").props.onClick(); });
  expect(api.submitSafety).toHaveBeenLastCalledWith({ kind: "complaint", category: "other", description: "这是一条合成反馈" });
  expect(view()).toContain("synthetic-receipt");
  expect(renderer.root.findByType("textarea").props.value).toBe("");
});
it("独立设置页只保留三个入口，连接方式进入子页面", async () => {
  const { default: Settings } = await import("../src/pages/settings/index");
  await mount(Settings);
  expect(view()).not.toContain("mode-option");
  expect(view()).not.toContain("sheet-overlay");
  act(() => button("连接方式").props.onClick());
  expect(platform.navigateTo).toHaveBeenLastCalledWith({ url: "/pages/connection/index" });
  act(() => button("帮助与反馈").props.onClick());
  expect(platform.navigateTo).toHaveBeenLastCalledWith({ url: "/pages/help/index" });
  act(() => button("隐私与数据").props.onClick());
  expect(platform.navigateTo).toHaveBeenLastCalledWith({ url: "/pages/privacy/index" });
});
