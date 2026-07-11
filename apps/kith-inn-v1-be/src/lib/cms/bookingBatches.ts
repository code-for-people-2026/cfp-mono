import {
  apiErrorSchema,
  bookingBatchSchema
} from "@cfp/kith-inn-v1-shared/api";
import type {
  BookingBatch,
  BookingBatchUpdate,
  CmsBookingBatchCreate
} from "@cfp/kith-inn-v1-shared";
import { KIV1_INTERNAL_HEADER } from "./auth";
import { KIV1_OPERATOR_HEADER } from "./offerings";

export type CmsBookingBatchDeps = { fetch?: typeof fetch };
const apiErrorCodeSchema = apiErrorSchema.pick({ error: true });

export class CmsBookingBatchError extends Error {
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
  deps: CmsBookingBatchDeps = {}
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
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const codeOnly = apiErrorCodeSchema.safeParse(body);
    throw new CmsBookingBatchError(
      response.status,
      parsed.success ? parsed.data.error : codeOnly.success ? codeOnly.data.error : "cms-booking-batch-failed",
      parsed.success ? parsed.data.message : "预订批次服务失败"
    );
  }
  return body;
}

function parseDoc(body: unknown): BookingBatch {
  const doc = typeof body === "object" && body !== null ? (body as { doc?: unknown }).doc : undefined;
  const parsed = bookingBatchSchema.safeParse(doc);
  if (!parsed.success) throw new CmsBookingBatchError(502, "invalid-cms-response", "预订批次服务返回无效数据");
  return parsed.data;
}

export async function listBookingBatches(
  token: string,
  status?: BookingBatch["status"],
  deps: CmsBookingBatchDeps = {}
): Promise<BookingBatch[]> {
  const query = status ? `?${new URLSearchParams({ status })}` : "";
  const body = await cmsRequest(`/api/internal/kiv1/booking-batches${query}`, token, {}, deps);
  const docs = typeof body === "object" && body !== null ? (body as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) throw new CmsBookingBatchError(502, "invalid-cms-response", "预订批次服务返回无效数据");
  return docs.map((doc) => {
    const parsed = bookingBatchSchema.safeParse(doc);
    if (!parsed.success) throw new CmsBookingBatchError(502, "invalid-cms-response", "预订批次服务返回无效数据");
    return parsed.data;
  });
}

export async function createBookingBatch(
  token: string,
  input: CmsBookingBatchCreate,
  deps: CmsBookingBatchDeps = {}
): Promise<BookingBatch> {
  return parseDoc(await cmsRequest(
    "/api/internal/kiv1/booking-batches",
    token,
    { method: "POST", data: input },
    deps
  ));
}

export async function updateBookingBatch(
  token: string,
  id: string | number,
  input: BookingBatchUpdate,
  deps: CmsBookingBatchDeps = {}
): Promise<BookingBatch> {
  return parseDoc(await cmsRequest(
    `/api/internal/kiv1/booking-batches/${encodeURIComponent(id)}`,
    token,
    { method: "PATCH", data: input },
    deps
  ));
}
