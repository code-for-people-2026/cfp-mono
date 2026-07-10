import type {
  ImportCommitInput,
  ImportCommitResponse,
  ImportPreviewResponse,
  GenerateMenusInput,
  GenerateMenusResponse,
  MealSlot,
  Offering,
  OfferingCreate,
  OfferingUpdate,
  RelaxedRule,
  SwapMenuItemResponse
} from "@cfp/kith-inn-v1-shared";
import type { AuthResponse, SellerSelectionResponse } from "@cfp/kith-inn-v1-shared/api";
import type { SessionStore } from "../store/session";
import { parseOperatorSessionData } from "../store/session";

export const DEFAULT_BE_BASE_URL = "http://localhost:3311";

export function resolveBeBaseUrl(value?: string): string {
  return (value?.trim() || DEFAULT_BE_BASE_URL).replace(/\/+$/, "");
}

export type RequestOptions = {
  url: string;
  method: "GET" | "POST" | "PATCH";
  data?: unknown;
  header: Record<string, string>;
};

export type RequestAdapter = (options: RequestOptions) => Promise<{ statusCode: number; data: unknown }>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validId(value: unknown): value is string | number {
  return (typeof value === "string" && value !== "") || (typeof value === "number" && Number.isInteger(value));
}

function parseAuthResponse(value: unknown): AuthResponse {
  const body = record(value);
  if (body?.status === "authenticated" && typeof body.token === "string") {
    const session = parseOperatorSessionData(body.session);
    if (session) return { status: "authenticated", token: body.token, session };
  }
  if (body?.status === "seller-selection-required" && typeof body.selectionToken === "string" && Array.isArray(body.sellers)) {
    const sellers = body.sellers.flatMap((value) => {
      const seller = record(value);
      return seller && validId(seller.sellerId) && typeof seller.sellerName === "string" && seller.sellerName !== ""
        ? [{ sellerId: seller.sellerId, sellerName: seller.sellerName }]
        : [];
    });
    if (sellers.length === body.sellers.length && sellers.length >= 2) {
      return { status: "seller-selection-required", selectionToken: body.selectionToken, sellers } as SellerSelectionResponse;
    }
  }
  throw new ApiError(502, "invalid-api-response", "登录服务返回无效数据");
}

function parseError(value: unknown): { error: string; message: string } | null {
  const body = record(value);
  return body && typeof body.error === "string" && body.error !== "" &&
    typeof body.message === "string" && body.message !== ""
    ? { error: body.error, message: body.message }
    : null;
}

function parseOffering(value: unknown): Offering {
  const offering = record(value);
  if (!offering || !validId(offering.id) || !validId(offering.sellerId) ||
    typeof offering.name !== "string" || offering.name === "" ||
    (offering.mainIngredient !== null && typeof offering.mainIngredient !== "string") ||
    !(["meat", "veg", "soup"] as const).includes(offering.category as Offering["category"]) ||
    typeof offering.active !== "boolean") {
    throw new ApiError(502, "invalid-api-response", "菜品数据无效");
  }
  return offering as Offering;
}

function parsePreview(value: unknown): ImportPreviewResponse {
  const body = record(value);
  if (!body || !Array.isArray(body.rows) || !record(body.summary)) {
    throw new ApiError(502, "invalid-api-response", "导入预览数据无效");
  }
  return body as ImportPreviewResponse;
}

function parseCommit(value: unknown): ImportCommitResponse {
  const body = record(value);
  if (!body || !Array.isArray(body.results) || !record(body.summary)) {
    throw new ApiError(502, "invalid-api-response", "导入结果无效");
  }
  return body as ImportCommitResponse;
}

const relaxedRules = [
  "same-week-offering",
  "same-day-main-ingredient",
  "recent-offering",
  "recent-main-ingredient"
] as const;

function parseMealSlot(value: unknown): MealSlot {
  const slot = record(value);
  const items = Array.isArray(slot?.menuItems) ? slot.menuItems.map(record) : [];
  const validItems = items.length === 5 && items.every((item) => item &&
    validId(item.offeringId) &&
    typeof item.nameSnapshot === "string" && item.nameSnapshot !== "" &&
    (item.mainIngredientSnapshot === null || typeof item.mainIngredientSnapshot === "string") &&
    (["meat", "veg", "soup"] as const).includes(item.categorySnapshot as MealSlot["menuItems"][number]["categorySnapshot"]));
  if (!slot || !validId(slot.id) || !validId(slot.sellerId) ||
    typeof slot.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date) ||
    !(slot.occasion === "lunch" || slot.occasion === "dinner") || !validItems ||
    !(slot.orderStatus === "draft" || slot.orderStatus === "open" || slot.orderStatus === "closed") ||
    !(slot.priceCents === null || (typeof slot.priceCents === "number" && Number.isInteger(slot.priceCents) && slot.priceCents >= 0)) ||
    !(slot.generatedAt === null || typeof slot.generatedAt === "string")) {
    throw new ApiError(502, "invalid-api-response", "菜单数据无效");
  }
  return slot as MealSlot;
}

function parseRelaxedRules(value: unknown): RelaxedRule[] {
  if (!Array.isArray(value) || value.some((rule) =>
    typeof rule !== "string" || !relaxedRules.includes(rule as RelaxedRule))) {
    throw new ApiError(502, "invalid-api-response", "菜单数据无效");
  }
  return value as RelaxedRule[];
}

function parseGeneration(value: unknown): GenerateMenusResponse {
  const body = record(value);
  if (!body || !Array.isArray(body.docs)) throw new ApiError(502, "invalid-api-response", "菜单数据无效");
  return { docs: body.docs.map(parseMealSlot), relaxedRules: parseRelaxedRules(body.relaxedRules) };
}

function parseSwap(value: unknown): SwapMenuItemResponse {
  const body = record(value);
  if (!body) throw new ApiError(502, "invalid-api-response", "菜单数据无效");
  return { doc: parseMealSlot(body.doc), relaxedRules: parseRelaxedRules(body.relaxedRules) };
}

type ClientOptions = {
  request: RequestAdapter;
  sessions: SessionStore;
  baseUrl?: string;
  onAuthFailure?: (status: 401 | 403) => void;
};

export function createApiClient(options: ClientOptions) {
  const baseUrl = resolveBeBaseUrl(options.baseUrl ?? process.env.BE_BASE_URL);

  async function request<T>(
    path: string,
    config: { method?: "GET" | "POST" | "PATCH"; data?: unknown; authenticated?: boolean } = {}
  ): Promise<T> {
    const authenticated = config.authenticated !== false;
    const token = authenticated ? options.sessions.getSession()?.token : null;
    const header: Record<string, string> = { "content-type": "application/json" };
    if (token) header.Authorization = `Bearer ${token}`;
    const response = await options.request({
      url: `${baseUrl}${path}`,
      method: config.method ?? "GET",
      ...(config.data === undefined ? {} : { data: config.data }),
      header
    });
    if (response.statusCode >= 200 && response.statusCode < 300) return response.data as T;
    const parsed = parseError(response.data);
    if (response.statusCode === 401 || response.statusCode === 403) {
      options.sessions.clearSession();
      options.onAuthFailure?.(response.statusCode);
    }
    throw new ApiError(
      response.statusCode,
      parsed?.error ?? "request-failed",
      parsed?.message ?? "请求失败",
      response.data
    );
  }

  async function auth(path: string, data: unknown): Promise<AuthResponse> {
    return parseAuthResponse(await request<unknown>(path, {
      method: "POST",
      data,
      authenticated: false
    }));
  }

  function offeringDoc(value: unknown): Offering {
    return parseOffering(record(value)?.doc);
  }

  return {
    request,
    wxLogin: (code: string) => auth("/auth/operator/wx-login", { code }),
    devLogin: (openid: string) => auth("/auth/operator/dev-login", { openid }),
    selectSeller: (selectionToken: string, sellerId: string | number) =>
      auth("/auth/operator/select-seller", { selectionToken, sellerId }),
    async listOfferings(active: "all" | "true" | "false" = "all"): Promise<Offering[]> {
      const value = await request<unknown>(`/merchant/offerings?active=${active}`);
      const docs = typeof value === "object" && value !== null ? (value as { docs?: unknown }).docs : undefined;
      if (!Array.isArray(docs)) throw new ApiError(502, "invalid-api-response", "菜品数据无效");
      return docs.map(parseOffering);
    },
    async createOffering(input: OfferingCreate): Promise<Offering> {
      return offeringDoc(await request("/merchant/offerings", { method: "POST", data: input }));
    },
    async updateOffering(id: string | number, input: OfferingUpdate): Promise<Offering> {
      return offeringDoc(await request(`/merchant/offerings/${encodeURIComponent(id)}`, { method: "PATCH", data: input }));
    },
    async previewOfferingImport(text: string): Promise<ImportPreviewResponse> {
      return parsePreview(await request("/merchant/offerings/import/preview", {
        method: "POST",
        data: { text }
      }));
    },
    async commitOfferingImport(input: ImportCommitInput): Promise<ImportCommitResponse> {
      return parseCommit(await request("/merchant/offerings/import/commit", {
        method: "POST",
        data: input
      }));
    },
    async listMealSlots(from: string, to: string): Promise<MealSlot[]> {
      const value = await request<unknown>(`/merchant/meal-slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const body = record(value);
      if (!body || !Array.isArray(body.docs)) throw new ApiError(502, "invalid-api-response", "菜单数据无效");
      return body.docs.map(parseMealSlot);
    },
    async generateMenus(input: GenerateMenusInput): Promise<GenerateMenusResponse> {
      return parseGeneration(await request("/merchant/meal-slots/generate-menus", {
        method: "POST",
        data: input
      }));
    },
    async swapMenuItem(mealSlotId: string | number, offeringId: string | number): Promise<SwapMenuItemResponse> {
      return parseSwap(await request(`/merchant/meal-slots/${encodeURIComponent(mealSlotId)}/swap-menu-item`, {
        method: "POST",
        data: { offeringId }
      }));
    }
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
