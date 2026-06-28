import type { Offering } from "@cfp/kith-inn-shared";

type CmsDeps = { fetch?: typeof fetch };

function cmsBase(): string {
  const url = process.env.CMS_BASE_URL;
  if (!url) throw new Error("CMS_BASE_URL not configured");
  return url.replace(/\/$/, "");
}

/** The operator fields the BE needs after resolving an openid. */
export type OperatorRecord = {
  id: string | number;
  sellerId: string | number;
  role: string;
  active: boolean;
};

/**
 * Find an operator by `wechatOpenid` for the wx-login auth flow. This is a
 * PRE-AUTH read — the operator has no session yet, and cms's `/api/operators`
 * read is tenant-scoped, so cms honors an `x-internal-token` for this login-only
 * lookup. The cms side of that trust is wired in the PR5 chain; the BE just sends
 * the header. It is NOT a tenant admin key — the read is the auth-flow lookup,
 * scoped to finding the operator by their openid.
 */
export async function findOperatorByOpenid(openid: string, deps: CmsDeps = {}): Promise<OperatorRecord | null> {
  const fetchImpl = deps.fetch ?? fetch;
  const where = encodeURIComponent(JSON.stringify({ wechatOpenid: { equals: openid } }));
  const res = await fetchImpl(`${cmsBase()}/api/operators?where=${where}&limit=1`, {
    headers: { "x-internal-token": process.env.CMS_INTERNAL_TOKEN ?? "" },
  });
  if (!res.ok) throw new Error(`cms operators lookup failed: ${res.status}`);
  const json = (await res.json()) as {
    docs?: Array<{ id: string | number; role: string; active: boolean; seller: unknown }>;
  };
  const doc = json.docs?.[0];
  if (!doc) return null;
  const sellerId =
    typeof doc.seller === "object" && doc.seller !== null && "id" in doc.seller
      ? (doc.seller as { id: string | number }).id
      : (doc.seller as string | number);
  return { id: doc.id, sellerId, role: doc.role, active: doc.active };
}

/**
 * List offerings for the operator's seller. Sends the operator JWT in
 * `x-kith-inn-operator`; cms verifies it and tenant-scopes the read through its
 * access control (the cms trust lands in PR5). The BE never uses an admin/万能
 * key — seller scoping derives from the operator's own JWT.
 */
export async function findOfferings(operatorJwt: string, deps: CmsDeps = {}): Promise<Offering[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const res = await fetchImpl(`${cmsBase()}/api/offerings`, {
    headers: { "x-kith-inn-operator": operatorJwt },
  });
  // Propagate cms failures (401/403/500) rather than masking them as an empty
  // menu — otherwise "CMS denied" is indistinguishable from "no offerings".
  if (!res.ok) throw new Error(`cms offerings lookup failed: ${res.status}`);
  const json = (await res.json()) as { docs?: Offering[] };
  return json.docs ?? [];
}
