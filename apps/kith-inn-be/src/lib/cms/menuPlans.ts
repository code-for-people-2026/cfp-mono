/**
 * be → cms internal calls for menu_plans (feature 003). JWT in `x-kith-inn-operator`;
 * cms scopes to the JWT's sellerId (seller-token passthrough, no admin key). Shapes
 * are the be↔cms internal contract (cms flattens Payload depth docs).
 */
import type { MenuPlan } from "@cfp/kith-inn-shared";
import { cmsBase, OPERATOR_JWT_HEADER, type CmsDeps } from "./client";
import { CmsHttpError } from "./orders";

export type MenuPlanUpsertInput = { date: string; occasion?: string; offerings: Array<string | number>; status: string };
export type MenuPlanPatch = { status?: string; publishText?: string | null; offerings?: Array<string | number> };

const jsonHeaders = (jwt: string) => ({ [OPERATOR_JWT_HEADER]: jwt, "content-type": "application/json" });
const fetchOf = (deps: CmsDeps): typeof fetch => deps.fetch ?? fetch;

async function parseOk<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) throw new CmsHttpError(res.status, label);
  return (await res.json()) as T;
}

/** GET /api/internal/menu-plans?from=&to= — plans in a date range (depth: slot+offerings). */
export async function listMenuPlans(
  operatorJwt: string,
  query: { from: string; to: string },
  deps: CmsDeps = {},
): Promise<MenuPlan[]> {
  const fetchImpl = fetchOf(deps);
  const json = await parseOk<{ docs?: MenuPlan[] }>(
    await fetchImpl(`${cmsBase()}/api/internal/menu-plans?from=${encodeURIComponent(query.from)}&to=${encodeURIComponent(query.to)}`, {
      headers: { [OPERATOR_JWT_HEADER]: operatorJwt },
    }),
    "cms menu-plans list",
  );
  return json.docs ?? [];
}

/** GET /api/internal/menu-plans/:id — one plan (depth). 404 cross-tenant. */
export async function getMenuPlan(operatorJwt: string, id: string | number, deps: CmsDeps = {}): Promise<MenuPlan> {
  const fetchImpl = fetchOf(deps);
  const json = await parseOk<{ doc: MenuPlan }>(
    await fetchImpl(`${cmsBase()}/api/internal/menu-plans/${id}`, { headers: { [OPERATOR_JWT_HEADER]: operatorJwt } }),
    "cms menu-plan get",
  );
  return json.doc;
}

/** POST /api/internal/menu-plans/upsert — ensure slot + upsert plans by (seller, slot). */
export async function upsertMenuPlans(
  operatorJwt: string,
  items: MenuPlanUpsertInput[],
  deps: CmsDeps = {},
): Promise<MenuPlan[]> {
  const fetchImpl = fetchOf(deps);
  const json = await parseOk<{ docs?: MenuPlan[] }>(
    await fetchImpl(`${cmsBase()}/api/internal/menu-plans/upsert`, { method: "POST", headers: jsonHeaders(operatorJwt), body: JSON.stringify(items) }),
    "cms menu-plan upsert",
  );
  return json.docs ?? [];
}

/** PATCH /api/internal/menu-plans/:id — {status?, publishText?, offerings?} (whitelist). */
export async function patchMenuPlan(
  operatorJwt: string,
  id: string | number,
  patch: MenuPlanPatch,
  deps: CmsDeps = {},
): Promise<MenuPlan> {
  const fetchImpl = fetchOf(deps);
  const json = await parseOk<{ doc: MenuPlan }>(
    await fetchImpl(`${cmsBase()}/api/internal/menu-plans/${id}`, { method: "PATCH", headers: jsonHeaders(operatorJwt), body: JSON.stringify(patch) }),
    "cms menu-plan patch",
  );
  return json.doc;
}
