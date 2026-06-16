import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("style system", () => {
  it("tracks the website light and dark color system", () => {
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain("--bg: #f7f9fc");
    expect(css).toContain("--paper: #fffefa");
    expect(css).toContain("--soft: #eef3f7");
    expect(css).toContain("--ink: #101417");
    expect(css).toContain("--bg: #07090d");
    expect(css).toContain("--paper: #101722");
    expect(css).toContain("--ink: #f6f7f2");
  });

  it("does not use red and green as the main chat contrast", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const topStripBlock = css.match(/\.app-shell::before\s*{[^}]+}/)?.[0] ?? "";
    const assistantBlock = css.match(/\.message-assistant\s*{[^}]+}/)?.[0] ?? "";
    const userBlock = css.match(/\.message-user\s*{[^}]+}/)?.[0] ?? "";

    expect(topStripBlock).toContain("var(--gold-bright)");
    expect(topStripBlock).toContain("var(--cyan)");
    expect(topStripBlock).not.toContain("var(--green)");
    expect(assistantBlock).not.toContain("border-left: 3px solid var(--accent)");
    expect(userBlock).not.toContain("rgba(63, 128, 96");
  });

  it("does not hard-code a light assistant message surface", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const assistantBlock = css.match(/\.message-assistant\s*{[^}]+}/)?.[0] ?? "";

    expect(assistantBlock).not.toContain("rgba(255, 253, 248");
    expect(assistantBlock).toContain("var(--card)");
  });

  it("keeps long chat content clear of the sticky header and fixed composer", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const rootBlock = css.match(/:root\s*{[^}]+}/)?.[0] ?? "";
    const appShellBlock = css.match(/\.app-shell\s*{[^}]+}/)?.[0] ?? "";
    const topStripBlock = css.match(/\.app-shell::before\s*{[^}]+}/)?.[0] ?? "";
    const chatHeaderBlock = css.match(/\.chat-header\s*{[^}]+}/)?.[0] ?? "";
    const messageListBlock = css.match(/\.message-list\s*{[^}]+}/)?.[0] ?? "";
    const composerShellBlock = css.match(/\.composer-shell\s*{[^}]+}/)?.[0] ?? "";
    const composerMaskBlock = css.match(/\.composer-shell::before\s*{[^}]+}/)?.[0] ?? "";

    expect(rootBlock).toContain("--composer-safe-area");
    expect(appShellBlock).toContain("padding: 20px 16px var(--composer-safe-area)");
    expect(topStripBlock).toContain("z-index: 40");
    expect(messageListBlock).toContain("padding: 8px 0 var(--composer-safe-area)");
    expect(chatHeaderBlock).toContain("top: 10px");
    expect(chatHeaderBlock).toContain("z-index: 20");
    expect(chatHeaderBlock).toContain("background: var(--background)");
    expect(composerShellBlock).toContain("z-index: 30");
    expect(composerMaskBlock).toContain("height: calc(100% + 80px)");
    expect(composerMaskBlock).toContain("var(--background)");
  });
});
