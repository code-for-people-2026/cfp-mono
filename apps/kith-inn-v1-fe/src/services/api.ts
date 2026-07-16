import type {
  BulkMarkDeliveredResult,
  BookingBatch,
  BookingBatchCreate,
  BookingBatchListResponse,
  BookingBatchMutationResponse,
  CustomerProfile,
  CustomerProfileCreate,
  CustomerBookingBatchView,
  CustomerReservationInput,
  CustomerReservationResponse,
  CustomerReservationResult,
  CustomerSessionResponse,
  ImportCommitInput,
  ImportCommitResponse,
  ImportPreviewResponse,
  GenerateMenusInput,
  GenerateMenusResponse,
  MealSlot,
  MealSlotBookingConfig,
  ManualOrderCreate,
  ManualOrderUpdate,
  Offering,
  OfferingCreate,
  OfferingUpdate,
  RelaxedRule,
  Order,
  OrderAction,
  OrderListResponse,
  OrderResubmit,
  SwapMenuItemResponse
} from "@cfp/kith-inn-v1-shared";
import type { AuthResponse, SellerSelectionResponse } from "@cfp/kith-inn-v1-shared/api";
import type { SessionStore } from "../store/session";
import type { CustomerSessionStore } from "../store/customerSession";
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

function parseCustomerSessionResponse(value: unknown): CustomerSessionResponse {
  const body = record(value);
  const session = record(body?.session);
  if (!body || typeof body.token !== "string" || body.token === "" || !session ||
    Object.hasOwn(session, "sellerId") || Object.hasOwn(session, "openid") ||
    typeof session.sellerName !== "string" || session.sellerName === "" ||
    session.role !== "customer" || typeof session.expiresAt !== "string" ||
    Number.isNaN(Date.parse(session.expiresAt))) {
    throw new ApiError(502, "invalid-api-response", "顾客登录服务返回无效数据");
  }
  return {
    token: body.token,
    session: {
      sellerName: session.sellerName,
      role: "customer",
      expiresAt: session.expiresAt
    }
  };
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
    !validNullableDate(slot.orderDeadline) ||
    !(slot.priceCents === null || (typeof slot.priceCents === "number" && Number.isInteger(slot.priceCents) && slot.priceCents >= 0)) ||
    !(slot.generatedAt === null || typeof slot.generatedAt === "string")) {
    throw new ApiError(502, "invalid-api-response", "菜单数据无效");
  }
  return slot as MealSlot;
}

function parseBookingBatch(value: unknown): BookingBatch {
  const batch = record(value);
  if (!batch || !validId(batch.id) || !validId(batch.sellerId) ||
    typeof batch.publicId !== "string" || batch.publicId === "" ||
    typeof batch.title !== "string" || batch.title === "" ||
    !(batch.status === "open" || batch.status === "closed" || batch.status === "archived") ||
    !Array.isArray(batch.mealSlotIds) || batch.mealSlotIds.length === 0 || !batch.mealSlotIds.every(validId) ||
    !validId(batch.createdById)) {
    throw new ApiError(502, "invalid-api-response", "预订批次数据无效");
  }
  return batch as BookingBatch;
}

function parseBookingBatchMutation(value: unknown): BookingBatchMutationResponse {
  const body = record(value);
  const share = record(body?.share);
  if (!body || !share || typeof share.title !== "string" || share.title === "" ||
    typeof share.path !== "string" || !share.path.startsWith("/pages/booking/index?batch=")) {
    throw new ApiError(502, "invalid-api-response", "预订批次数据无效");
  }
  return { doc: parseBookingBatch(body.doc), share: { title: share.title, path: share.path } };
}

function parseBookingBatchList(value: unknown): BookingBatchListResponse {
  const body = record(value);
  if (!body || !Array.isArray(body.docs)) throw new ApiError(502, "invalid-api-response", "预订批次数据无效");
  return { docs: body.docs.map(parseBookingBatchMutation) };
}

function parseCustomerBookingBatchView(value: unknown): CustomerBookingBatchView {
  const body = record(value);
  if (!body || Object.hasOwn(body, "sellerId") || typeof body.sellerName !== "string" || body.sellerName === "" ||
    typeof body.title !== "string" || body.title === "" ||
    !(body.status === "open" || body.status === "closed" || body.status === "archived") ||
    typeof body.sharePath !== "string" || !body.sharePath.startsWith("/pages/booking/index?batch=") ||
    !Array.isArray(body.slots)) {
    throw new ApiError(502, "invalid-api-response", "预订入口数据无效");
  }
  const slots = body.slots.map((value) => {
    const slot = record(value);
    const items = Array.isArray(slot?.menuItems) ? slot.menuItems.map(record) : [];
    const validItems = items.length === 5 && items.every((item) => item && !Object.hasOwn(item, "offeringId") &&
      typeof item.nameSnapshot === "string" && item.nameSnapshot !== "" &&
      (item.mainIngredientSnapshot === null || typeof item.mainIngredientSnapshot === "string") &&
      (item.categorySnapshot === "meat" || item.categorySnapshot === "veg" || item.categorySnapshot === "soup"));
    const validReason = slot?.unavailableReason === null || slot?.unavailableReason === "booking-batch-closed" ||
      slot?.unavailableReason === "meal-slot-closed" || slot?.unavailableReason === "order-deadline-passed";
    if (!slot || typeof slot.date !== "string" || !(slot.occasion === "lunch" || slot.occasion === "dinner") ||
      !validItems || typeof slot.unitPriceCents !== "number" || !Number.isInteger(slot.unitPriceCents) ||
      slot.unitPriceCents < 0 || !validNullableDate(slot.orderDeadline) || typeof slot.canBook !== "boolean" ||
      !validReason || slot.canBook !== (slot.unavailableReason === null)) {
      throw new ApiError(502, "invalid-api-response", "预订入口数据无效");
    }
    return slot as CustomerBookingBatchView["slots"][number];
  });
  return { ...body, slots } as CustomerBookingBatchView;
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

function parseCustomerProfile(value: unknown): CustomerProfile {
  const profile = record(value);
  if (!profile || Object.hasOwn(profile, "openid") || !validId(profile.id) || !validId(profile.sellerId) ||
    typeof profile.displayName !== "string" || profile.displayName === "" ||
    typeof profile.address !== "string" || profile.address === "" || typeof profile.active !== "boolean") {
    throw new ApiError(502, "invalid-api-response", "顾客资料数据无效");
  }
  return profile as CustomerProfile;
}

function parseOwnedCustomerProfiles(value: unknown): CustomerProfile[] {
  const body = record(value);
  if (!body || !Array.isArray(body.docs)) throw new ApiError(502, "invalid-api-response", "顾客资料数据无效");
  return body.docs.map(parseCustomerProfile);
}

function parseCustomerReservation(value: unknown): CustomerReservationResponse {
  const body = record(value);
  if (!body || !Array.isArray(body.results) || body.results.length < 1 || body.results.length > 20)
    throw new ApiError(502, "invalid-api-response", "预订登记结果无效");
  const profile = parseCustomerProfile(body.profile);
  if (!profile.active) throw new ApiError(502, "invalid-api-response", "预订登记结果无效");
  const results = body.results.map((value) => {
    const result = record(value);
    const target = record(result?.target);
    if (!result || !target || typeof target.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(target.date) ||
      !(target.occasion === "lunch" || target.occasion === "dinner"))
      throw new ApiError(502, "invalid-api-response", "预订登记结果无效");
    if (result.status === "failed" && Object.keys(result).length === 4 && typeof result.error === "string" &&
      result.error !== "" && typeof result.message === "string" && result.message !== "")
      return { target, status: "failed", error: result.error, message: result.message } as CustomerReservationResult;
    if ((result.status === "created" || result.status === "updated" || result.status === "resubmitted") &&
      Object.keys(result).length === 3) {
      const doc = parseOrder(result.doc);
      if (doc.status !== "draft" || doc.source !== "customer-card" || doc.paymentStatus !== "unpaid" ||
        doc.paidAt !== null || doc.deliveryStatus !== "pending" || doc.deliveredAt !== null ||
        doc.confirmedAt !== null || doc.canceledAt !== null || doc.note !== null ||
        String(doc.customerProfileId) !== String(profile.id) || String(doc.sellerId) !== String(profile.sellerId))
        throw new ApiError(502, "invalid-api-response", "预订登记结果无效");
      return { target, status: result.status, doc } as CustomerReservationResult;
    }
    throw new ApiError(502, "invalid-api-response", "预订登记结果无效");
  });
  if (new Set(results.map(({ target }) => `${target.date}:${target.occasion}`)).size !== results.length)
    throw new ApiError(502, "invalid-api-response", "预订登记结果无效");
  return { profile: { ...profile, active: true }, results };
}

function validNullableDate(value: unknown): boolean {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function parseOrder(value: unknown): Order {
  const order = record(value);
  if (!order || !validId(order.id) || !validId(order.sellerId) || !validId(order.mealSlotId) ||
    !validId(order.customerProfileId) ||
    !(order.status === "draft" || order.status === "confirmed" || order.status === "canceled") ||
    !(["customer-card", "manual", "jielong-import"] as const).includes(order.source as Order["source"]) ||
    typeof order.displayName !== "string" || order.displayName === "" ||
    typeof order.address !== "string" || order.address === "" ||
    typeof order.quantity !== "number" || !Number.isInteger(order.quantity) || order.quantity <= 0 ||
    typeof order.unitPriceCents !== "number" || !Number.isInteger(order.unitPriceCents) || order.unitPriceCents < 0 ||
    order.totalCents !== order.quantity * order.unitPriceCents ||
    !(order.paymentStatus === "unpaid" || order.paymentStatus === "paid") || !validNullableDate(order.paidAt) ||
    !(order.deliveryStatus === "pending" || order.deliveryStatus === "done") || !validNullableDate(order.deliveredAt) ||
    !validNullableDate(order.confirmedAt) || !validNullableDate(order.canceledAt) ||
    !(order.note === null || typeof order.note === "string")) {
    throw new ApiError(502, "invalid-api-response", "订单数据无效");
  }
  return order as Order;
}

function parseOrderSummary(value: unknown): OrderListResponse["summary"] {
  const summary = record(value);
  const keys = ["confirmedOrders", "totalQuantity", "unpaid", "pendingDelivery"] as const;
  if (!summary || keys.some((key) => typeof summary[key] !== "number" ||
    !Number.isInteger(summary[key]) || (summary[key] as number) < 0)) {
    throw new ApiError(502, "invalid-api-response", "订单汇总无效");
  }
  return summary as OrderListResponse["summary"];
}

function parseOrderList(value: unknown): OrderListResponse {
  const body = record(value);
  if (!body || !Array.isArray(body.docs)) throw new ApiError(502, "invalid-api-response", "订单数据无效");
  return {
    mealSlot: parseMealSlot(body.mealSlot),
    docs: body.docs.map(parseOrder),
    summary: parseOrderSummary(body.summary)
  };
}

function parseBulkMarkDelivered(value: unknown): BulkMarkDeliveredResult[] {
  const body = record(value);
  if (!body || !Array.isArray(body.results)) {
    throw new ApiError(502, "invalid-api-response", "批量送达结果无效");
  }
  return body.results.map((value) => {
    const result = record(value);
    if (!result || !validId(result.id)) {
      throw new ApiError(502, "invalid-api-response", "批量送达结果无效");
    }
    if (result.status === "updated" && !Object.hasOwn(result, "error")) {
      return { id: result.id, status: "updated" };
    }
    if (result.status === "failed" && typeof result.error === "string" && result.error !== "") {
      return { id: result.id, status: "failed", error: result.error };
    }
    throw new ApiError(502, "invalid-api-response", "批量送达结果无效");
  });
}

type ClientOptions = {
  request: RequestAdapter;
  sessions: SessionStore;
  customerSessions?: CustomerSessionStore;
  baseUrl?: string;
  onAuthFailure?: (status: 401 | 403) => void;
};

export function createApiClient(options: ClientOptions) {
  const baseUrl = resolveBeBaseUrl(options.baseUrl ?? process.env.BE_BASE_URL);

  async function request<T>(
    path: string,
    config: {
      method?: "GET" | "POST" | "PATCH";
      data?: unknown;
      authenticated?: boolean;
      clearOperatorSession?: boolean;
    } = {}
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
    if ((response.statusCode === 401 || response.statusCode === 403) && config.clearOperatorSession !== false) {
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

  async function customerAuth(path: string, data: unknown): Promise<CustomerSessionResponse> {
    return parseCustomerSessionResponse(await request<unknown>(path, {
      method: "POST",
      data,
      authenticated: false,
      clearOperatorSession: false
    }));
  }

  async function customerRequest(path: string, config: { method?: "GET" | "POST"; data?: unknown } = {}): Promise<unknown> {
    const token = options.customerSessions?.getSession()?.token;
    const header: Record<string, string> = { "content-type": "application/json" };
    if (token) header.Authorization = `Bearer ${token}`;
    const response = await options.request({ url: `${baseUrl}${path}`, method: config.method ?? "GET",
      ...(config.data === undefined ? {} : { data: config.data }), header });
    if (response.statusCode >= 200 && response.statusCode < 300) return response.data;
    const parsed = parseError(response.data);
    if (response.statusCode === 401 || response.statusCode === 403) options.customerSessions?.clearSession();
    throw new ApiError(
      response.statusCode,
      parsed?.error ?? "request-failed",
      parsed?.message ?? "请求失败",
      response.data
    );
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
    customerWxSession: (code: string, batchPublicId: string) =>
      customerAuth("/auth/customer/wx-session", { code, batchPublicId }),
    customerDevSession: (openid: string, batchPublicId: string) =>
      customerAuth("/auth/customer/dev-session", { openid, batchPublicId }),
    async getPublicBookingBatch(publicId: string): Promise<CustomerBookingBatchView> {
      return parseCustomerBookingBatchView(await customerRequest(
        `/public/booking-batches/${encodeURIComponent(publicId)}`
      ));
    },
    async listOwnedCustomerProfiles(): Promise<CustomerProfile[]> {
      return parseOwnedCustomerProfiles(await customerRequest("/customer/profiles"));
    },
    async submitCustomerReservations(input: CustomerReservationInput): Promise<CustomerReservationResponse> {
      return parseCustomerReservation(await customerRequest("/customer/reservations", { method: "POST", data: input }));
    },
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
    },
    async updateMealSlotBookingConfig(
      mealSlotId: string | number,
      input: MealSlotBookingConfig
    ): Promise<MealSlot> {
      const body = record(await request(`/merchant/meal-slots/${encodeURIComponent(mealSlotId)}/booking-config`, {
        method: "PATCH",
        data: input
      }));
      return parseMealSlot(body?.doc);
    },
    async listBookingBatches(status?: BookingBatch["status"]): Promise<BookingBatchListResponse["docs"]> {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return parseBookingBatchList(await request(`/merchant/booking-batches${query}`)).docs;
    },
    async createBookingBatch(input: BookingBatchCreate): Promise<BookingBatchMutationResponse> {
      return parseBookingBatchMutation(await request("/merchant/booking-batches", { method: "POST", data: input }));
    },
    async closeBookingBatch(id: string | number): Promise<BookingBatchMutationResponse> {
      return parseBookingBatchMutation(await request(`/merchant/booking-batches/${encodeURIComponent(id)}`, {
        method: "PATCH",
        data: { status: "closed" }
      }));
    },
    async listCustomerProfiles(query = ""): Promise<CustomerProfile[]> {
      const value = await request<unknown>(`/merchant/customer-profiles?query=${encodeURIComponent(query)}`);
      const body = record(value);
      if (!body || !Array.isArray(body.docs)) throw new ApiError(502, "invalid-api-response", "顾客资料数据无效");
      return body.docs.map(parseCustomerProfile);
    },
    async createCustomerProfile(input: CustomerProfileCreate): Promise<CustomerProfile> {
      const value = await request<unknown>("/merchant/customer-profiles", { method: "POST", data: input });
      return parseCustomerProfile(record(value)?.doc);
    },
    async listOrders(date: string, occasion: "lunch" | "dinner"): Promise<OrderListResponse> {
      return parseOrderList(await request(
        `/merchant/orders?date=${encodeURIComponent(date)}&occasion=${encodeURIComponent(occasion)}`
      ));
    },
    async createOrder(input: ManualOrderCreate): Promise<{ doc: Order; profile: CustomerProfile }> {
      const body = record(await request("/merchant/orders", { method: "POST", data: input }));
      if (!body) throw new ApiError(502, "invalid-api-response", "订单数据无效");
      return { doc: parseOrder(body.doc), profile: parseCustomerProfile(body.profile) };
    },
    async updateOrder(id: string | number, input: ManualOrderUpdate): Promise<Order> {
      const body = record(await request(`/merchant/orders/${encodeURIComponent(id)}`, { method: "PATCH", data: input }));
      return parseOrder(body?.doc);
    },
    async bulkMarkDelivered(ids: Array<string | number>): Promise<BulkMarkDeliveredResult[]> {
      return parseBulkMarkDelivered(await request("/merchant/orders/bulk-mark-delivered", {
        method: "POST",
        data: { ids }
      }));
    },
    async actOnOrder(id: string | number, action: OrderAction, input?: OrderResubmit): Promise<Order> {
      const body = record(await request(
        `/merchant/orders/${encodeURIComponent(id)}/${action}`,
        { method: "POST", ...(input === undefined ? {} : { data: input }) }
      ));
      return parseOrder(body?.doc);
    }
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
