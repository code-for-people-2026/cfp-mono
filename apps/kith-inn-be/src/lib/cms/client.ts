import type { Offering } from "@cfp/kith-inn-shared";

/** Injectable fetch boundary (so cms calls are unit-testable without a server). */
export type CmsDeps = { fetch?: typeof fetch };

/** Resolved cms base URL (trailing slash trimmed); throws if CMS_BASE_URL unset. */
export function cmsBase(): string {
  const url = process.env.CMS_BASE_URL;
  if (!url) throw new Error("CMS_BASE_URL not configured");
  return url.replace(/\/$/, "");
}

/** The operator JWT travels in this header on every seller-scoped internal call. */
export const OPERATOR_JWT_HEADER = "x-kith-inn-operator";

/** The operator fields the BE needs after resolving an openid. */
export type OperatorRecord = {
  id: string | number;
  sellerId: string | number;
  role: string;
  active: boolean;
};

/**
 * Find an operator by `wechatOpenid` via cms's internal login-lookup endpoint
 * (`POST /api/internal/operator-by-openid`). The operator has no session yet and
 * cms's operators read is tenant-scoped, so this goes through a dedicated internal
 * endpoint authenticated by `x-internal-token` — it's a login-flow lookup, NOT a
 * tenant admin key. Returns null if no operator matches (404).
 */
export async function findOperatorByOpenid(openid: string, deps: CmsDeps = {}): Promise<OperatorRecord | null> {
  const fetchImpl = deps.fetch ?? fetch;
  const res = await fetchImpl(`${cmsBase()}/api/internal/operator-by-openid`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": process.env.CMS_INTERNAL_TOKEN ?? "",
    },
    body: JSON.stringify({ openid }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cms operators lookup failed: ${res.status}`);
  return (await res.json()) as OperatorRecord;
}

/**
 * List offerings for the operator's seller via cms's internal endpoint
 * (`GET /api/internal/offerings`). Sends the operator JWT in
 * `x-kith-inn-operator`; cms verifies it and scopes the read to the JWT's
 * sellerId. The BE never uses an admin/万能 key — seller scoping derives from
 * the operator's own JWT.
 */
export async function findOfferings(operatorJwt: string, deps: CmsDeps = {}): Promise<Offering[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const res = await fetchImpl(`${cmsBase()}/api/internal/offerings`, {
    headers: { [OPERATOR_JWT_HEADER]: operatorJwt },
  });
  if (!res.ok) throw new Error(`cms offerings lookup failed: ${res.status}`);
  const json = (await res.json()) as { docs?: Offering[] };
  return json.docs ?? [];
}
