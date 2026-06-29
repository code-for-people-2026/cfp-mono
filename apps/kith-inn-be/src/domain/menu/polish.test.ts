import { describe, expect, it, vi } from "vitest";
import { publishMenuText, type GenerateText } from "./polish";

const menu = [{ day: "mon", occasion: "lunch" as const, dishes: ["红烧牛肉", "炒青菜", "冬瓜汤"] }];

describe("publishMenuText", () => {
  it("returns the generated text", async () => {
    const generate = vi.fn(async () => "今天的菜单来啦～");
    const text = await publishMenuText(menu, { sellerName: "桃子的灶台", priceCents: 3000, generate });
    expect(text).toBe("今天的菜单来啦～");
  });

  it("passes seller name, price (元), dishes + deadline into the prompt", async () => {
    const generate = vi.fn<GenerateText>(async () => "x");
    await publishMenuText(menu, { sellerName: "桃子的灶台", priceCents: 3000, generate });
    const prompt = generate.mock.calls[0]![0];
    expect(prompt).toContain("桃子的灶台");
    expect(prompt).toContain("30 元/份"); // 3000 cents → 30 元
    expect(prompt).toContain("红烧牛肉");
    expect(prompt).toContain("10 点前接单截止");
    expect(prompt).toContain("周一午餐");
  });
});
