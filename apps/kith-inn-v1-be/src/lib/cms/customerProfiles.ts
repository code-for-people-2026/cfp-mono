import {
  apiErrorSchema,
  customerProfileSchema,
  cmsCustomerProfileSchema
} from "@cfp/kith-inn-v1-shared/api";
import type {
  CmsCustomerProfile,
  CustomerProfile,
  CustomerProfileCreate
} from "@cfp/kith-inn-v1-shared";
import { KIV1_INTERNAL_HEADER } from "./auth";
import { KIV1_CUSTOMER_HEADER } from "./bookingBatches";
import { KIV1_OPERATOR_HEADER } from "./offerings";

export type CmsCustomerProfileDeps = { fetch?: typeof fetch };
const apiErrorCodeSchema = apiErrorSchema.pick({ error: true });

export class CmsCustomerProfileError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function cmsBaseUrl(): string {
  const value = process.env.CMS_BASE_URL;
  if (!value) throw new Error("CMS_BASE_URL not configured");
  return value.replace(/\/+$/, "");
}

async function cmsRequest(
  path: string,
  token: string,
  init: { method?: "POST"; data?: CustomerProfileCreate; customer?: boolean },
  deps: CmsCustomerProfileDeps
): Promise<unknown> {
  const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl()}${path}`, {
    ...(init.method ? { method: init.method } : {}),
    headers: {
      [init.customer ? KIV1_CUSTOMER_HEADER : KIV1_OPERATOR_HEADER]: token,
      ...(init.data === undefined ? {} : { "content-type": "application/json" }),
      ...(init.customer && init.method ? { [KIV1_INTERNAL_HEADER]: process.env.KITH_INN_V1_INTERNAL_TOKEN ?? "" } : {})
    },
    ...(init.data === undefined ? {} : { body: JSON.stringify(init.data) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const codeOnly = apiErrorCodeSchema.safeParse(body);
    throw new CmsCustomerProfileError(
      response.status,
      parsed.success ? parsed.data.error : codeOnly.success ? codeOnly.data.error : "cms-customer-profile-failed",
      parsed.success ? parsed.data.message : "顾客资料服务失败"
    );
  }
  return body;
}

function parseProfile(value: unknown): CmsCustomerProfile {
  const parsed = cmsCustomerProfileSchema.safeParse(value);
  if (!parsed.success) throw new CmsCustomerProfileError(502, "invalid-cms-response", "顾客资料服务返回无效数据");
  return parsed.data;
}

function parseCustomerProfile(value: unknown): CustomerProfile {
  const parsed = customerProfileSchema.safeParse(value);
  if (!parsed.success) throw new CmsCustomerProfileError(502, "invalid-cms-response", "顾客资料服务返回无效数据");
  return parsed.data;
}

export async function listCustomerProfiles(
  token: string,
  query: string,
  deps: CmsCustomerProfileDeps = {}
): Promise<CmsCustomerProfile[]> {
  const search = new URLSearchParams({ query }).toString();
  const body = await cmsRequest(`/api/internal/kiv1/customer-profiles?${search}`, token, {}, deps);
  const docs = typeof body === "object" && body !== null ? (body as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) {
    throw new CmsCustomerProfileError(502, "invalid-cms-response", "顾客资料服务返回无效数据");
  }
  return docs.map(parseProfile);
}

export async function createCustomerProfile(
  token: string,
  input: CustomerProfileCreate,
  deps: CmsCustomerProfileDeps = {}
): Promise<CmsCustomerProfile> {
  const body = await cmsRequest("/api/internal/kiv1/customer-profiles", token, { method: "POST", data: input }, deps);
  const doc = typeof body === "object" && body !== null ? (body as { doc?: unknown }).doc : undefined;
  return parseProfile(doc);
}

export async function listCustomerOwnedProfiles(token: string, deps: CmsCustomerProfileDeps = {}) {
  const body = await cmsRequest("/api/internal/kiv1/customer/profiles", token, { customer: true }, deps);
  const docs = typeof body === "object" && body !== null ? (body as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) throw new CmsCustomerProfileError(502, "invalid-cms-response", "顾客资料服务返回无效数据");
  return docs.map(parseCustomerProfile);
}

export async function createCustomerOwnedProfile(
  token: string, input: CustomerProfileCreate, deps: CmsCustomerProfileDeps = {}
) {
  const body = await cmsRequest("/api/internal/kiv1/customer/profiles", token,
    { method: "POST", data: input, customer: true }, deps);
  return parseCustomerProfile((body as { doc?: unknown } | null)?.doc);
}

export async function touchCustomerOwnedProfile(
  token: string, id: string | number, deps: CmsCustomerProfileDeps = {}
) {
  const body = await cmsRequest(`/api/internal/kiv1/customer/profiles/${encodeURIComponent(id)}/touch`, token,
    { method: "POST", customer: true }, deps);
  return parseCustomerProfile((body as { doc?: unknown } | null)?.doc);
}
