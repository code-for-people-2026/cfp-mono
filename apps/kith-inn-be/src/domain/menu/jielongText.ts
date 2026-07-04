/**
 * 接龙文案（feature 003 一键发布）——把一餐的菜单格式化成桃子微信群的**接龙**
 * 模板，供顾客接龙下单。**纯函数、不调 LLM**（接龙是结构化模板，非语气润色；
 * `polish.ts` 的 LLM 润色暂留不用）。模板常量是默认值，待桃子真实接龙样本校准。
 */
const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];

/** "2026-07-08" → { md: "7月8日", weekday: "周三" }（weekday 对日历日期与时区无关）。 */
function formatChinaDate(dateIso: string): { md: string; weekday: string } {
  const parts = dateIso.split("-").map(Number);
  const [y, m, d] = parts.length === 3 ? (parts as [number, number, number]) : [1970, 1, 1];
  const weekday = `周${WEEK_CN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
  return { md: `${m}月${d}日`, weekday };
}

export type JielongPlan = { date: string; occasion: "lunch" | "dinner"; dishNames: string[] };
export type JielongSeller = { name: string; priceCents?: number };

// ponytail: 默认模板常量，待桃子真实群接龙样本校准（标题/分隔/截止措辞/送餐说明）。
const HEADER_PREFIX = "【街坊味】"; // seller.name 未给时的兜底前缀
const DISH_SEPARATOR = "、";
const DEADLINE_LINE = "上午10点接龙截止 · 送餐到门口";
const JIELONG_TAIL = "接龙：\n1.";

/**
 * Build the 接龙 group message for one meal. Format:
 *   【{seller}】7月8日 周三 午餐
 *   红烧牛肉、清炒时蔬、…
 *   30元/份 · 上午10点接龙截止 · 送餐到门口
 *   接龙：
 *   1.
 */
export function buildJielongMenuText(plan: JielongPlan, seller: JielongSeller): string {
  const { md, weekday } = formatChinaDate(plan.date);
  const occasion = plan.occasion === "lunch" ? "午餐" : "晚餐";
  const priceYuan = seller.priceCents ? `${Math.round(seller.priceCents / 100)}` : "?";
  return [
    `${seller.name ? `【${seller.name}】` : HEADER_PREFIX}${md} ${weekday} ${occasion}`,
    plan.dishNames.join(DISH_SEPARATOR),
    `${priceYuan}元/份 · ${DEADLINE_LINE}`,
    JIELONG_TAIL,
  ].join("\n");
}
