import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactSiteShell, FullSiteShell } from "./site-shell";

describe("shared site shells", () => {
  it("renders the full shell with the canonical brand, navigation, and active area", () => {
    const markup = renderToStaticMarkup(
      createElement(
        FullSiteShell,
        { currentArea: "why", currentObject: "数据平权宣言" },
        createElement("p", null, "正文"),
      ),
    );

    expect(markup).toContain("码成仝");
    expect(markup).toContain("近邻互助组");
    expect(markup).toContain("为什么做");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("正文");
  });

  it("renders the compact shell with its current object and stable return path", () => {
    const markup = renderToStaticMarkup(
      createElement(
        CompactSiteShell,
        {
          currentArea: "topics",
          currentObject: { label: "牛马能力剥夺矩阵", href: "/wam" },
          returnLink: { label: "返回矩阵", href: "/wam" },
        },
        createElement("p", null, "工具内容"),
      ),
    );

    expect(markup).toContain("牛马能力剥夺矩阵");
    expect(markup).toContain("返回矩阵");
    expect(markup).toContain("工具内容");
  });
});
