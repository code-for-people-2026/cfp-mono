import { afterEach, expect, it, vi } from "vitest";
import { installAiCopyLabels } from "../src/chat/ai-copy";
afterEach(() => { vi.unstubAllGlobals(); });
it.each([true, false, null])("网页选择复制保留 AI 来源，用户原文不加标签（%s）", (external) => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const source = { closest: vi.fn(() => external ? {} : null) };
  const target = { nodeType: 1, closest: vi.fn((selector: string) => selector.startsWith('[data-ai-generated') && external !== null ? source : null) };
  vi.stubGlobal("document", {
    addEventListener, removeEventListener,
    getSelection: () => ({ isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ commonAncestorContainer: target }), toString: () => "选择的文字" }),
  });
  const cleanup = installAiCopyLabels();
  const setData = vi.fn(), preventDefault = vi.fn();
  addEventListener.mock.calls[0][1]({ clipboardData: { setData }, preventDefault });
  if (external === null) { expect(setData).not.toHaveBeenCalled(); expect(preventDefault).not.toHaveBeenCalled(); }
  else {
    expect(setData).toHaveBeenCalledWith("text/plain", `AI 生成${external ? "（外部客户端声明）" : ""} · 阿 Q 先生\n选择的文字`);
    expect(preventDefault).toHaveBeenCalledOnce();
  }
  cleanup(); expect(removeEventListener).toHaveBeenCalledWith("copy", addEventListener.mock.calls[0][1]);
});

it.each(["平台回复 + 外部回复", "用户消息 + 助手回复", "跨轮次回复"])("跨来源选择保留浏览器原始复制：%s", () => {
  const addEventListener = vi.fn();
  const common = { nodeType: 1, closest: () => null }; // conversation wrapper, outside each bubble
  vi.stubGlobal("document", {
    addEventListener, removeEventListener: vi.fn(),
    getSelection: () => ({ isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ commonAncestorContainer: common }), toString: () => "混合来源文字" }),
  });
  installAiCopyLabels();
  const setData = vi.fn(), preventDefault = vi.fn();
  addEventListener.mock.calls[0][1]({ clipboardData: { setData }, preventDefault });
  expect(setData).not.toHaveBeenCalled(); expect(preventDefault).not.toHaveBeenCalled();
});
it("作品内用户填写字段不加 AI 标签", () => {
  const addEventListener = vi.fn();
  const input = { nodeType: 1, closest: () => ({}) };
  vi.stubGlobal("document", {
    addEventListener, removeEventListener: vi.fn(),
    getSelection: () => ({ isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ commonAncestorContainer: input }) }),
  });
  installAiCopyLabels();
  const setData = vi.fn(), preventDefault = vi.fn();
  addEventListener.mock.calls[0][1]({ clipboardData: { setData }, preventDefault });
  expect(setData).not.toHaveBeenCalled(); expect(preventDefault).not.toHaveBeenCalled();
});
