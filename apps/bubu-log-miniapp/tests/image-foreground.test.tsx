import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyRecordSummary } from "./fixtures/records";

const fixture = vi.hoisted(() => {
  process.env.TARO_ENV = "weapp";
  Object.assign(globalThis, { BUBU_API_ORIGIN: "https://synthetic.invalid" });
  return { appShow: new Set<() => void>(), pageShow: new Set<() => void>(), windowResize: new Set<() => void>(), storage: new Map(), api: {
    getContext: vi.fn(), logout: vi.fn(), privacyPolicy: vi.fn(), privacyStatus: vi.fn(), getSnapshot: vi.fn(),
    getActivities: vi.fn(), getLatestActivity: vi.fn(), getChatHistory: vi.fn(), getPending: vi.fn(),
    getSyncStatus: vi.fn(), uploadAttachment: vi.fn(), resolvePhotoUrl: vi.fn(), releasePhotoUrl: vi.fn(),
  }, picker: vi.fn() };
});
vi.mock("@tarojs/taro", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useDidShow: (callback: () => void) => {
      const latest = useRef(callback); latest.current = callback;
      useEffect(() => { const invoke = () => latest.current(); fixture.pageShow.add(invoke); return () => { fixture.pageShow.delete(invoke); }; }, []);
    },
    default: {
      eventCenter: { on: vi.fn(), off: vi.fn() },
      nextTick: (callback: () => void) => { callback(); },
      createSelectorQuery: () => {
        const query: Record<string, unknown> = {};
        query.select = () => query;
        query.boundingClientRect = () => query;
        query.node = () => query;
        query.exec = () => [];
        return query;
      },
      onAppShow: (callback: () => void) => { fixture.appShow.add(callback); return callback; },
      offAppShow: (callback: () => void) => fixture.appShow.delete(callback),
      onWindowResize: (callback: () => void) => { fixture.windowResize.add(callback); return callback; },
      offWindowResize: (callback: () => void) => fixture.windowResize.delete(callback),
      getStorageSync: (key: string) => fixture.storage.get(key),
      setStorageSync: (key: string, value: unknown) => fixture.storage.set(key, value),
      removeStorageSync: (key: string) => fixture.storage.delete(key),
      requirePrivacyAuthorize: async () => {}, chooseImage: fixture.picker,
      getFileSystemManager: () => ({
        readFile: ({ success }: { success(value: { data: ArrayBuffer }): void }) => success({ data: new Uint8Array([137,80,78,71,13,10,26,10]).buffer }),
        unlink: vi.fn(),
      }),
      getWindowInfo: () => ({ windowHeight: 800 }),
    },
  };
});
vi.mock("@tarojs/components", () => Object.fromEntries(["Button", "Image", "ScrollView", "Text", "Textarea", "View", "Input", "Picker", "Switch"].map(key => [key, key])));
vi.mock("../src/api", async () => ({ ...await import("../src/api/client"), api: fixture.api, identityEnabled: true, wechatIdentityEnabled: true }));
// Only unrelated presentation is replaced. The page, DiaryChat, ChatSession,
// image chooser, draft store and foreground lifecycle below are production code.
vi.mock("../src/navigation/DiaryNavigation", () => ({ DiaryNavigation: ({ onLogout }: { onLogout?: () => void }) => onLogout ? <button aria-label="logout-context" onClick={onLogout} /> : null }));
vi.mock("../src/chat/sheet-portal", () => ({ SheetPortal: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../src/components", () => Object.fromEntries(["ActivityDetail", "DayTimeline", "Heatmap", "TrendCharts", "WeekCalendar"].map(key => [key, () => null])));
import DiaryPage from "../src/pages/index/index";

let root: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks(); fixture.storage.clear(); fixture.appShow.clear(); fixture.pageShow.clear(); fixture.windowResize.clear();
  fixture.api.getContext.mockResolvedValue({ authenticated: true, identityId: "synthetic-parent", hasBaby: true, baby: { id: "synthetic-baby", name: "测试宝宝" }, babies: [{ id: "synthetic-baby", name: "测试宝宝" }] });
  fixture.api.privacyPolicy.mockResolvedValue({ ready: true, documents: [] });
  fixture.api.privacyStatus.mockResolvedValue({ consentCurrent: true, guardianCurrent: true });
  fixture.api.getSnapshot.mockResolvedValue({ activities: [], summary: emptyRecordSummary() });
  fixture.api.getActivities.mockResolvedValue({ activities: [], complete: true });
  fixture.api.getLatestActivity.mockResolvedValue(null);
  fixture.api.getChatHistory.mockResolvedValue({ turns: [], pending: [] });
  fixture.api.getPending.mockResolvedValue([]); fixture.api.getSyncStatus.mockResolvedValue([]);
  fixture.api.uploadAttachment.mockResolvedValue({ id: `att_${"a".repeat(64)}` });
  fixture.api.resolvePhotoUrl.mockResolvedValue("local-synthetic-preview");
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  expect(fixture.appShow.size).toBe(0); expect(fixture.pageShow.size).toBe(0); expect(fixture.windowResize.size).toBe(0);
});
const button = (label: string) => root.root.findByProps({ ariaLabel: label });
async function openChat() {
  await act(async () => { root = create(<DiaryPage />); });
  await act(async () => button("打开对话").props.onClick());
}
it("keeps an in-flight native image selection and its preview when onShow fires on picker return", async () => {
  await openChat();
  const draft = "刚换尿布，照片稍后补充";
  const textarea = root.root.findByProps({ placeholder: "记下刚才发生的事…" });
  await act(async () => textarea.props.onInput({ detail: { value: draft } }));
  let selected!: (value: { tempFilePaths: string[] }) => void;
  fixture.picker.mockImplementation(() => new Promise(resolve => { selected = resolve; }));
  await act(async () => button("添加照片").props.onClick());
  await act(async () => {
    for (const show of [...fixture.appShow, ...fixture.pageShow]) show();
  });
  await act(async () => selected({ tempFilePaths: ["synthetic.png"] }));
  expect(fixture.api.uploadAttachment).toHaveBeenCalledOnce();
  expect(root.root.findAllByProps({ src: "local-synthetic-preview" })).toHaveLength(1);
  expect(root.root.findByProps({ placeholder: "记下刚才发生的事…" }).props.value).toBe(draft);
  expect(JSON.stringify([...fixture.storage.values()])).toContain(draft);
  expect(button("发送消息").props.disabled).toBeFalsy();
});
