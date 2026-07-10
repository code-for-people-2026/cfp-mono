import { apiErrorSchema, mealSlotSchema } from "@cfp/kith-inn-v1-shared/api";
import type {
  MealSlot,
  MealSlotCreate,
  MealSlotUpdate
} from "@cfp/kith-inn-v1-shared";
import { KIV1_OPERATOR_HEADER } from "./offerings";

export type CmsMealSlotDeps = { fetch?: typeof fetch };
const apiErrorCodeSchema = apiErrorSchema.pick({ error: true });

export class CmsMealSlotError extends Error {
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
  deps: CmsMealSlotDeps = {}
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
    throw new CmsMealSlotError(
      response.status,
      parsed.success ? parsed.data.error : codeOnly.success ? codeOnly.data.error : "cms-meal-slot-failed",
      parsed.success ? parsed.data.message : "餐次服务失败"
    );
  }
  return body;
}

function parseDoc(body: unknown): MealSlot {
  const record = typeof body === "object" && body !== null ? body as { doc?: unknown } : {};
  const parsed = mealSlotSchema.safeParse(record.doc);
  if (!parsed.success) throw new CmsMealSlotError(502, "invalid-cms-response", "餐次服务返回无效数据");
  return parsed.data;
}

export async function listMealSlots(
  token: string,
  range: { from: string; to: string },
  deps: CmsMealSlotDeps = {}
): Promise<MealSlot[]> {
  const query = new URLSearchParams(range).toString();
  const body = await cmsRequest(`/api/internal/kiv1/meal-slots?${query}`, token, {}, deps);
  const docs = typeof body === "object" && body !== null ? (body as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) throw new CmsMealSlotError(502, "invalid-cms-response", "餐次服务返回无效数据");
  const parsed = docs.map((doc) => mealSlotSchema.safeParse(doc));
  if (parsed.some((result) => !result.success)) {
    throw new CmsMealSlotError(502, "invalid-cms-response", "餐次服务返回无效数据");
  }
  return parsed.map((result) => result.data!);
}

export async function getMealSlot(
  token: string,
  id: string | number,
  deps: CmsMealSlotDeps = {}
): Promise<MealSlot> {
  return parseDoc(await cmsRequest(`/api/internal/kiv1/meal-slots/${encodeURIComponent(id)}`, token, {}, deps));
}

export async function createMealSlot(
  token: string,
  input: MealSlotCreate,
  deps: CmsMealSlotDeps = {}
): Promise<MealSlot> {
  return parseDoc(await cmsRequest("/api/internal/kiv1/meal-slots", token, { method: "POST", data: input }, deps));
}

export async function updateMealSlot(
  token: string,
  id: string | number,
  input: MealSlotUpdate,
  deps: CmsMealSlotDeps = {}
): Promise<MealSlot> {
  return parseDoc(await cmsRequest(`/api/internal/kiv1/meal-slots/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    data: input
  }, deps));
}
