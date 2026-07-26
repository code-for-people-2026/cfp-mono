import type { ServiceClosure, ServiceClosureCreate } from "@cfp/kith-inn-v1-shared";
import {
  apiErrorSchema,
  serviceClosureListResponseSchema,
  serviceClosureSchema
} from "@cfp/kith-inn-v1-shared/api";
import { KIV1_INTERNAL_HEADER } from "./auth";
import { KIV1_OPERATOR_HEADER } from "./offerings";

export type CmsServiceClosureDeps = { fetch?: typeof fetch };
const apiErrorCodeSchema = apiErrorSchema.pick({ error: true });

export class CmsServiceClosureError extends Error {
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
  init: { method?: "POST" | "DELETE"; data?: unknown } = {},
  deps: CmsServiceClosureDeps = {}
): Promise<unknown> {
  const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl()}${path}`, {
    ...(init.method ? { method: init.method } : {}),
    headers: {
      [KIV1_OPERATOR_HEADER]: token,
      ...(init.data === undefined ? {} : { "content-type": "application/json" }),
      ...(init.method ? { [KIV1_INTERNAL_HEADER]: process.env.KITH_INN_V1_INTERNAL_TOKEN ?? "" } : {})
    },
    ...(init.data === undefined ? {} : { body: JSON.stringify(init.data) })
  });
  const body = response.status === 204 ? undefined : await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const codeOnly = apiErrorCodeSchema.safeParse(body);
    throw new CmsServiceClosureError(
      response.status,
      parsed.success ? parsed.data.error : codeOnly.success ? codeOnly.data.error : "cms-service-closure-failed",
      parsed.success ? parsed.data.message : "营业安排服务失败"
    );
  }
  return body;
}

export async function listServiceClosures(
  token: string,
  range: { from: string; to: string },
  deps: CmsServiceClosureDeps = {}
): Promise<ServiceClosure[]> {
  const query = new URLSearchParams(range).toString();
  const parsed = serviceClosureListResponseSchema.safeParse(await cmsRequest(
    `/api/internal/kiv1/service-closures?${query}`, token, {}, deps
  ));
  if (!parsed.success) {
    throw new CmsServiceClosureError(502, "invalid-cms-response", "营业安排服务返回无效数据");
  }
  return parsed.data.docs;
}

export async function createServiceClosure(
  token: string,
  input: ServiceClosureCreate,
  deps: CmsServiceClosureDeps = {}
): Promise<ServiceClosure> {
  const body = await cmsRequest(
    "/api/internal/kiv1/service-closures", token, { method: "POST", data: input }, deps
  );
  const doc = typeof body === "object" && body !== null ? (body as { doc?: unknown }).doc : undefined;
  const parsed = serviceClosureSchema.safeParse(doc);
  if (!parsed.success) {
    throw new CmsServiceClosureError(502, "invalid-cms-response", "营业安排服务返回无效数据");
  }
  return parsed.data;
}

export async function deleteServiceClosure(
  token: string,
  id: string | number,
  deps: CmsServiceClosureDeps = {}
): Promise<void> {
  await cmsRequest(
    `/api/internal/kiv1/service-closures/${encodeURIComponent(id)}`,
    token,
    { method: "DELETE" },
    deps
  );
}
