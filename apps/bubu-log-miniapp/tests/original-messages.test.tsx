import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ Button: "button", Image: "image", Text: "text", View: "view" }));

const getEventSources = vi.hoisted(() => vi.fn());
const resolvePhotoUrl = vi.hoisted(() => vi.fn());
const releasePhotoUrl = vi.hoisted(() => vi.fn());
vi.mock("../src/api", () => ({
  api: { getEventSources, resolvePhotoUrl, releasePhotoUrl },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
  },
}));

import { ApiError } from "../src/api";
import { OriginalMessages } from "../src/chat/OriginalMessages";
import type { EventSources } from "../src/chat/contracts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function source(babyId = "baby-1", eventId = "event-1"): EventSources {
  return {
    babyId,
    eventId,
    unavailableCount: 1,
    messages: [
      { id: "message-1", kind: "wechat", senderId: "sender-a", senderName: "妈妈", senderAvatarUrl: "https://images.example.test/mama.png", sentAt: "2026-11-13T12:01:00.000Z", text: "第一行\n第二行，保留完整原文。" },
      { id: "message-2", kind: "chat", senderId: null, sentAt: "2026-11-13T12:02:00.000Z", text: null },
    ],
  };
}

let root: ReactTestRenderer;
const onRevoked = vi.fn();
const nodeText = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray((node as { children?: unknown[] }).children)) return "";
  return (node as { children: unknown[] }).children.map(nodeText).join("");
};
const buttonText = (label: string) => {
  const match = root.root.findAll(node => node.type === "button" && nodeText(node) === label);
  if (match.length !== 1) throw new Error(`expected one ${label}, found ${match.length}`);
  return match[0]!;
};
const texts = (className: string) => root.root.findAll(node => node.props.className === className).map(nodeText);
const hasBody = () => root.root.findAll(node => node.props.className === "bubu-chat-original-body").length > 0;

function render(babyId = "baby-1", eventId = "event-1") {
  root = create(<OriginalMessages babyId={babyId} eventId={eventId} onRevoked={onRevoked} />);
}
const rerender = (babyId = "baby-1", eventId = "event-1") => root.update(<OriginalMessages babyId={babyId} eventId={eventId} onRevoked={onRevoked} />);

beforeEach(() => {
  getEventSources.mockReset();
  resolvePhotoUrl.mockReset(); releasePhotoUrl.mockReset();
  onRevoked.mockClear();
  root?.unmount();
});

describe("OriginalMessages", () => {
  it("does not fetch while collapsed, then renders multiple senders and full text after expansion", async () => {
    getEventSources.mockResolvedValue(source());
    await act(async () => { render(); });
    expect(getEventSources).not.toHaveBeenCalled();

    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(getEventSources).toHaveBeenCalledWith("baby-1", "event-1");
    expect(texts("bubu-chat-original-meta")).toEqual([
      "妈妈 · 2026-11-13 20:01",
      "发送人 · 2026-11-13 20:02",
    ]);
    expect(root.root.findAllByType("image").map(node => node.props.src)).toEqual(["https://images.example.test/mama.png"]);
    expect(texts("bubu-chat-original-avatar-fallback")).toEqual(["发"]);
    expect(texts("bubu-chat-original-text")).toEqual([
      "第一行\n第二行，保留完整原文。",
      "未保存这条消息的原文",
    ]);
    expect(texts("bubu-chat-original-status")).toEqual(["1 条原消息未保存原文。"]);
  });

  it("labels simulated test messages, keeps chronology, and uses nickname initials", async () => {
    getEventSources.mockResolvedValue({
      babyId: "baby-1", eventId: "event-1", unavailableCount: 0,
      messages: [
        { id: "test-1", kind: "test", label: "测试记录 · 模拟消息", senderId: "acceptance-test:aunt", senderName: "阿姨（测试）", sentAt: "2026-11-14T00:00:00.000Z", text: "刚给宝宝喂完奶粉。" },
        { id: "test-2", kind: "test", label: "测试记录 · 模拟消息", senderId: "acceptance-test:dad", senderName: "爸爸（测试）", sentAt: "2026-11-14T00:01:00.000Z", text: "奶瓶已经洗好了。" },
      ],
    } satisfies EventSources);
    await act(async () => { render(); });
    expect(getEventSources).not.toHaveBeenCalled();
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(texts("bubu-chat-original-meta")).toEqual([
      "测试记录 · 模拟消息 · 阿姨（测试） · 2026-11-14 08:00",
      "测试记录 · 模拟消息 · 爸爸（测试） · 2026-11-14 08:01",
    ]);
    expect(texts("bubu-chat-original-avatar-fallback")).toEqual(["阿", "爸"]);
    expect(texts("bubu-chat-original-text")).toEqual(["刚给宝宝喂完奶粉。", "奶瓶已经洗好了。"]);
  });

  it("resolves a protected same-baby avatar and falls back to an initial after image failure", async () => {
    const protectedUrl = "/api/app/media/activities/avatar-1?babyId=baby-1";
    getEventSources.mockResolvedValue({ ...source(), messages: [{ ...source().messages[0]!, senderAvatarUrl: protectedUrl }] });
    resolvePhotoUrl.mockResolvedValue("/tmp/protected-avatar");
    await act(async () => { render(); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(resolvePhotoUrl).toHaveBeenCalledWith(protectedUrl, "baby-1");
    const avatar = root.root.findByType("image");
    expect(avatar.props.src).toBe("/tmp/protected-avatar");
    await act(async () => avatar.props.onError());
    expect(root.root.findAllByType("image")).toHaveLength(0);
    expect(texts("bubu-chat-original-avatar-fallback")).toEqual(["妈"]);
  });

  it("shows a clear message when an event has no displayable source messages", async () => {
    getEventSources.mockResolvedValue({ ...source(), messages: [], unavailableCount: 0 });
    await act(async () => { render(); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(texts("bubu-chat-original-status")).toEqual(["这条记录暂无可展示的原消息。"]);
  });

  it("never exposes sender ids or internal-looking sender names", async () => {
    getEventSources.mockResolvedValue({ ...source(), messages: [{ ...source().messages[0]!, senderId: "wxid_private", senderName: "wxid_private", senderAvatarUrl: undefined }] });
    await act(async () => { render(); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(texts("bubu-chat-original-meta")).toEqual(["发送人 · 2026-11-13 20:01"]);
    expect(nodeText(root.toJSON())).not.toContain("wxid_private");
  });

  it("collapses during loading, ignores a stale completion, and fetches again after reopening", async () => {
    const first = deferred<EventSources>();
    getEventSources.mockReturnValueOnce(first.promise).mockResolvedValueOnce(source());
    await act(async () => { render(); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(texts("bubu-chat-original-status")).toEqual(["正在读取原消息…"]);
    expect(buttonText("收起原消息").props.disabled).toBeFalsy();

    await act(async () => { buttonText("收起原消息").props.onClick(); });
    expect(hasBody()).toBe(false);
    await act(async () => { first.resolve(source()); });
    expect(hasBody()).toBe(false);

    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(getEventSources).toHaveBeenCalledTimes(2);
  });

  it("ignores a completion that resolves after unmount", async () => {
    const pending = deferred<EventSources>();
    getEventSources.mockReturnValueOnce(pending.promise);
    await act(async () => { render(); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    await act(async () => { root.unmount(); });
    await act(async () => { pending.resolve(source()); });
    expect(root.toJSON()).toBeNull();
  });

  it("collapses and ignores the old baby when the requested identity changes", async () => {
    const first = deferred<EventSources>(), second = deferred<EventSources>();
    getEventSources.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await act(async () => { render("baby-1"); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });

    await act(async () => { rerender("baby-2"); });
    expect(hasBody()).toBe(false);
    await act(async () => { first.resolve(source("baby-1")); });
    expect(hasBody()).toBe(false);

    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(getEventSources).toHaveBeenNthCalledWith(2, "baby-2", "event-1");
    await act(async () => { second.resolve(source("baby-2")); });
    expect(texts("bubu-chat-original-message")).toHaveLength(2);
  });

  it("shows an error and retries on demand", async () => {
    getEventSources.mockRejectedValueOnce(new Error("原消息暂时无法读取")).mockResolvedValueOnce(source());
    await act(async () => { render(); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(texts("bubu-chat-original-error")).toEqual(["原消息暂时无法读取"]);

    await act(async () => { buttonText("重试").props.onClick(); });
    expect(getEventSources).toHaveBeenCalledTimes(2);
    expect(texts("bubu-chat-original-error")).toEqual([]);
    expect(texts("bubu-chat-original-message")).toHaveLength(2);
  });

  it.each([
    [401, "登录已过期"],
    [403, "已撤权"],
  ])("reports authorization failure for a %i response", async (status, message) => {
    getEventSources.mockRejectedValueOnce(new ApiError(status, message));
    await act(async () => { render(); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(onRevoked).toHaveBeenCalledTimes(1);
    expect(onRevoked).toHaveBeenCalledWith(expect.objectContaining({ status }));
    expect(texts("bubu-chat-original-error")).toEqual([message]);
  });
});
