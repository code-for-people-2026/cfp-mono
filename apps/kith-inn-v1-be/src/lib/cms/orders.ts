import { apiErrorSchema, orderSchema } from "@cfp/kith-inn-v1-shared/api";
import type {
  CmsOrderCreate,
  CmsOrderUpdate,
  Order
} from "@cfp/kith-inn-v1-shared";
import { KIV1_INTERNAL_HEADER } from "./auth";
import { KIV1_OPERATOR_HEADER } from "./offerings";

export type CmsOrderDeps = { fetch?: typeof fetch };
const apiErrorCodeSchema = apiErrorSchema.pick({ error: true });

export class CmsOrderError extends Error {
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
  deps: CmsOrderDeps = {}
): Promise<unknown> {
  const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl()}${path}`, {
    ...(init.method ? { method: init.method } : {}),
    headers: {
      [KIV1_OPERATOR_HEADER]: token,
      ...(init.data === undefined ? {} : { "content-type": "application/json" }),
      ...(init.method === "PATCH"
        ? { [KIV1_INTERNAL_HEADER]: process.env.KITH_INN_V1_INTERNAL_TOKEN ?? "" }
        : {})
    },
    ...(init.data === undefined ? {} : { body: JSON.stringify(init.data) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const codeOnly = apiErrorCodeSchema.safeParse(body);
    throw new CmsOrderError(
      response.status,
      parsed.success ? parsed.data.error : codeOnly.success ? codeOnly.data.error : "cms-order-failed",
      parsed.success ? parsed.data.message : "订单服务失败"
    );
  }
  return body;
}

function parseOrder(value: unknown): Order {
  const parsed = orderSchema.safeParse(value);
  if (!parsed.success) throw new CmsOrderError(502, "invalid-cms-response", "订单服务返回无效数据");
  return parsed.data;
}

export async function listOrders(token: string, mealSlotId: string | number, deps: CmsOrderDeps = {}): Promise<Order[]> {
  const query = new URLSearchParams({ mealSlotId: String(mealSlotId) }).toString();
  const body = await cmsRequest(`/api/internal/kiv1/orders?${query}`, token, {}, deps);
  const docs = typeof body === "object" && body !== null ? (body as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) throw new CmsOrderError(502, "invalid-cms-response", "订单服务返回无效数据");
  return docs.map(parseOrder);
}

export async function getOrder(token: string, id: string | number, deps: CmsOrderDeps = {}): Promise<Order> {
  const body = await cmsRequest(`/api/internal/kiv1/orders/${encodeURIComponent(id)}`, token, {}, deps);
  const doc = typeof body === "object" && body !== null ? (body as { doc?: unknown }).doc : undefined;
  return parseOrder(doc);
}

export async function createOrder(token: string, input: CmsOrderCreate, deps: CmsOrderDeps = {}): Promise<Order> {
  const body = await cmsRequest("/api/internal/kiv1/orders", token, { method: "POST", data: input }, deps);
  const doc = typeof body === "object" && body !== null ? (body as { doc?: unknown }).doc : undefined;
  return parseOrder(doc);
}

export async function updateOrder(
  token: string,
  id: string | number,
  input: CmsOrderUpdate,
  deps: CmsOrderDeps = {}
): Promise<Order> {
  const body = await cmsRequest(`/api/internal/kiv1/orders/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    data: input
  }, deps);
  const doc = typeof body === "object" && body !== null ? (body as { doc?: unknown }).doc : undefined;
  return parseOrder(doc);
}
