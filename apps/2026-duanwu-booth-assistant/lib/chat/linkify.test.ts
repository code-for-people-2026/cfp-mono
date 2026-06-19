import { describe, expect, it } from "vitest";
import { linkifyAssistantMarkdown } from "./linkify";

describe("linkifyAssistantMarkdown", () => {
  it("wraps a bare URL that is immediately followed by CJK so the link does not absorb the sentence", () => {
    const input = "官网是：https://www.codeforpeople.cn/。上面有《数据平权宣言》。";

    const output = linkifyAssistantMarkdown(input);

    expect(output).toContain("[https://www.codeforpeople.cn/](https://www.codeforpeople.cn/)");
    // The CJK after the URL stays outside the link.
    expect(output).toContain(")。上面有《数据平权宣言》");
  });

  it("keeps sentence punctuation outside the link", () => {
    const output = linkifyAssistantMarkdown("see https://example.com/path.");

    expect(output).toBe("see [https://example.com/path](https://example.com/path).");
  });

  it("does not double-wrap an existing markdown link", () => {
    const input = "[官网](https://www.codeforpeople.cn/)";

    expect(linkifyAssistantMarkdown(input)).toBe(input);
  });

  it("leaves angle-bracket autolinks alone", () => {
    const input = "<https://www.codeforpeople.cn/>";

    expect(linkifyAssistantMarkdown(input)).toBe(input);
  });

  it("handles multiple bare URLs in one message", () => {
    const input = "看 https://a.example.cn/ 和 https://b.example.cn/。";

    const output = linkifyAssistantMarkdown(input);

    expect(output).toContain("[https://a.example.cn/](https://a.example.cn/)");
    expect(output).toContain("[https://b.example.cn/](https://b.example.cn/)");
  });

  it("leaves text without URLs unchanged", () => {
    const input = "官网在“继续了解”里。";

    expect(linkifyAssistantMarkdown(input)).toBe(input);
  });
});
