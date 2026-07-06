/**
 * be → cms internal calls for the offerings (菜品池) domain (feature 002). Every
 * call carries the operator JWT in `x-kith-inn-operator`; cms verifies it and
 * scopes writes to the JWT's sellerId (seller-token passthrough — NO admin key,
 * §3.1). M1 写白名单 = name + mainIngredient + category（US-M02 + 评审拍板录入带分类）。
 */
import type { Offering, OfferingCreate, OfferingUpdate } from "@cfp/kith-inn-shared";
import { cmsBase, OPERATOR_JWT_HEADER, type CmsDeps } from "./client";
import { CmsHttpError } from "./orders";

const jsonHeaders = (jwt: string) => ({
  [OPERATOR_JWT_HEADER]: jwt,
  "content-type": "application/json",
});

const fetchOf = (deps: CmsDeps): typeof fetch => deps.fetch ?? fetch;

async function parseOk<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) throw new CmsHttpError(res.status, label);
  return (await res.json()) as T;
}

/** POST /api/internal/offerings — create a component offering (cms forces kind, active, seller). */
export async function createOffering(
  operatorJwt: string,
  input: OfferingCreate,
  deps: CmsDeps = {},
): Promise<Offering> {
  const fetchImpl = fetchOf(deps);
  const json = await parseOk<{ doc: Offering }>(
    await fetchImpl(`${cmsBase()}/api/internal/offerings`, {
      method: "POST",
      headers: jsonHeaders(operatorJwt),
      body: JSON.stringify(input),
    }),
    "cms offering create",
  );
  return json.doc;
}

/** PATCH /api/internal/offerings/:id — update name/mainIngredient/category in place. */
export async function updateOffering(
  operatorJwt: string,
  id: string | number,
  patch: OfferingUpdate,
  deps: CmsDeps = {},
): Promise<Offering> {
  const fetchImpl = fetchOf(deps);
  const json = await parseOk<{ doc: Offering }>(
    await fetchImpl(`${cmsBase()}/api/internal/offerings/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(operatorJwt),
      body: JSON.stringify(patch),
    }),
    "cms offering update",
  );
  return json.doc;
}

/** DELETE /api/internal/offerings/:id — soft-deactivate (active=false). */
export async function deactivateOffering(
  operatorJwt: string,
  id: string | number,
  deps: CmsDeps = {},
): Promise<void> {
  const fetchImpl = fetchOf(deps);
  await parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/offerings/${id}`, {
      method: "DELETE",
      headers: { [OPERATOR_JWT_HEADER]: operatorJwt },
    }),
    "cms offering deactivate",
  );
}

/** POST /api/internal/offerings/:id/restore — reactivate (active=true). */
export async function restoreOffering(
  operatorJwt: string,
  id: string | number,
  deps: CmsDeps = {},
): Promise<void> {
  const fetchImpl = fetchOf(deps);
  await parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/offerings/${id}/restore`, {
      method: "POST",
      headers: { [OPERATOR_JWT_HEADER]: operatorJwt },
    }),
    "cms offering restore",
  );
}

/** DELETE /api/internal/offerings/:id — hard delete (DB FK-guarded). */
export async function purgeOffering(
  operatorJwt: string,
  id: string | number,
  deps: CmsDeps = {},
): Promise<void> {
  const fetchImpl = fetchOf(deps);
  await parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/offerings/${id}/purge`, {
      method: "DELETE",
      headers: { [OPERATOR_JWT_HEADER]: operatorJwt },
    }),
    "cms offering purge",
  );
}
