import { callDeepSeek } from "../../lib/deepseek/client";

/**
 * 菜单润色层（PRD §6.2）——LLM **只润色，不决定选菜**。这里实现「一键发布文案」：
 * 把确定性内核选好的菜单写成桃子本人语气的微信群通知（菜名 + 价格 + 截止）。
 * 菜名口语化/节令提示是同类轻润色，按需扩。
 */
export type MenuSlotText = { day: string; occasion: "lunch" | "dinner"; dishes: string[] };

/** Injectable LLM boundary (tests script it; default = real DeepSeek call). */
export type GenerateText = (prompt: string) => Promise<string>;

const defaultGenerate: GenerateText = (prompt) =>
  callDeepSeek({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 600,
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  });

const DAY_CN: Record<string, string> = { mon: "周一", tue: "周二", wed: "周三", thu: "周四", fri: "周五", sat: "周六", sun: "周日" };

function buildPrompt(menu: MenuSlotText[], priceYuan: number, sellerName: string): string {
  const lines = menu.map(
    (m) => `${DAY_CN[m.day] ?? m.day}${m.occasion === "lunch" ? "午餐" : "晚餐"}：${m.dishes.join("、")}`,
  );
  return [
    `把下面菜单写成「${sellerName}」微信群的点餐通知，用老板本人亲切口语化的语气（简短、接地气、像街坊邻居说话）。`,
    `要点：含价格（${priceYuan} 元/份）、提醒上午 10 点前接单截止、提一句明天送达。`,
    `只输出通知文案本身，不要额外解释或前后缀。`,
    ``,
    ...lines,
  ].join("\n");
}

/** Generate the WeChat-group publish text for a (already-selected) menu. */
export async function publishMenuText(
  menu: MenuSlotText[],
  opts: { sellerName: string; priceCents: number; generate?: GenerateText },
): Promise<string> {
  const gen = opts.generate ?? defaultGenerate;
  return gen(buildPrompt(menu, opts.priceCents / 100, opts.sellerName));
}
