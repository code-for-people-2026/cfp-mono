import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { RunProgress } from "@cfp/base-chat-protocol";
import { LoadingCarousel } from "../src/chat/loading-carousel";

vi.mock("@tarojs/components", () => ({
  Text: "text",
}));

function progress(stageId?: string, step = ""): RunProgress {
  return { text: "", messages: [], step, ...(stageId ? { stageId } : {}) };
}

function carousel(progress: RunProgress, resetKey = 1) {
  return createElement(LoadingCarousel, { progress, resetKey });
}

function render(component: ReturnType<typeof carousel>) {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(component);
  });
  if (!renderer) throw new Error("renderer not created");
  return renderer;
}

function copy(renderer: TestRenderer.ReactTestRenderer) {
  const text = renderer.root.findByType("text");
  return String(text.props.children);
}

describe("AJ loading carousel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rotates only inside a known actual stage and occasionally shows a tip", () => {
    const renderer = render(carousel(progress("generating"), 1));
    expect(copy(renderer)).toBe("正在把你刚才说的几件事理一理");
    act(() => { vi.advanceTimersByTime(4000); });
    expect(copy(renderer)).toBe("正在换个角度看看有没有遗漏");
    act(() => { vi.advanceTimersByTime(8000); });
    expect(copy(renderer)).toBe("不用组织好语言，从眼前的一件小事说起就行");
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(copy(renderer)).toBe("想知道回答参考了什么，可以点开末尾的回应依据");
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(copy(renderer)).toBe("阿 J 和这里的专家都是 AI，也可能理解错你的意思");
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(copy(renderer)).toBe("这里的建议供你参考，怎么选择，由你决定");
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(copy(renderer)).toBe("这里的交流不能替代专业诊断或治疗");
    act(() => { vi.advanceTimersByTime(4000); });
    expect(copy(renderer)).toBe("正在把你刚才说的几件事理一理");
    act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets on a new request and stage without claiming expert handoff during continuation", () => {
    const renderer = render(carousel(progress("generating"), 1));
    act(() => { vi.advanceTimersByTime(3_500); });
    act(() => {
      renderer.update(
        carousel(progress("generating"), 2),
      );
    });
    expect(copy(renderer)).toBe("正在把你刚才说的几件事理一理");
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(copy(renderer)).toBe("正在把你刚才说的几件事理一理");
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(copy(renderer)).toBe("正在换个角度看看有没有遗漏");
    act(() => {
      renderer.update(
      carousel(progress("expert_working"), 1),
      );
    });
    expect(copy(renderer)).toBe("专家正在接着你刚才的话往下想");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("邀请");
    act(() => {
      renderer.update(
      carousel(progress("expert_working"), 2),
      );
    });
    expect(copy(renderer)).toBe("专家正在接着你刚才的话往下想");
  });

  it("never replaces streamed text and preserves the precise unknown producer step", () => {
    const streamed = progress("generating");
    streamed.text = "流式返回的半句话";
    const renderer = render(carousel(streamed, 1));
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(copy(renderer)).toBe("流式返回的半句话");

    act(() => {
      renderer.update(
        carousel(progress(undefined, "图片已生成，正在审核和保存"), 1),
      );
    });
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(copy(renderer)).toBe("图片已生成，正在审核和保存");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("only uses form copy when the producer actually reports a form render", () => {
    const generic = render(carousel(progress("render"), 1));
    expect(copy(generic)).toBe("阿 J 先生正在准备回应作品");
    expect(JSON.stringify(generic.toJSON())).not.toContain("小卡片");
    act(() => generic.unmount());

    const form = render(carousel(progress("form_render"), 1));
    expect(copy(form)).toBe("正在把回应整理成可以直接填写的小卡片");
    act(() => form.unmount());
  });

  it("integrates the carousel and keeps only gate/preview footnotes", () => {
    const page = readFileSync("src/pages/chat/index.tsx", "utf8");
    expect(page).toContain("<LoadingCarousel");
    expect(page).toContain('import { LoadingCarousel } from "../../chat/loading-carousel"');
    expect(page).not.toContain("好意不是对未来的保证");
    expect(page).toContain("本次预览体验登录与年龄确认，暂不开放聊天");
    expect(page).toContain("使用前请在设置 → 隐私与数据中确认授权");
  });
});
