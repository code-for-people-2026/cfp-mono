import { afterEach, expect, it, vi } from "vitest";
import { installAiCopyLabels } from "../src/chat/ai-copy";
afterEach(() => { vi.unstubAllGlobals(); });
it.each([true, false, null])("网页选择复制保留 AI 来源，用户原文不加标签（%s）", (external) => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const target = { closest: vi.fn(() => external ? {} : null) };
  vi.stubGlobal("document", {
    addEventListener, removeEventListener,
    getSelection: () => ({ isCollapsed: false, getRangeAt: () => ({ intersectsNode: () => true }), toString: () => "选择的文字" }),
    querySelectorAll: () => external === null ? [] : [target],
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
