import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ Button: "button", Input: "input", Text: "text", View: "view" }));
const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
const taro = vi.hoisted(() => ({
  getCurrentInstance: vi.fn(() => ({ router: { params: { babyId: "baby-1" } } })),
  navigateBack: vi.fn(),
  eventCenter: {
    on: (name: string, handler: (...args: unknown[]) => void) => { const values = handlers.get(name) ?? new Set(); values.add(handler); handlers.set(name, values); },
    off: (name: string, handler: (...args: unknown[]) => void) => { handlers.get(name)?.delete(handler); },
    trigger: (name: string, ...args: unknown[]) => { handlers.get(name)?.forEach(handler => handler(...args)); },
  },
}));
vi.mock("@tarojs/taro", () => ({ default: taro }));
const getContext = vi.hoisted(() => vi.fn());
const getCarePreferences = vi.hoisted(() => vi.fn());
const updateCarePreferences = vi.hoisted(() => vi.fn());
vi.mock("../src/api", () => ({
  api: { getContext, getCarePreferences, updateCarePreferences },
  ApiError: class ApiError extends Error { constructor(public status: number, text: string, public code?: string) { super(text); } },
}));

import RecordOptionsPage from "../src/pages/record-options/index";
import { identityUpdatedEvent } from "../src/navigation/events";
import type { CarePreferencesView } from "../src/preferences/shared-options";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const preferences = (babyId: string, configuredValues: number[] = [], version = 0): CarePreferencesView => ({ babyId, version, updatedAt: "2026-11-14T00:00:00.000Z", notices: [], semantics: "示例不是事实", options: [{
  key: "BOTTLE.milkAmount", activityType: "BOTTLE", field: "milkAmount", configuredValues, effectiveValues: configuredValues.length ? configuredValues : [60, 90], source: configuredValues.length ? "manual" : "default", version,
  updatedAt: "2026-11-14T00:00:00.000Z", usingExampleFallback: !configuredValues.length, examplesAreFacts: false, examplesAreRecommendations: false,
}] });
const text = (node: unknown): string => typeof node === "string" ? node : node && typeof node === "object" && "children" in node && Array.isArray((node as { children?: unknown[] }).children) ? (node as { children: unknown[] }).children.map(text).join("") : "";
let root: ReactTestRenderer;

const context = (babyId = "baby-1", identityId = "person-1") => ({ authenticated: true, identityId, baby: { id: babyId, name: "甲宝宝" }, babies: [{ id: babyId, name: "甲宝宝" }] });
const button = (label: string) => root.root.findAllByType("button").find(node => text(node).includes(label))!;
const input = (label: string) => root.root.findAllByType("input").find(node => node.props.ariaLabel === label)!;
async function mount(view = preferences("baby-1")) {
  getContext.mockResolvedValue(context());
  getCarePreferences.mockResolvedValue(view);
  await act(async () => { root = create(<RecordOptionsPage />); });
}

beforeEach(() => {
  handlers.clear(); getContext.mockReset(); getCarePreferences.mockReset(); updateCarePreferences.mockReset(); root?.unmount();
  taro.getCurrentInstance.mockReturnValue({ router: { params: { babyId: "baby-1" } } });
});

describe("record options page scope", () => {
  it("validates the route baby before fetching preferences and drops a late old-baby response after identity change", async () => {
    const pending = deferred<CarePreferencesView>();
    getContext.mockResolvedValue({ authenticated: true, identityId: "person-1", baby: { id: "baby-1", name: "甲宝宝" }, babies: [{ id: "baby-1", name: "甲宝宝" }] });
    getCarePreferences.mockReturnValue(pending.promise);
    await act(async () => { root = create(<RecordOptionsPage />); });
    expect(getContext).toHaveBeenCalledWith("baby-1");
    expect(getCarePreferences).toHaveBeenCalledWith("baby-1");

    await act(async () => { taro.eventCenter.trigger(identityUpdatedEvent, { authenticated: true, identityId: "person-1", baby: { id: "baby-2", name: "乙宝宝" }, babies: [{ id: "baby-2", name: "乙宝宝" }] }); });
    await act(async () => { pending.resolve(preferences("baby-1")); });
    expect(text(root.toJSON())).not.toContain("甲宝宝");
    expect(text(root.toJSON())).toContain("身份或宝宝已变化");
    expect(updateCarePreferences).not.toHaveBeenCalled();
  });

  it("rejects a blank add instead of turning it into zero", async () => {
    updateCarePreferences.mockImplementation(async request => ({ kind: "care_preferences_changed", requestId: request.requestId, version: 1,
      updatedAt: "2026-11-14T00:01:00.000Z", changedKeys: ["BOTTLE.milkAmount"], text: "已保存，全家共用", preferences: preferences("baby-1", [120], 1) }));
    await mount();
    const add = button("添加");
    expect(add.props.disabled).toBe(true);
    await act(async () => { add.props.onClick(); });
    expect(text(root.toJSON())).toContain("请先填写瓶喂奶量");
    await act(async () => { input("添加瓶喂奶量").props.onInput({ detail: { value: "120" } }); });
    await act(async () => { button("添加").props.onClick(); });
    await act(async () => { button("保存 1 项修改").props.onClick(); });
    expect(updateCarePreferences).toHaveBeenCalledWith(expect.objectContaining({ updates: [{ key: "BOTTLE.milkAmount", values: [120] }] }));
    expect(JSON.stringify(updateCarePreferences.mock.calls)).not.toContain('"values":[0]');
  });

  it("locks every editor control while saving so a late receipt cannot discard edits", async () => {
    const pending = deferred<unknown>();
    updateCarePreferences.mockReturnValue(pending.promise);
    await mount(preferences("baby-1", [90]));
    await act(async () => { input("添加瓶喂奶量").props.onInput({ detail: { value: "120" } }); });
    await act(async () => { button("添加").props.onClick(); });
    await act(async () => { button("保存 1 项修改").props.onClick(); await Promise.resolve(); });

    expect(input("瓶喂奶量第1项").props.disabled).toBe(true);
    expect(input("添加瓶喂奶量").props.disabled).toBe(true);
    for (const label of ["奶量", "瓶喂奶量", "删除", "添加"]) expect(button(label).props.disabled).toBe(true);

    await act(async () => { pending.resolve({ kind: "care_preferences_changed", requestId: "saved", version: 1,
      updatedAt: "2026-11-14T00:01:00.000Z", changedKeys: ["BOTTLE.milkAmount"], text: "已保存，全家共用", preferences: preferences("baby-1", [90, 120], 1) }); });
    expect(text(root.toJSON())).toContain("已保存，全家共用");
    expect(input("瓶喂奶量第2项").props.value).toBe("120");
  });

  it("keeps the draft for a same-scope identity refresh and clears it for an actual scope change", async () => {
    updateCarePreferences.mockImplementation(async request => ({ kind: "care_preferences_changed", requestId: request.requestId, version: 1,
      updatedAt: "2026-11-14T00:01:00.000Z", changedKeys: ["BOTTLE.milkAmount"], text: "已保存，全家共用", preferences: preferences("baby-1", [120], 1) }));
    await mount();
    await act(async () => { input("添加瓶喂奶量").props.onInput({ detail: { value: "120" } }); });
    await act(async () => { button("添加").props.onClick(); });
    await act(async () => { taro.eventCenter.trigger(identityUpdatedEvent, context()); });
    expect(text(root.toJSON())).not.toContain("身份或宝宝已变化");
    await act(async () => { button("保存 1 项修改").props.onClick(); });
    expect(updateCarePreferences).toHaveBeenCalledWith(expect.objectContaining({ updates: [{ key: "BOTTLE.milkAmount", values: [120] }] }));

    await act(async () => { taro.eventCenter.trigger(identityUpdatedEvent, context("baby-2")); });
    expect(text(root.toJSON())).toContain("身份或宝宝已变化");
  });
});
