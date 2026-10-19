import { createElement } from "react";
import { Checkbox, CheckboxGroup } from "@tarojs/components";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  navigateTo: vi.fn(), navigateBack: vi.fn(), reLaunch: vi.fn(),
  getCurrentPages: vi.fn(() => ["chat", "settings"]),
  eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
}));
const api = vi.hoisted(() => ({
  getSafety: vi.fn(), submitSafety: vi.fn(),
  getLegal: vi.fn(), getPrivacy: vi.fn(), establishIdentity: vi.fn(),
  updateConsent: vi.fn(),
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
  api.getSafety.mockResolvedValue({ configuration: { configured: false }, cases: [] });
  api.submitSafety.mockResolvedValue({ receipt: "synthetic-receipt" });
  api.establishIdentity.mockResolvedValue(undefined);
  api.getPrivacy.mockResolvedValue({ policy, state: "unaccepted", consent: null, expiresAt: null, hasRecoveryCode: false });
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
it("图片入口解释授权原因并突出敏感信息选项，不会替用户勾选或提交", async () => {
  platform.params = { reason: "image-upload" };
  await mount(PrivacyAuthorization);
  expect(view()).toContain("上传图片需要你的同意");
  const firstChoice = renderer.root.findAllByType("label")[0];
  expect(firstChoice.props.className).toContain("privacy-choice-highlight");
  expect(firstChoice.findByType(Checkbox).props.value).toBe("sensitive");
  expect(renderer.root.findAllByType(Checkbox).every((item) => !item.props.checked)).toBe(true);
  act(() => renderer.root.findByType(CheckboxGroup).props.onChange({ detail: { value: ["core", "model"] } }));
  expect(button("保存并返回聊天").props.disabled).toBe(true);
  await act(async () => { button("保存并返回聊天").props.onClick(); });
  expect(api.updateConsent).not.toHaveBeenCalled();
  act(() => renderer.root.findAllByType("button").find((item) => item.props["aria-label"] === "返回上一级")!.props.onClick());
  expect(platform.navigateBack).toHaveBeenCalledTimes(1);
  expect(api.updateConsent).not.toHaveBeenCalled();
});
it("图片授权保存失败保留选择，重试确认成功后才返回聊天并通知更新", async () => {
  platform.params = { reason: "image-upload" };
  const before = { policy, state: "active", consent: { version: "v1", core: true, model: true, sensitive: false, external: false } };
  const saved = { ...before, consent: { ...before.consent, sensitive: true } };
  api.getPrivacy.mockResolvedValue(before);
  api.updateConsent.mockRejectedValueOnce(new Error("网络未连接，请重试")).mockResolvedValueOnce(saved);
  await mount(PrivacyAuthorization);
  act(() => renderer.root.findByType(CheckboxGroup).props.onChange({ detail: { value: ["core", "model", "sensitive"] } }));
  await act(async () => { button("保存并返回聊天").props.onClick(); });
  expect(view()).toContain("网络未连接，请重试");
  expect(renderer.root.findAllByType(Checkbox).find((item) => item.props.value === "sensitive")!.props.checked).toBe(true);
  expect(platform.navigateBack).not.toHaveBeenCalled();
  expect(platform.eventCenter.trigger).not.toHaveBeenCalled();
  await act(async () => { button("保存并返回聊天").props.onClick(); });
  expect(api.updateConsent).toHaveBeenLastCalledWith({ version: "v1", core: true, model: true, sensitive: true, external: false });
  expect(platform.eventCenter.trigger).toHaveBeenCalledWith("hello:privacy-changed", { status: saved });
  expect(platform.navigateBack).toHaveBeenCalledTimes(1);
});
it("更新说明后的图片授权要求重新确认，普通授权页仍保留原入口", async () => {
  platform.params = { reason: "image-upload" };
  api.getPrivacy.mockResolvedValue({ policy, state: "active", consent: { version: "old", core: true, model: true, sensitive: true } });
  await mount(PrivacyAuthorization);
  expect(view()).toContain("说明已更新，请一并确认其余授权选择");
  expect(renderer.root.findAllByType(Checkbox).every((item) => !item.props.checked)).toBe(true);
  act(() => renderer.unmount());
  platform.params = {};
  await mount(PrivacyAuthorization);
  expect(view()).not.toContain("上传图片需要你的同意");
  expect(renderer.root.findAllByType("label")[0].findByType(Checkbox).props.value).toBe("core");
  expect(button("保存授权选择")).toBeDefined();
});
it("删除需要完整确认短语，打开页面不会删除数据", async () => {
  platform.params = { action: "delete" };
  await mount(PrivacyData);
  expect(button("确认删除在线数据").props.disabled).toBe(true);
  act(() => renderer.root.findByType("input").props.onInput({ detail: { value: "删除" } }));
  expect(button("确认删除在线数据").props.disabled).toBe(true);
  expect(api.deletePersonalData).not.toHaveBeenCalled();
});
it("帮助读取联系渠道和本人受理记录，右侧图标支持刷新", async () => {
  await mount(HelpPage);
  const refresh = renderer.root.findAllByType("button").find((item) => item.props["aria-label"] === "刷新帮助与反馈")!;
  api.getLegal.mockResolvedValueOnce({ ...policy, contact: "updated@example.invalid" });
  await act(async () => { refresh.props.onClick(); });
  expect(api.getLegal).toHaveBeenCalledTimes(2);
  expect(view()).toContain("updated@example.invalid");
  expect(api.establishIdentity).toHaveBeenCalledTimes(2);
  expect(api.getSafety).toHaveBeenCalledTimes(2);
  expect(renderer.root.findAllByType("button").some((item) => item.props["aria-label"] === "关闭帮助与反馈")).toBe(true);
});
it("反馈关联指定轮次，提交成功前不虚构受理记录", async () => {
  platform.params = { turnId: "42" };
  await mount(HelpPage);
  expect(button("提交反馈").props.disabled).toBe(true);
  expect(view()).not.toContain("已提交，受理编号");
  act(() => renderer.root.findByType("textarea").props.onInput({ detail: { value: "这条回应需要人工复核" } }));
  await act(async () => { button("提交反馈").props.onClick(); });
  expect(api.submitSafety).toHaveBeenCalledWith({ kind: "complaint", category: "other", description: "这条回应需要人工复核", turnId: 42 });
  expect(view()).toContain("synthetic-receipt");
});
it("帮助联系渠道读取失败显示错误，刷新后恢复", async () => {
  api.getLegal.mockRejectedValueOnce(new Error("联系渠道读取失败"));
  await mount(HelpPage);
  expect(view()).toContain("联系渠道读取失败");
  const refresh = renderer.root.findAllByType("button").find((item) => item.props["aria-label"] === "刷新帮助与反馈")!;
  await act(async () => { refresh.props.onClick(); });
  expect(view()).not.toContain("联系渠道读取失败");
  expect(view()).toContain(policy.contact);
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
