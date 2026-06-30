/** be → cms internal calls for customers (PR7a). Seller-scoped reads via the
 *  operator JWT header; mirrors lib/cms/client.ts's findOfferings style. */
import type { Customer } from "@cfp/kith-inn-shared";
import { cmsBase, OPERATOR_JWT_HEADER, type CmsDeps } from "./client";

/** GET /api/internal/customers — the seller's customers (+optional displayName substring). */
export async function listCustomers(
  operatorJwt: string,
  query: { name?: string } = {},
  deps: CmsDeps = {},
): Promise<Customer[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const qs = new URLSearchParams();
  if (query.name) qs.set("name", query.name);
  const tail = qs.toString();
  const res = await fetchImpl(`${cmsBase()}/api/internal/customers${tail ? `?${tail}` : ""}`, {
    headers: { [OPERATOR_JWT_HEADER]: operatorJwt },
  });
  if (!res.ok) throw new Error(`cms customers list failed: ${res.status}`);
  const json = (await res.json()) as { docs?: Customer[] };
  return json.docs ?? [];
}
