import { describe, expect, it } from "vitest";
import { linkifyAssistantMarkdown } from "./linkify";

describe("linkifyAssistantMarkdown (website)", () => {
  it("turns a bare internal doc path into a clickable markdown link", () => {
    const output = linkifyAssistantMarkdown("可以读《牛马互助协议》全文：/license。");

    expect(output).toContain("[/license](/license)");
    expect(output).toContain(")。");
  });

  it("links a bare internal path at the very start of the message", () => {
    expect(linkifyAssistantMarkdown("/manifesto 是宣言全文。")).toContain("[/manifesto](/manifesto)");
  });

  it("turns the bare /wam matrix path into a clickable markdown link", () => {
    const output = linkifyAssistantMarkdown("看牛马能力剥夺矩阵：/wam。");

    expect(output).toContain("[/wam](/wam)");
    expect(output).toContain(")。");
  });

  it("does not mistake a fraction like 1/3 for a link", () => {
    const input = "工友价是市场价的 1/3。";

    expect(linkifyAssistantMarkdown(input)).toBe(input);
  });

  it("does not touch an internal path already inside a markdown link", () => {
    const input = "[《牛马互助协议》全文](/license)";

    expect(linkifyAssistantMarkdown(input)).toBe(input);
  });

  it("does not link a longer path that merely starts with a known route", () => {
    const input = "/licenses 和 /license/extra 都不是规范路径。";

    expect(linkifyAssistantMarkdown(input)).toBe(input);
  });

  it("wraps a bare URL so it does not absorb the following CJK sentence", () => {
    const output = linkifyAssistantMarkdown("详情在 https://www.codeforpeople.cn/。上面有全文。");

    expect(output).toContain("[https://www.codeforpeople.cn/](https://www.codeforpeople.cn/)");
    expect(output).toContain(")。上面有全文");
  });

  it("leaves a URL that already contains an internal route untouched by the path pass", () => {
    const output = linkifyAssistantMarkdown("见 https://www.codeforpeople.cn/license 。");

    // The URL is wrapped once; /license inside it must not be re-wrapped.
    expect(output).toContain("[https://www.codeforpeople.cn/license](https://www.codeforpeople.cn/license)");
    expect(output).not.toContain("/[/license]");
  });

  it("leaves plain text without links unchanged", () => {
    const input = "项目还在早期，不要声称已经代表工友。";

    expect(linkifyAssistantMarkdown(input)).toBe(input);
  });
});
