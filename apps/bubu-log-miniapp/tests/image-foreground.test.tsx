import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyRecordSummary } from "./fixtures/records";

const fixture = vi.hoisted(() => {
  process.env.TARO_ENV = "weapp";
  Object.assign(globalThis, { BUBU_API_ORIGIN: "https://synthetic.invalid" });
  return {
    show: new Set<() => void>(),
    hide: new Set<() => void>(),
    storage: new Map(),
    params: {} as Record<string, string | undefined>,
    pages: [] as unknown[],
    keyboard: new Set<(result: { height: number }) => void>(),
    events: new Map<string, Set<(...args: unknown[]) => void>>(),
    api: {
    getContext: vi.fn(), logout: vi.fn(), privacyPolicy: vi.fn(), privacyStatus: vi.fn(), getSnapshot: vi.fn(),
    getActivities: vi.fn(), getLatestActivity: vi.fn(), getChatHistory: vi.fn(), getPending: vi.fn(),
    getSyncStatus: vi.fn(), uploadAttachment: vi.fn(), resolvePhotoUrl: vi.fn(), releasePhotoUrl: vi.fn(),
    }, picker: vi.fn() };
});
vi.mock("@tarojs/taro", async () => {
  const { useEffect, useRef } = await import("react");
  const eventCenter = {
    on: (event: string, callback: (...args: unknown[]) => void) => {
      const listeners = fixture.events.get(event) || new Set();
      listeners.add(callback); fixture.events.set(event, listeners);
    },
    off: (event: string, callback: (...args: unknown[]) => void) => {
      fixture.events.get(event)?.delete(callback);
    },
    trigger: (event: string, ...args: unknown[]) => {
      for (const listener of [...fixture.events.get(event) || []]) listener(...args);
    },
  };
  return {
    useDidShow: (callback: () => void) => {
      const latest = useRef(callback); latest.current = callback;
      useEffect(() => { const invoke = () => latest.current(); fixture.show.add(invoke); return () => { fixture.show.delete(invoke); }; }, []);
    },
    useDidHide: (callback: () => void) => {
      const latest = useRef(callback); latest.current = callback;
      useEffect(() => {
        const invoke = () => latest.current();
        fixture.hide.add(invoke);
        return () => { fixture.hide.delete(invoke); };
      }, []);
    },
    default: {
      eventCenter,
      onAppShow: (callback: () => void) => { fixture.show.add(callback); },
      offAppShow: (callback: () => void) => { fixture.show.delete(callback); },
      onAppHide: (callback: () => void) => { fixture.hide.add(callback); },
      offAppHide: (callback: () => void) => { fixture.hide.delete(callback); },
      getStorageSync: (key: string) => fixture.storage.get(key),
      setStorageSync: (key: string, value: unknown) => fixture.storage.set(key, value),
      removeStorageSync: (key: string) => fixture.storage.delete(key),
      requirePrivacyAuthorize: async () => {}, chooseImage: fixture.picker,
      getFileSystemManager: () => ({
        readFile: ({ success }: { success(value: { data: ArrayBuffer }): void }) => success({ data: new Uint8Array([137,80,78,71,13,10,26,10]).buffer }),
        unlink: vi.fn(),
      }),
      getWindowInfo: () => ({ windowHeight: 800, statusBarHeight: 24, windowWidth: 390 }),
      getMenuButtonBoundingClientRect: () => ({ top: 28, left: 281, height: 32 }),
      nextTick: (callback: () => void) => { callback(); },
      onWindowResize: vi.fn(),
      offWindowResize: vi.fn(),
      getCurrentInstance: () => ({ router: { params: fixture.params } }),
      getCurrentPages: () => fixture.pages,
      navigateBack: vi.fn(),
      navigateTo: vi.fn(),
      reLaunch: vi.fn(),
      onKeyboardHeightChange: (callback: (result: { height: number }) => void) => { fixture.keyboard.add(callback); },
      offKeyboardHeightChange: (callback: (result: { height: number }) => void) => { fixture.keyboard.delete(callback); },
    },
  };
});
vi.mock("@tarojs/components", () => Object.fromEntries(["Button", "Image", "ScrollView", "Text", "Textarea", "View", "Input", "Picker", "Switch"].map(key => [key, key])));
vi.mock("../src/api", async () => ({ ...await import("../src/api/client"), api: fixture.api, identityEnabled: true, wechatIdentityEnabled: true }));
// Only unrelated presentation is replaced. The page, DiaryChat, ChatSession,
// image chooser, draft store and foreground lifecycle below are production code.
vi.mock("../src/navigation/layout", () => ({ readNavigationLayout: () => ({ statusBarHeight: 24, height: 48, side: 96 }) }));
vi.mock("../src/chat/speech-platform", () => ({
  createPlatformSpeechDriver: () => ({ start() {}, stop() {}, cancel() {}, dispose() {} }),
}));
import ChatPage from "../src/pages/chat/index";
import Taro from "@tarojs/taro";
import { identityUpdatedEvent, sessionExpiredEvent } from "../src/navigation/events";
import { ApiError } from "../src/api";
import { stageChatSelection } from "../src/chat/handoff";

let root: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks(); fixture.storage.clear(); fixture.show.clear(); fixture.hide.clear(); fixture.keyboard.clear(); fixture.events.clear();
  fixture.params = {}; fixture.pages = [{ route: "pages/chat/index" }];
  fixture.api.getContext.mockResolvedValue({ authenticated: true, identityId: "synthetic-parent", hasBaby: true, baby: { id: "synthetic-baby", name: "测试宝宝" }, babies: [{ id: "synthetic-baby", name: "测试宝宝" }] });
  fixture.api.privacyPolicy.mockResolvedValue({ ready: true, documents: [] });
  fixture.api.privacyStatus.mockResolvedValue({ consentCurrent: true, guardianCurrent: true });
  fixture.api.getSnapshot.mockResolvedValue({ activities: [], summary: emptyRecordSummary() });
  fixture.api.getActivities.mockResolvedValue({ activities: [], complete: true });
  fixture.api.getLatestActivity.mockResolvedValue(null);
  fixture.api.getChatHistory.mockResolvedValue({ turns: [], pending: [], automaticMessages: [] });
  fixture.api.getPending.mockResolvedValue([]); fixture.api.getSyncStatus.mockResolvedValue([]);
  fixture.api.uploadAttachment.mockResolvedValue({ id: "synthetic-image" });
  fixture.api.resolvePhotoUrl.mockResolvedValue("local-synthetic-preview");
  (Taro.navigateBack as ReturnType<typeof vi.fn>).mockResolvedValue({});
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });
const button = (label: string) => root.root.findByProps({ ariaLabel: label });
async function openChat() {
  await act(async () => { root = create(<ChatPage />); });
}
async function showApp() {
  await act(async () => {
    for (const show of [...fixture.show]) show();
    await Promise.resolve();
    await Promise.resolve();
  });
}
const text = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray((node as { children?: unknown[] }).children)) return "";
  return (node as { children: unknown[] }).children.map(text).join("");
};
it("keeps an in-flight native image selection and its preview when onShow fires on picker return", async () => {
  await openChat();
  expect(fixture.api.getContext).toHaveBeenCalledWith(undefined);
  let selected!: (value: { tempFilePaths: string[] }) => void;
  fixture.picker.mockImplementation(() => new Promise(resolve => { selected = resolve; }));
  await act(async () => button("添加照片").props.onClick());
  await act(async () => { for (const show of [...fixture.show]) show(); });
  await act(async () => selected({ tempFilePaths: ["synthetic.png"] }));
  expect(fixture.api.uploadAttachment).toHaveBeenCalledOnce();
  expect(root.root.findAllByProps({ src: "local-synthetic-preview" })).toHaveLength(1);
  expect(button("发送消息").props.disabled).toBeFalsy();
});
it("re-resolves an attached private image after authorized foreground validation without losing the draft", async () => {
  fixture.picker.mockResolvedValue({ tempFilePaths: ["synthetic.png"] });
  fixture.api.resolvePhotoUrl.mockResolvedValueOnce("local-preview-v1").mockResolvedValue("local-preview-v2");
  await openChat();
  await act(async () => root.root.findByProps({ className: "bubu-chat-text" }).props.onInput({ detail: { value: "draft survives" } }));
  await act(async () => button("添加照片").props.onClick());
  expect(root.root.findAllByProps({ src: "local-preview-v1" })).toHaveLength(1);

  await showApp();
  expect(fixture.api.resolvePhotoUrl).toHaveBeenCalledTimes(2);
  expect(root.root.findAllByProps({ src: "local-preview-v2" })).toHaveLength(1);
  expect(fixture.api.releasePhotoUrl).toHaveBeenCalledWith("local-preview-v1");
  expect(root.root.findByProps({ className: "bubu-chat-text" }).props.value).toBe("draft survives");
  expect(root.root.findAllByProps({ className: "bubu-chat-attachment" })).toHaveLength(1);

  let resolveLate!: (value: string) => void;
  fixture.api.resolvePhotoUrl.mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve; }));
  await showApp();
  fixture.api.resolvePhotoUrl.mockResolvedValueOnce("local-preview-v4");
  await showApp();
  expect(root.root.findAllByProps({ src: "local-preview-v4" })).toHaveLength(1);
  await act(async () => resolveLate("local-preview-v3-stale"));
  expect(root.root.findAllByProps({ src: "local-preview-v3-stale" })).toHaveLength(0);
  expect(fixture.api.releasePhotoUrl).toHaveBeenCalledWith("local-preview-v3-stale");
  expect(root.root.findByProps({ className: "bubu-chat-text" }).props.value).toBe("draft survives");
});
it("still removes private views when the foreground recheck finds revoked consent", async () => {
  await openChat();
  fixture.api.privacyStatus.mockResolvedValue({ consentCurrent: false, guardianCurrent: false });
  await act(async () => { for (const show of [...fixture.show]) show(); });
  expect(root.root.findAllByProps({ ariaLabel: "添加照片" })).toHaveLength(0);
  expect(JSON.stringify(root.toJSON())).toContain("授权");
});

it("authorizes the route baby instead of falling back to the server default", async () => {
  fixture.params = { babyId: "synthetic-baby-2", date: "2026-10-20" };
  fixture.api.getContext.mockResolvedValue({ authenticated: true, identityId: "synthetic-parent", hasBaby: true, baby: { id: "synthetic-baby-2", name: "二号宝宝" }, babies: [] });
  await openChat();
  expect(fixture.api.getContext).toHaveBeenCalledWith("synthetic-baby-2");
  expect(fixture.api.privacyStatus).toHaveBeenCalledWith("synthetic-baby-2");
  expect(fixture.api.getChatHistory).toHaveBeenCalledWith("synthetic-baby-2");
  expect(JSON.stringify(root.toJSON())).toContain("二号宝宝");
  await act(async () => button("AI使用说明").props.onClick());
  expect(JSON.stringify(root.toJSON())).toContain("正在浏览 ");
  expect(JSON.stringify(root.toJSON())).toContain("2026-10-20");
  expect(JSON.stringify(root.toJSON())).toContain("“现在、刚才”按本次说话时间理解");
});

it("returns a safe error when a supplied baby id is invalid", async () => {
  fixture.params = { babyId: "wrong baby" };
  await openChat();
  expect(fixture.api.getContext).not.toHaveBeenCalled();
  expect(fixture.api.privacyStatus).not.toHaveBeenCalled();
  expect(fixture.api.getChatHistory).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain("记录入口缺少有效宝宝");
});

it("does not open private chat data when the supplied baby is forbidden", async () => {
  fixture.params = { babyId: "synthetic-baby-2" };
  fixture.api.getContext.mockRejectedValueOnce(new ApiError(403, "当前宝宝暂不可访问"));
  await openChat();
  expect(fixture.api.privacyStatus).not.toHaveBeenCalled();
  expect(fixture.api.getChatHistory).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain("当前宝宝授权已变化");
});

it("consumes an identity-and-baby-scoped deep link once and does not leak its label into the route", async () => {
  fixture.params = { babyId: "synthetic-baby", date: "2026-10-20", eventId: "event-edit" };
  fixture.pages = [{ route: "pages/index/index" }, { route: "pages/chat/index" }];
  stageChatSelection(
    { eventId: "event-edit", label: "08:00 瓶喂", nonce: 1 },
    { identityId: "synthetic-parent", babyId: "synthetic-baby" },
  );
  await openChat();
  expect(text(root.root.findByProps({ className: "bubu-chat-target-text" }))).toBe("08:00 瓶喂");
  expect(JSON.stringify(fixture.params)).not.toContain("08:00 瓶喂");
  await act(async () => { for (const show of [...fixture.show]) show(); });
  expect(text(root.root.findByProps({ className: "bubu-chat-target-text" }))).toBe("08:00 瓶喂");
  await act(async () => button("返回").props.onClick());
  expect((Taro.navigateBack as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  await act(async () => { root.unmount(); });
  root = undefined as unknown as ReactTestRenderer;
});

it("waits for fresh consent when restoring the same identity and baby", async () => {
  let checked!: (value: { consentCurrent: boolean; guardianCurrent: boolean }) => void;
  fixture.api.privacyStatus.mockImplementation(() => new Promise(resolve => { checked = resolve; }));
  await act(async () => { root = create(<ChatPage />); });
  await act(async () => { for (const show of [...fixture.show]) show(); });
  expect(root.root.findAllByProps({ ariaLabel: "添加照片" })).toHaveLength(0);
  await act(async () => checked({ consentCurrent: true, guardianCurrent: true }));
  expect(root.root.findAllByProps({ ariaLabel: "添加照片" })).toHaveLength(1);
});

it("immediately removes private chat UI when the identity changes", async () => {
  await openChat();
  expect(root.root.findAllByProps({ ariaLabel: "添加照片" })).toHaveLength(1);
  await act(async () => {
    Taro.eventCenter.trigger(identityUpdatedEvent, {
      authenticated: true, identityId: "another-parent", hasBaby: true,
      baby: { id: "another-baby", name: "其他宝宝" }, babies: [],
    });
  });
  expect(root.root.findAllByProps({ ariaLabel: "添加照片" })).toHaveLength(0);
  expect(JSON.stringify(root.toJSON())).toContain("身份或宝宝已变化");
});

it("immediately removes private chat UI on session expiry", async () => {
  await openChat();
  await act(async () => { Taro.eventCenter.trigger(sessionExpiredEvent); });
  expect(root.root.findAllByProps({ ariaLabel: "添加照片" })).toHaveLength(0);
  expect(JSON.stringify(root.toJSON())).toContain("登录已过期");
});

it("can switch from voice back to the keyboard without making a recording", async () => {
  await openChat();
  await act(async () => button("切换语音").props.onClick());
  expect(root.root.findAllByProps({ ariaLabel: "切换键盘" })).toHaveLength(1);
  expect(root.root.findAllByProps({ className: "bubu-chat-text" })).toHaveLength(0);
  await act(async () => button("切换键盘").props.onClick());
  expect(root.root.findAllByProps({ ariaLabel: "切换语音" })).toHaveLength(1);
  expect(root.root.findAllByProps({ className: "bubu-chat-text" })).toHaveLength(1);
});

it("uses one explicit native keyboard inset and removes its listener on unmount", async () => {
  const pending = [{
      kind: "fields", id: "question-1", babyId: "synthetic-baby", eventId: "event-1", version: 1, eventVersion: 1,
      fields: ["durationMinutes", "milkAmount"], conflicts: [], duplicateCandidates: [], state: "open",
      form: {
        eventId: "event-1", eventVersion: 1, questionId: "question-1", questionVersion: 1, title: "BOTTLE", knownSummary: "",
        controls: [
          { field: "durationMinutes", kind: "duration", label: "时长", unit: "minutes", allowUnknown: true },
          { field: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true },
        ],
        progressControl: { field: "progress", kind: "progress", label: "进行状态", options: [] },
        conflictMessages: [], duplicateCandidateIds: [],
      },
    }];
  fixture.api.getChatHistory.mockResolvedValue({ turns: [], automaticMessages: [], pending });
  fixture.api.getPending.mockResolvedValue(pending);
  await openChat();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
  const textarea = root.root.findByProps({ className: "bubu-chat-text" });
  expect(textarea.props.adjustPosition).toBe(false);
  expect(root.root.findAllByProps({ ariaLabel: "时长分钟" })).toHaveLength(0);
  expect(root.root.findAllByProps({ ariaLabel: "实际喝入奶量" })).toHaveLength(0);
  await act(async () => { root.root.findByProps({ ariaLabel: "时长自定义" }).props.onClick(); });
  await act(async () => { root.root.findByProps({ ariaLabel: "实际喝入奶量自定义" }).props.onClick(); });
  const duration = root.root.findByProps({ ariaLabel: "时长分钟" });
  const milk = root.root.findByProps({ ariaLabel: "实际喝入奶量" });
  expect(duration.props.adjustPosition).toBe(false);
  expect(milk.props.adjustPosition).toBe(false);
  const durationAnchor = root.root.find(node => node.props.className === "bubu-chat-form-field" && node.props.id?.endsWith("-durationMinutes")).props.id;
  const milkAnchor = root.root.find(node => node.props.className === "bubu-chat-form-field" && node.props.id?.endsWith("-milkAmount")).props.id;
  expect(fixture.keyboard.size).toBe(1);
  const [keyboardChange] = [...fixture.keyboard];
  await act(async () => { duration.props.onFocus(); keyboardChange({ height: 260 }); });
  const page = root.root.findByProps({ className: "bubu-chat-page keyboard-open" });
  expect(page.props.style).toEqual({ bottom: "260px" });
  expect(root.root.findByProps({ className: "bubu-chat-scroll" }).props.scrollIntoView).toBe(durationAnchor);
  await act(async () => { milk.props.onFocus(); keyboardChange({ height: 261 }); });
  expect(root.root.findByProps({ className: "bubu-chat-scroll" }).props.scrollIntoView).toBe(milkAnchor);
  await act(async () => { milk.props.onBlur(); keyboardChange({ height: 262 }); });
  expect(root.root.findByProps({ className: "bubu-chat-scroll" }).props.scrollIntoView).toBe(milkAnchor);
  await act(async () => { duration.props.onFocus(); textarea.props.onFocus(); keyboardChange({ height: 263 }); });
  expect(root.root.findByProps({ className: "bubu-chat-scroll" }).props.scrollIntoView).toBe(milkAnchor);
  await act(async () => { root.unmount(); });
  root = undefined as unknown as ReactTestRenderer;
  expect(fixture.keyboard.size).toBe(0);
});
