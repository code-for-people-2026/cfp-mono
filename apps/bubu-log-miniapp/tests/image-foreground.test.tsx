import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyRecordSummary } from "./fixtures/records";

const fixture = vi.hoisted(() => {
  process.env.TARO_ENV = "weapp";
  Object.assign(globalThis, { BUBU_API_ORIGIN: "https://synthetic.invalid" });
  return { show: new Set<() => void>(), storage: new Map(), api: {
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
      useEffect(() => { const invoke = () => latest.current(); fixture.show.add(invoke); return () => { fixture.show.delete(invoke); }; }, []);
    },
    default: {
      eventCenter: { on: vi.fn(), off: vi.fn() },
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
vi.mock("../src/privacy/SafetyNotices", () => ({ SafetyNotices: () => null }));
vi.mock("../src/privacy/PrivacyCenter", () => ({ PrivacyCenter: () => <div>permission-needed</div>, Choice: () => null, PolicyDocuments: () => null }));
vi.mock("../src/chat/sheet-portal", () => ({ SheetPortal: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../src/components", () => Object.fromEntries(["ActivityDetail", "DayTimeline", "Heatmap", "TrendCharts", "WeekCalendar"].map(key => [key, () => null])));
import DiaryPage from "../src/pages/index/index";

let root: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks(); fixture.storage.clear(); fixture.show.clear();
  fixture.api.getContext.mockResolvedValue({ authenticated: true, identityId: "synthetic-parent", hasBaby: true, baby: { id: "synthetic-baby", name: "测试宝宝" }, babies: [{ id: "synthetic-baby", name: "测试宝宝" }] });
  fixture.api.privacyPolicy.mockResolvedValue({ ready: true, documents: [] });
  fixture.api.privacyStatus.mockResolvedValue({ consentCurrent: true, guardianCurrent: true });
  fixture.api.getSnapshot.mockResolvedValue({ activities: [], summary: emptyRecordSummary() });
  fixture.api.getActivities.mockResolvedValue({ activities: [], complete: true });
  fixture.api.getLatestActivity.mockResolvedValue(null);
  fixture.api.getChatHistory.mockResolvedValue({ turns: [], pending: [] });
  fixture.api.getPending.mockResolvedValue([]); fixture.api.getSyncStatus.mockResolvedValue([]);
  fixture.api.uploadAttachment.mockResolvedValue({ id: "synthetic-image" });
  fixture.api.resolvePhotoUrl.mockResolvedValue("local-synthetic-preview");
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });
const button = (label: string) => root.root.findByProps({ ariaLabel: label });
async function openChat() {
  await act(async () => { root = create(<DiaryPage />); });
  await act(async () => button("打开对话").props.onClick());
}
it("keeps an in-flight native image selection and its preview when onShow fires on picker return", async () => {
  await openChat();
  let selected!: (value: { tempFilePaths: string[] }) => void;
  fixture.picker.mockImplementation(() => new Promise(resolve => { selected = resolve; }));
  await act(async () => button("添加照片").props.onClick());
  await act(async () => { for (const show of [...fixture.show]) show(); });
  await act(async () => selected({ tempFilePaths: ["synthetic.png"] }));
  expect(fixture.api.uploadAttachment).toHaveBeenCalledOnce();
  expect(root.root.findAllByProps({ src: "local-synthetic-preview" })).toHaveLength(1);
  expect(button("发送消息").props.disabled).toBeFalsy();
});
it("still removes private views when the foreground recheck finds revoked consent", async () => {
  await openChat();
  fixture.api.privacyStatus.mockResolvedValue({ consentCurrent: false, guardianCurrent: false });
  await act(async () => { for (const show of [...fixture.show]) show(); });
  expect(root.root.findAllByProps({ ariaLabel: "添加照片" })).toHaveLength(0);
  expect(JSON.stringify(root.toJSON())).toContain("permission-needed");
});

it("waits for fresh consent when restoring the same identity and baby", async () => {
  await openChat();
  let checked!: (value: { consentCurrent: boolean; guardianCurrent: boolean }) => void;
  fixture.api.privacyStatus.mockImplementation(() => new Promise(resolve => { checked = resolve; }));
  // A session expiry must invalidate cached readiness even for the same account.
  await act(async () => root.root.findByProps({ "aria-label": "logout-context" }).props.onClick());
  await act(async () => root.root.find(node => typeof node.type === "string" && node.props.children === "重新连接").props.onClick());
  expect(root.root.findAllByProps({ ariaLabel: "打开对话" })).toHaveLength(0);
  await act(async () => checked({ consentCurrent: true, guardianCurrent: true }));
  expect(root.root.findAllByProps({ ariaLabel: "打开对话" })).toHaveLength(1);
});
