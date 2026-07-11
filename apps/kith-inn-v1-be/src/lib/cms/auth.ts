import { customerSessionBootstrapResponseSchema } from "@cfp/kith-inn-v1-shared/api";
import type { CustomerSessionBootstrapResponse } from "@cfp/kith-inn-v1-shared";

export const KIV1_INTERNAL_HEADER = "x-kith-inn-v1-internal";

export type OperatorMembership = {
  operatorId: string | number;
  sellerId: string | number;
  sellerName: string;
  active: true;
};

export type MembershipLookup = { openid: string } | { operatorId: string | number };
export type CmsAuthDeps = { fetch?: typeof fetch };

export class CmsAuthError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

function cmsBaseUrl(): string {
  const value = process.env.CMS_BASE_URL;
  if (!value) throw new Error("CMS_BASE_URL not configured");
  return value.replace(/\/+$/, "");
}

function validId(value: unknown): value is string | number {
  return (typeof value === "string" && value !== "") || (typeof value === "number" && Number.isInteger(value));
}

function isMembership(value: unknown): value is OperatorMembership {
  if (typeof value !== "object" || value === null) return false;
  const membership = value as Partial<OperatorMembership>;
  return validId(membership.operatorId) && validId(membership.sellerId) &&
    typeof membership.sellerName === "string" && membership.sellerName !== "" && membership.active === true;
}

export async function findOperatorMemberships(
  lookup: MembershipLookup,
  deps: CmsAuthDeps = {}
): Promise<OperatorMembership[]> {
  const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl()}/api/internal/kiv1/auth/operator-memberships`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [KIV1_INTERNAL_HEADER]: process.env.KITH_INN_V1_INTERNAL_TOKEN ?? ""
    },
    body: JSON.stringify(lookup)
  });
  const body = await response.json().catch(() => ({})) as { error?: unknown; memberships?: unknown };
  if (!response.ok) {
    throw new CmsAuthError(response.status, typeof body.error === "string" ? body.error : "cms-auth-failed");
  }
  if (!Array.isArray(body.memberships) || !body.memberships.every(isMembership)) {
    throw new Error("invalid cms auth response");
  }
  return body.memberships;
}

export async function findCustomerSessionBootstrap(
  batchPublicId: string,
  deps: CmsAuthDeps = {}
): Promise<CustomerSessionBootstrapResponse> {
  const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl()}/api/internal/kiv1/auth/customer-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [KIV1_INTERNAL_HEADER]: process.env.KITH_INN_V1_INTERNAL_TOKEN ?? ""
    },
    body: JSON.stringify({ batchPublicId })
  });
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) {
    throw new CmsAuthError(response.status, typeof body.error === "string" ? body.error : "cms-auth-failed");
  }
  const parsed = customerSessionBootstrapResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("invalid cms customer bootstrap response");
  return parsed.data;
}
