import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { canSend, requestId } from "../src/chat/model";

describe("对话式输入", () => {
  it("首版自动续接记录，不向用户展示会话管理或编号", () => {
    const page = readFileSync("src/pages/chat/index.tsx", "utf8");
    expect(page).toContain("好人阿 J");
    expect(page).toContain("a jOKer");
    expect(page).toContain("我是阿 J");
    expect(page).not.toMatch(/会话|startSession|selectSession|session-list/);
    expect(page).toContain("const latest = rows[rows.length - 1]");
    expect(page).toContain("await readHistory(latest.id)");
  });
  it("H5 只有手机宽度聊天页面，不伪装微信系统界面", () => {
    const page = readFileSync("src/pages/chat/index.tsx", "utf8");
    for (const removed of [
      "miniapp-chrome",
      "home-indicator",
      "preview-heading",
      "preview-footer",
      "9:41",
    ])
      expect(page).not.toContain(removed);
    expect(page).toContain('className="chat-app"');
  });
  it("文字与纯图片都可发送，空输入和执行中不可发送", () => {
    expect(canSend("小番茄红了", [], "platform", "", true, false)).toBe(true);
    expect(
      canSend("", [{ id: 1, src: "image" }], "platform", "", true, false),
    ).toBe(true);
    expect(canSend("  ", [], "platform", "", true, false)).toBe(false);
    expect(canSend("输入", [], "platform", "", true, true)).toBe(false);
    expect(canSend("字".repeat(4001), [], "platform", "", true, false)).toBe(false);
  });
  it("BYOK 不借用平台凭证，外部 Agent 不触发内置生成", () => {
    expect(canSend("输入", [], "byok", "", true, false)).toBe(false);
    expect(canSend("输入", [], "byok", "test-only-key", false, false)).toBe(
      true,
    );
    expect(canSend("输入", [], "platform", "test-only-key", false, false)).toBe(
      false,
    );
    expect(canSend("输入", [], "external", "test-only-key", true, false)).toBe(
      false,
    );
  });
  it("幂等标识是独立的 UUID 格式", () => {
    const ids = Array.from({ length: 100 }, requestId);
    expect(new Set(ids).size).toBe(100);
    ids.forEach((id) =>
      expect(id).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      ),
    );
  });
  it("小程序源码不导入服务端，也不读取平台模型密钥", () => {
    function files(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
        item.isDirectory()
          ? files(path.join(directory, item.name))
          : /\.tsx?$/.test(item.name)
            ? [path.join(directory, item.name)]
            : [],
      );
    }
    for (const file of files("src")) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(
        /from\s+["'](?:@google\/adk|payload|.*\/cms\/|.*\/server\/|.*\/agent\/)/,
      );
      expect(source).not.toContain("process.env.DEEPSEEK_API_KEY");
      expect(source).not.toContain('setStorageSync("apiKey"');
    }
  });
});
