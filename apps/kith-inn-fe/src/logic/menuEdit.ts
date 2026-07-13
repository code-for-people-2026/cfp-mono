import type {
  AutoSwapSuccessResponse,
  MenuPlanView,
  RelaxedRule,
  SpecifiedSwapSuccessResponse,
  SwapRequest,
} from "@cfp/kith-inn-shared";
import { RELAXED_RULES } from "@cfp/kith-inn-shared/enums";
import {
  autoSwapSuccessResponseSchema,
  specifiedSwapSuccessResponseSchema,
} from "@cfp/kith-inn-shared/schemas";
import { menuGenerateUrl, menuPlanPublishUrl, menuPlanSwapUrl, menuPlansRangeUrl, menuPlansUrl } from "../services/api";

/** Minimal structural Taro.request shape (loose; tests pass a vi.fn). */
type ReqOptions = { url: string; method?: string; data?: unknown; header?: Record<string, string> };
type ReqResponse = { statusCode: number; data: unknown };
export type Req = (options: ReqOptions) => Promise<ReqResponse>;

const authHeader = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

export const OCCASION_LABEL: Record<"lunch" | "dinner", string> = { lunch: "午餐", dinner: "晚餐" };

const RELAXED_RULE_LABEL: Record<RelaxedRule, string> = {
  "same-week-offering": "本周已安排过同一道菜",
  "same-day-main-ingredient": "当天主料重复",
  "recent-offering": "近 7 天已安排过同一道菜",
  "recent-main-ingredient": "近 7 天主料重复",
};

/** 自动换菜放宽说明；按领域优先级排序并去重，空规则不生成提示。 */
export function formatRelaxedRules(rules: RelaxedRule[]): string | undefined {
  const selected = new Set(rules);
  const reasons = RELAXED_RULES.filter((rule) => selected.has(rule)).map((rule) => RELAXED_RULE_LABEL[rule]);
  return reasons.length > 0 ? `菜品池较小，本次允许：${reasons.join("、")}` : undefined;
}

/** Plan 被重新加载或生成后，之前自动换菜产生的临时提示不再属于当前版本。 */
export function clearSwapNoticesForPlans(
  notices: Readonly<Record<string, string>>,
  plans: MenuPlanView[],
): Record<string, string> {
  const replacedPlanIds = new Set(plans.map((plan) => String(plan.planId)));
  return Object.fromEntries(Object.entries(notices).filter(([planId]) => !replacedPlanIds.has(planId)));
}

/** Split one day's plans into 午餐 / 晚餐 (either may be absent). */
export function plansByOccasion(plans: MenuPlanView[]): { lunch?: MenuPlanView; dinner?: MenuPlanView } {
  const out: { lunch?: MenuPlanView; dinner?: MenuPlanView } = {};
  for (const p of plans) {
    if (p.occasion === "lunch") out.lunch = p;
    else if (p.occasion === "dinner") out.dinner = p;
  }
  return out;
}

/** GET /menu/plans — 当天（date 字符串）或范围（{from,to}）的 plan 列表。 */
export async function loadPlans(token: string, query: string | { from: string; to: string }, req: Req): Promise<MenuPlanView[]> {
  const url = typeof query === "string" ? menuPlansUrl(query) : menuPlansRangeUrl(query.from, query.to);
  const res = await req({ url, header: { Authorization: `Bearer ${token}` } });
  if (res.statusCode !== 200) throw Object.assign(new Error(`load plans failed: ${res.statusCode}`), { status: res.statusCode });
  return (res.data as { plans?: MenuPlanView[] }).plans ?? [];
}

export type GenerateResult = { ok: true; plans: MenuPlanView[] } | { ok: false; reason: string };

/** POST /menu/generate — 生成 + 写 draft（published 命中无 force → reason plan-published）。 */
export async function generatePlans(
  token: string,
  targets: Array<{ date: string; occasion: "lunch" | "dinner" }>,
  req: Req,
  force = false,
): Promise<GenerateResult> {
  const res = await req({ url: menuGenerateUrl(), method: "POST", data: { targets, force }, header: authHeader(token) });
  if (res.statusCode === 409) return { ok: false, reason: "plan-published" };
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`generate failed: ${res.statusCode}`);
  const body = res.data as { plans?: MenuPlanView[]; ok?: boolean; reason?: string };
  if (body.ok === false) return { ok: false, reason: body.reason ?? "pool-too-small" };
  return { ok: true, plans: body.plans ?? [] };
}

/** POST /menu/plans/:id/swap — 换一道（auto/指定）。非 2xx 抛（page 决定如何提示）。 */
export function swapDish(
  token: string,
  planId: string | number,
  body: Omit<SwapRequest, "replacementId"> & { replacementId?: undefined },
  req: Req,
): Promise<AutoSwapSuccessResponse>;
export function swapDish(
  token: string,
  planId: string | number,
  body: Omit<SwapRequest, "replacementId"> & { replacementId: string | number },
  req: Req,
): Promise<SpecifiedSwapSuccessResponse>;
export async function swapDish(
  token: string,
  planId: string | number,
  body: SwapRequest,
  req: Req,
): Promise<AutoSwapSuccessResponse | SpecifiedSwapSuccessResponse> {
  const res = await req({ url: menuPlanSwapUrl(planId), method: "POST", data: body, header: authHeader(token) });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`swap failed: ${res.statusCode}`);
  return body.replacementId === undefined
    ? autoSwapSuccessResponseSchema.parse(res.data)
    : specifiedSwapSuccessResponseSchema.parse(res.data);
}

/** POST /menu/plans/:id/publish — 一键发布（接龙文案 + 标记）。 */
export async function publishPlan(token: string, planId: string | number, req: Req): Promise<{ publishText: string }> {
  const res = await req({ url: menuPlanPublishUrl(planId), method: "POST", header: authHeader(token) });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`publish failed: ${res.statusCode}`);
  return res.data as { publishText: string };
}
