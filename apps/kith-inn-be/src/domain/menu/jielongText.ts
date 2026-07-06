/**
 * 接龙文案（feature 003 一键发布）——把菜单格式化成桃子微信群的**接龙**模板，
 * 供顾客接龙下单。**纯函数、不调 LLM**。模板按桃子真实群接龙样本校准（2026-07-06）。
 *
 * 支持单餐或多餐（午+晚合并为一个接龙），格式：
 *   #接龙
 *   6.29号星期一午餐预定接龙（30元）
 *     1.萝卜炖牛腩
 *     2.焖鸡蛋
 *     ...
 *   6.29号星期一晚餐预定接龙（30元）
 *     1.香煎鸡中翅
 *     ...
 *   例 桃子   1份午餐晚餐
 *
 *   1.
 */
const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];

/** "2026-07-08" or "2026-07-08T00:00:00.000Z" → "7.8号星期三"（weekday 对日历日期与时区无关）。 */
function formatDateLabel(dateIso: string): string {
  const datePart = dateIso.split("T")[0] ?? dateIso; // handle ISO format from Payload date field
  const parts = datePart.split("-").map(Number);
  const [y, m, d] = parts.length === 3 ? (parts as [number, number, number]) : [1970, 1, 1];
  const weekday = WEEK_CN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}.${d}号星期${weekday}`;
}

export type JielongPlan = { date: string; occasion: "lunch" | "dinner"; dishNames: string[] };
export type JielongSeller = { name: string; priceCents?: number };

/**
 * Build the 接龙 group message. Accepts one or more meals.
 * Multiple meals are combined into ONE接龙 (matches 桃子's real workflow).
 */
export function buildJielongMenuText(plans: JielongPlan[], seller: JielongSeller): string {
  const priceYuan = seller.priceCents ? `${Math.round(seller.priceCents / 100)}` : "?";
  const mealsLabel = plans.map((p) => (p.occasion === "lunch" ? "午餐" : "晚餐")).join("");

  const sections = plans.map((p) => {
    const dateLabel = formatDateLabel(p.date);
    const occ = p.occasion === "lunch" ? "午餐" : "晚餐";
    const header = `${dateLabel}${occ}预定接龙（${priceYuan}元）`;
    const dishes = p.dishNames.map((name, i) => `  ${i + 1}.${name}`).join("\n");
    return `${header}\n${dishes}`;
  });

  return [
    "#接龙",
    ...sections,
    `例 ${seller.name}   1份${mealsLabel}`,
    "",
    "1.",
  ].join("\n");
}
