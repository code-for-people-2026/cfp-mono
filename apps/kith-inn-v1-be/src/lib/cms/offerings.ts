import { apiErrorSchema, offeringSchema } from "@cfp/kith-inn-v1-shared/api";
import type { Offering, OfferingCreate, OfferingUpdate } from "@cfp/kith-inn-v1-shared";

export const KIV1_OPERATOR_HEADER = "x-kith-inn-v1-operator";
export type CmsOfferingDeps = { fetch?: typeof fetch };
const apiErrorCodeSchema = apiErrorSchema.pick({ error: true });

export class CmsOfferingError extends Error {
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
  init: { method?: "POST" | "PATCH"; data?: unknown } = {},
  deps: CmsOfferingDeps = {}
): Promise<unknown> {
  const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl()}${path}`, {
    ...(init.method ? { method: init.method } : {}),
    headers: init.data === undefined
      ? { [KIV1_OPERATOR_HEADER]: token }
      : { [KIV1_OPERATOR_HEADER]: token, "content-type": "application/json" },
    ...(init.data === undefined ? {} : { body: JSON.stringify(init.data) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const codeOnly = apiErrorCodeSchema.safeParse(body);
    throw new CmsOfferingError(
      response.status,
      parsed.success ? parsed.data.error : codeOnly.success ? codeOnly.data.error : "cms-offering-failed",
      parsed.success ? parsed.data.message : "菜品服务失败"
    );
  }
  return body;
}

function parseDoc(body: unknown): Offering {
  const record = typeof body === "object" && body !== null ? body as { doc?: unknown } : {};
  const parsed = offeringSchema.safeParse(record.doc);
  if (!parsed.success) throw new CmsOfferingError(502, "invalid-cms-response", "菜品服务返回无效数据");
  return parsed.data;
}

export async function listOfferings(
  token: string,
  active: "all" | "true" | "false",
  deps: CmsOfferingDeps = {}
): Promise<Offering[]> {
  const body = await cmsRequest(`/api/internal/kiv1/offerings?active=${active}`, token, {}, deps);
  const docs = typeof body === "object" && body !== null ? (body as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) throw new CmsOfferingError(502, "invalid-cms-response", "菜品服务返回无效数据");
  const parsed = docs.map((doc) => offeringSchema.safeParse(doc));
  if (parsed.some((result) => !result.success)) {
    throw new CmsOfferingError(502, "invalid-cms-response", "菜品服务返回无效数据");
  }
  return parsed.map((result) => result.data!);
}

export async function createOffering(
  token: string,
  input: OfferingCreate,
  deps: CmsOfferingDeps = {}
): Promise<Offering> {
  return parseDoc(await cmsRequest("/api/internal/kiv1/offerings", token, { method: "POST", data: input }, deps));
}

export async function updateOffering(
  token: string,
  id: string | number,
  input: OfferingUpdate,
  deps: CmsOfferingDeps = {}
): Promise<Offering> {
  return parseDoc(await cmsRequest(`/api/internal/kiv1/offerings/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    data: input
  }, deps));
}
