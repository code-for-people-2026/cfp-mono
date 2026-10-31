import { describe, it, expect } from "vitest";
import { transformColumnsToPreferences } from "payload/shared";
import { collections } from "./collections";
import {
  collectionViews,
  inputSummary,
  executionSummary,
  recommendedColumnsURL,
} from "./presentation";

describe("CMS 验收阅读方式", () => {
  it("列表按各资源用途显示业务内容，并提供用途说明", () => {
    for (const [slug, view] of Object.entries(collectionViews)) {
      const config = collections.find((item) => item.slug === slug);
      expect(config?.admin?.defaultColumns).toEqual(view.defaultColumns);
      expect(config?.admin?.description).toBeTruthy();
      expect(config?.admin?.defaultColumns).not.toContain("owner");
    }
    expect(collectionViews.greetings.defaultColumns?.slice(0, 2)).toEqual([
      "input",
      "greeting",
    ]);
    expect(collectionViews.sessions.useAsTitle).toBe("title");
  });
  it("推荐列链接使用 Payload 原生查询协议，能覆盖旧列偏好", () => {
    for (const [slug, view] of Object.entries(collectionViews)) {
      const url = new URL(recommendedColumnsURL(slug)!, "http://localhost");
      expect(
        transformColumnsToPreferences(url.searchParams.get("columns")!),
      ).toEqual(
        view.defaultColumns?.map((accessor) => ({ accessor, active: true })),
      );
      expect(url.searchParams.get("sort")).toBe("-createdAt");
    }
    expect(recommendedColumnsURL("credentials")).toBeUndefined();
  });
  it("文字与图片输入可读，不把 JSON 整体堆进列表", () => {
    expect(inputSummary({ text: " 小番茄 ", mediaIds: [1, 3] })).toBe(
      "小番茄\n2 张图片 · #1、#3",
    );
    expect(inputSummary({ text: "", mediaIds: [4] })).toBe("1 张图片 · #4");
    expect(inputSummary(null)).toBe("无可读输入");
    expect(inputSummary({ mediaIds: [-1, "2"] })).toBe("无可读输入");
  });
  it("执行轨迹摘要只显示事件数和工具名，不暴露原始上下文", () => {
    expect(
      executionSummary({
        events: [
          {
            content: {
              parts: [
                { text: "内部上下文" },
                {
                  functionCall: {
                    name: "save_greeting",
                    args: { secret: "不显示" },
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toBe("1 条执行事件\n调用工具：save_greeting");
    expect(executionSummary(undefined)).toBe("0 条执行事件\n尚无工具调用");
  });
});
