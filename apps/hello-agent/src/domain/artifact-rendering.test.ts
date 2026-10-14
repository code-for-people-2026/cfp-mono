import { it, expect } from "vitest";
import sharp from "sharp";
import { pageHtml, illustrationPng } from "./artifact-rendering";
import { artifacts } from "../../../../packages/hello-agent-protocol/test/fixtures";
import { toMemoryTurn, memoryTokens, MEMORY_BUDGET } from "./context-policy";

it("网页文本无法成为脚本或 HTML，插画只栅格化已验证的几何描述", async () => {
  const html = pageHtml({
    kind: "page",
    id: "p",
    title: "<script>alert(1)</script>",
    sections: [{ heading: "标题", body: '<img src=x onerror="alert(1)">' }],
  });
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;");
  const illustration = artifacts.find((item) => item.kind === "image")!;
  if (illustration.kind !== "image") throw new Error("missing image");
  const png = await illustrationPng(illustration);
  expect(await sharp(png).metadata()).toMatchObject({
    format: "png",
    width: 640,
    height: 448,
  });
});

it("大作品不会把最近两轮卡在无法整理的记忆死角，表单答案不重复计数", () => {
  const turns = [1, 2].map((id) =>
    toMemoryTurn({
      id,
      greeting: "答".repeat(1000),
      input: {
        text: "问".repeat(4000),
        mediaIds: [],
        formResponse: {
          turnId: 3,
          artifactId: "form",
          values: { answer: "问".repeat(1200) },
        },
      },
      artifacts: Array.from({ length: 5 }, (_, index) => ({
        kind: "card",
        id: `card_${index}`,
        title: "长作品",
        body: "作".repeat(1200),
      })),
    }),
  );
  expect(turns[0].input).not.toHaveProperty("formResponse");
  expect(turns[0].greeting).toContain("作品摘要节选");
  expect(memoryTokens("摘".repeat(900), turns)).toBeLessThan(MEMORY_BUDGET);
});
