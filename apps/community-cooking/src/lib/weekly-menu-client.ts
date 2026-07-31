import {
  assertPlanCanDelete,
  confirmedPlanDtoSchema,
  confirmDraftPlan,
  copyConfirmedPlan,
  createDishChecklist,
  dishChecklistDtoSchema,
  draftPlanDtoSchema,
  generateDraftPlan,
  planListDtoSchema,
  replaceDraftPlanDish,
  WeeklyMenuDomainError,
  weeklyMenuPlanDtoSchema,
  type ConfirmedPlanDto,
  type DishChecklistDto,
  type DishPools,
  type DraftPlanDto,
  type ReplaceDishInput,
  type WeeklyMenuPlanDto
} from "@cfp/weekly-menu-shared";
import Taro from "@tarojs/taro";

export type WeeklyMenuSession = Readonly<{
  displayName: string;
}>;

// 页面只依赖能力，不依赖 Mock 的存储方式，也不提前猜测真实 HTTP 路由细节。
export interface WeeklyMenuClient {
  restoreSession(): Promise<WeeklyMenuSession | null>;
  login(): Promise<WeeklyMenuSession>;
  generateDraft(): Promise<DraftPlanDto>;
  replaceDraftDish(
    plan: DraftPlanDto,
    input: ReplaceDishInput
  ): Promise<DraftPlanDto>;
  saveDraft(plan: DraftPlanDto): Promise<DraftPlanDto>;
  confirmDraft(plan: DraftPlanDto): Promise<ConfirmedPlanDto>;
  listPlans(): Promise<WeeklyMenuPlanDto[]>;
  getPlan(id: string): Promise<WeeklyMenuPlanDto>;
  copyConfirmed(id: string): Promise<DraftPlanDto>;
  deleteDraft(id: string): Promise<void>;
  getDishChecklist(id: string): Promise<DishChecklistDto>;
}

export type MockClientErrorCode = "LOGIN_REQUIRED" | "PLAN_NOT_FOUND";

export class MockClientError extends Error {
  readonly code: MockClientErrorCode;

  constructor(code: MockClientErrorCode) {
    super(code);
    this.name = "MockClientError";
    this.code = code;
  }
}

const MOCK_USER: WeeklyMenuSession = {
  displayName: "学习用户"
};
const MOCK_OWNER_ID = "mock-user";

const MOCK_DISH_POOLS: DishPools = {
  bigMeat: ["红烧肉", "可乐鸡翅", "糖醋排骨", "土豆炖牛肉", "清蒸鲈鱼"],
  smallMeat: ["番茄炒蛋", "青椒肉丝", "肉末豆腐", "虾仁蒸蛋", "木须肉"],
  vegetable: ["蒜蓉西兰花", "清炒时蔬", "醋溜白菜", "蚝油生菜", "香菇菜心"]
};

type MockClientOptions = Readonly<{
  now?: () => Date;
  random?: () => number;
  nextId?: () => string;
}>;

function mondayOf(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(monday.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createMockWeeklyMenuClient(
  options: MockClientOptions = {}
): WeeklyMenuClient {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  let sequence = 0;
  const nextId =
    options.nextId ?? (() => `mock-plan-${now().getTime()}-${(sequence += 1)}`);
  // 单用户 Mock 只保存当前登录用户的数据；真实所有权由后端 Issue 验证。
  const plans = new Map<string, WeeklyMenuPlanDto>();
  let session: WeeklyMenuSession | null = null;

  function requireSession(): WeeklyMenuSession {
    if (!session) {
      throw new MockClientError("LOGIN_REQUIRED");
    }
    return session;
  }

  function findOwnedPlan(id: string): WeeklyMenuPlanDto {
    requireSession();
    const plan = plans.get(id);
    if (!plan) {
      throw new MockClientError("PLAN_NOT_FOUND");
    }
    return plan;
  }

  function storePlan(plan: WeeklyMenuPlanDto): WeeklyMenuPlanDto {
    requireSession();
    const parsed = weeklyMenuPlanDtoSchema.parse(plan);
    plans.set(parsed.id, parsed);
    return parsed;
  }

  function assertStoredPlanMutable(id: string): void {
    if (plans.get(id)?.status === "confirmed") {
      throw new WeeklyMenuDomainError("PLAN_IMMUTABLE");
    }
  }

  return {
    async restoreSession() {
      return session;
    },

    async login() {
      session = MOCK_USER;
      return session;
    },

    async generateDraft() {
      requireSession();
      return storePlan(generateDraftPlan(
        {
          id: nextId(),
          weekStart: mondayOf(now()),
          dishPools: MOCK_DISH_POOLS
        },
        random
      )) as DraftPlanDto;
    },

    async replaceDraftDish(plan, input) {
      requireSession();
      const draft = draftPlanDtoSchema.parse(plan);
      assertStoredPlanMutable(draft.id);
      findOwnedPlan(draft.id);
      return storePlan(replaceDraftPlanDish(
        draft,
        { actorId: MOCK_OWNER_ID, ownerId: MOCK_OWNER_ID },
        input,
        MOCK_DISH_POOLS,
        undefined,
        random
      )) as DraftPlanDto;
    },

    async saveDraft(plan) {
      requireSession();
      const draft = draftPlanDtoSchema.parse(plan);
      findOwnedPlan(draft.id);
      assertStoredPlanMutable(draft.id);
      assertPlanCanDelete(draft, {
        actorId: MOCK_OWNER_ID,
        ownerId: MOCK_OWNER_ID
      });
      return storePlan(draft) as DraftPlanDto;
    },

    async confirmDraft(plan) {
      requireSession();
      const input = draftPlanDtoSchema.parse(plan);
      assertStoredPlanMutable(input.id);
      const draft = draftPlanDtoSchema.parse(findOwnedPlan(input.id));
      const confirmed = confirmDraftPlan(
        draft,
        { actorId: MOCK_OWNER_ID, ownerId: MOCK_OWNER_ID },
        now().toISOString()
      );
      return storePlan(confirmed) as ConfirmedPlanDto;
    },

    async listPlans() {
      requireSession();
      return [...plans.values()]
        .map((plan) => weeklyMenuPlanDtoSchema.parse(plan))
        .sort((left, right) =>
          right.weekStart.localeCompare(left.weekStart) ||
          right.id.localeCompare(left.id)
        );
    },

    async getPlan(id) {
      return weeklyMenuPlanDtoSchema.parse(findOwnedPlan(id));
    },

    async copyConfirmed(id) {
      requireSession();
      const source = findOwnedPlan(id);
      const copy = copyConfirmedPlan(
        source,
        { actorId: MOCK_OWNER_ID, ownerId: MOCK_OWNER_ID },
        { id: nextId(), weekStart: addDays(source.weekStart, 7) }
      );
      return storePlan(copy) as DraftPlanDto;
    },

    async deleteDraft(id) {
      requireSession();
      const plan = findOwnedPlan(id);
      assertPlanCanDelete(plan, {
        actorId: MOCK_OWNER_ID,
        ownerId: MOCK_OWNER_ID
      });
      plans.delete(id);
    },

    async getDishChecklist(id) {
      requireSession();
      const plan = findOwnedPlan(id);
      return createDishChecklist(plan, {
        actorId: MOCK_OWNER_ID,
        ownerId: MOCK_OWNER_ID
      });
    }
  };
}

const SESSION_STORAGE_KEY = "weekly-menu:api-session";
const REQUEST_TIMEOUT_MS = 5_000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type StoredApiSession = Readonly<{
  token: string;
  expiresAt: string;
}>;

type RequestMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

type ApiPlatform = Readonly<{
  getStorageSync(key: string): unknown;
  login(): Promise<{ code: string }>;
  removeStorageSync(key: string): void;
  request(input: Readonly<{
    data?: unknown;
    header: Record<string, string>;
    method: RequestMethod;
    timeout: number;
    url: string;
  }>): Promise<Readonly<{ data: unknown; statusCode: number }>>;
  setStorageSync(key: string, value: StoredApiSession): void;
}>;

export type RealClientErrorCode =
  | "API_UNAVAILABLE"
  | "CONFIG_REQUIRED"
  | "LOGIN_FAILED"
  | "REQUEST_FAILED"
  | "SESSION_EXPIRED"
  | "SESSION_REQUIRED";

export class RealClientError extends Error {
  constructor(
    readonly code: RealClientErrorCode,
    readonly backendCode?: string
  ) {
    super(
      code === "SESSION_EXPIRED" || code === "SESSION_REQUIRED"
        ? "登录已失效，请重新登录"
        : code === "CONFIG_REQUIRED"
          ? "真实 API 尚未配置"
          : code === "LOGIN_FAILED"
            ? "微信登录失败，请重试"
            : "服务暂时不可用，请稍后重试"
    );
    this.name = "RealClientError";
  }
}

type ResponseSchema<T> = Readonly<{ parse(value: unknown): T }>;

type RealClientOptions = Readonly<{
  baseUrl: string;
  now?: () => Date;
  platform?: ApiPlatform;
}>;

function defaultPlatform(): ApiPlatform {
  return {
    getStorageSync: (key) => Taro.getStorageSync(key) as unknown,
    login: async () => Taro.login(),
    removeStorageSync: (key) => Taro.removeStorageSync(key),
    request: async (input) => Taro.request(input),
    setStorageSync: (key, value) => Taro.setStorageSync(key, value)
  };
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, "");
  if (
    !/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/.test(
      baseUrl
    )
  ) {
    throw new RealClientError("CONFIG_REQUIRED");
  }
  return baseUrl;
}

function parseStoredSession(value: unknown, now: Date): StoredApiSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.token !== "string" ||
    !SESSION_TOKEN_PATTERN.test(record.token) ||
    typeof record.expiresAt !== "string"
  ) {
    return null;
  }
  const expiresAt = new Date(record.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) return null;
  return { token: record.token, expiresAt: expiresAt.toISOString() };
}

function parseLoginResponse(value: unknown, now: Date): StoredApiSession {
  const session = parseStoredSession(value, now);
  if (!session) throw new RealClientError("LOGIN_FAILED");
  return session;
}

function parseBackendCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)
    ? code
    : undefined;
}

export function createRealWeeklyMenuClient(options: RealClientOptions): WeeklyMenuClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const platform = options.platform ?? defaultPlatform();
  const now = options.now ?? (() => new Date());

  function clearSession(): void {
    platform.removeStorageSync(SESSION_STORAGE_KEY);
  }

  function storedSession(): StoredApiSession | null {
    const session = parseStoredSession(platform.getStorageSync(SESSION_STORAGE_KEY), now());
    if (!session) clearSession();
    return session;
  }

  async function request<T>(input: Readonly<{
    authenticated?: boolean;
    body?: unknown;
    method: RequestMethod;
    path: string;
    schema: ResponseSchema<T>;
  }>): Promise<T> {
    const session = input.authenticated === false ? null : storedSession();
    if (input.authenticated !== false && !session) {
      throw new RealClientError("SESSION_REQUIRED");
    }
    try {
      const response = await platform.request({
        url: `${baseUrl}${input.path}`,
        method: input.method,
        timeout: REQUEST_TIMEOUT_MS,
        header: {
          accept: "application/json",
          ...(input.body === undefined ? {} : { "content-type": "application/json" }),
          ...(session ? { authorization: `Bearer ${session.token}` } : {})
        },
        ...(input.body === undefined ? {} : { data: input.body })
      });
      if (response.statusCode === 401) {
        clearSession();
        throw new RealClientError("SESSION_EXPIRED");
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new RealClientError("REQUEST_FAILED", parseBackendCode(response.data));
      }
      return input.schema.parse(response.data);
    } catch (error) {
      if (error instanceof RealClientError) throw error;
      throw new RealClientError("API_UNAVAILABLE");
    }
  }

  return {
    async restoreSession() {
      return storedSession()
        ? { displayName: "微信用户" }
        : null;
    },

    async login() {
      try {
        const result = await platform.login();
        const code = result.code.trim();
        if (!code || code.length > 256) throw new RealClientError("LOGIN_FAILED");
        const session = await request({
          authenticated: false,
          method: "POST",
          path: "/api/v1/auth/wechat",
          body: { code },
          schema: { parse: (value) => parseLoginResponse(value, now()) }
        });
        platform.setStorageSync(SESSION_STORAGE_KEY, session);
        return { displayName: "微信用户" };
      } catch {
        throw new RealClientError("LOGIN_FAILED");
      }
    },

    async generateDraft() {
      return request({
        method: "POST",
        path: "/api/v1/weekly-menu/plans/generate",
        body: { weekStart: mondayOf(now()) },
        schema: draftPlanDtoSchema
      });
    },

    async replaceDraftDish(plan, input) {
      const draft = draftPlanDtoSchema.parse(plan);
      return request({
        method: "PATCH",
        path: `/api/v1/weekly-menu/plans/${encodeURIComponent(draft.id)}/dish`,
        body: input,
        schema: draftPlanDtoSchema
      });
    },

    async saveDraft(plan) {
      const draft = draftPlanDtoSchema.parse(plan);
      return request({
        method: "PUT",
        path: `/api/v1/weekly-menu/plans/${encodeURIComponent(draft.id)}`,
        body: draft,
        schema: draftPlanDtoSchema
      });
    },

    async confirmDraft(plan) {
      const draft = draftPlanDtoSchema.parse(plan);
      return request({
        method: "POST",
        path: `/api/v1/weekly-menu/plans/${encodeURIComponent(draft.id)}/confirm`,
        schema: confirmedPlanDtoSchema
      });
    },

    async listPlans() {
      const items: WeeklyMenuPlanDto[] = [];
      const loadPage = async (offset: number): Promise<WeeklyMenuPlanDto[]> => {
        const response = await request({
          method: "GET",
          path: `/api/v1/weekly-menu/plans?limit=50&offset=${offset}`,
          schema: planListDtoSchema
        });
        if (response.page.offset !== offset) {
          throw new RealClientError("REQUEST_FAILED");
        }
        if (response.page.limit !== 50) {
          throw new RealClientError("REQUEST_FAILED");
        }
        items.push(...response.items);
        if (!response.page.hasMore) return items;
        if (response.items.length === 0) throw new RealClientError("REQUEST_FAILED");
        const nextOffset = offset + response.page.limit;
        if (nextOffset > 10_000) throw new RealClientError("REQUEST_FAILED");
        return loadPage(nextOffset);
      };
      return loadPage(0);
    },

    async getPlan(id) {
      return request({
        method: "GET",
        path: `/api/v1/weekly-menu/plans/${encodeURIComponent(id)}`,
        schema: weeklyMenuPlanDtoSchema
      });
    },

    async copyConfirmed(id) {
      return request({
        method: "POST",
        path: `/api/v1/weekly-menu/plans/${encodeURIComponent(id)}/copy`,
        schema: draftPlanDtoSchema
      });
    },

    async deleteDraft(id) {
      await request({
        method: "DELETE",
        path: `/api/v1/weekly-menu/plans/${encodeURIComponent(id)}`,
        schema: { parse: () => undefined }
      });
    },

    async getDishChecklist(id) {
      return request({
        method: "GET",
        path: `/api/v1/weekly-menu/plans/${encodeURIComponent(id)}/dish-checklist`,
        schema: dishChecklistDtoSchema
      });
    }
  };
}

export type WeeklyMenuClientMode = "mock" | "real";

export function selectWeeklyMenuClient(input: Readonly<{
  baseUrl?: string;
  realOptions?: Omit<RealClientOptions, "baseUrl">;
}> = {}): Readonly<{ client: WeeklyMenuClient; mode: WeeklyMenuClientMode }> {
  if (!input.baseUrl?.trim()) {
    return { client: createMockWeeklyMenuClient(), mode: "mock" };
  }
  return {
    client: createRealWeeklyMenuClient({
      baseUrl: input.baseUrl,
      ...input.realOptions
    }),
    mode: "real"
  };
}

const selectedClient = selectWeeklyMenuClient({
  baseUrl: process.env.TARO_APP_WEEKLY_MENU_API_BASE_URL
});

export const weeklyMenuClient = selectedClient.client;
export const weeklyMenuClientMode = selectedClient.mode;
