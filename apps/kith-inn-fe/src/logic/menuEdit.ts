import type { MenuPlanView } from "@cfp/kith-inn-shared";
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
export async function swapDish(
  token: string,
  planId: string | number,
  body: { dishId: string | number; replacementId?: string | number; force?: boolean },
  req: Req,
): Promise<{ plan: MenuPlanView; warning?: string }> {
  const res = await req({ url: menuPlanSwapUrl(planId), method: "POST", data: body, header: authHeader(token) });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`swap failed: ${res.statusCode}`);
  return res.data as { plan: MenuPlanView; warning?: string };
}

/** POST /menu/plans/:id/publish — 一键发布（接龙文案 + 标记）。 */
export async function publishPlan(token: string, planId: string | number, req: Req): Promise<{ publishText: string }> {
  const res = await req({ url: menuPlanPublishUrl(planId), method: "POST", header: authHeader(token) });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`publish failed: ${res.statusCode}`);
  return res.data as { publishText: string };
}
