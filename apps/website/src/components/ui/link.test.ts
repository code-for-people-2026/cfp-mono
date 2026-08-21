import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextLink } from "./link";

describe("TextLink", () => {
  it("removes disabled links from the keyboard tab order", () => {
    const markup = renderToStaticMarkup(
      createElement(TextLink, {
        href: "/manifesto",
        "aria-disabled": true,
        tabIndex: 0,
      }, "为什么做"),
    );

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('tabindex="-1"');
  });
});
