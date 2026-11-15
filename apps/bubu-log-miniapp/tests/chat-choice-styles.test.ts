import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("choice form narrow layout", () => {
  it("wraps compact choices without adding horizontal scrolling", () => {
    const css = readFileSync(new URL("../src/chat/chat.css", import.meta.url), "utf8");
    const rule = css.match(/\.bubu-chat-choice-row\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("display: flex");
    expect(rule).toContain("flex-wrap: wrap");
    expect(rule).toContain("min-width: 0");
    expect(rule).not.toContain("overflow-x");
    expect(css).not.toMatch(/\.bubu-chat-choice-row[^}]*overflow-x\s*:\s*(auto|scroll)/);
  });
});
