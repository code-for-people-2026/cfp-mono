import Taro from "@tarojs/taro";
import {
  DishBatchInputSchema, DishBatchResultSchema, DishListSchema, DishSchema, DishUpdateInputSchema,
  ErrorResponseSchema, IdSchema, LoginInputSchema, SessionSchema,
  type Dish, type DishBatchInput, type DishUpdateInput, type ErrorDetails, type Session
} from "@cfp/kith-inn-contracts";

const timeout = 10_000;
const receiptLifetime = 24 * 60 * 60 * 1000;
type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Response = { statusCode: number; data: unknown; header?: Record<string, unknown> };
type Task = Promise<Response> & { abort?: () => void };
export type ApiPlatform = {
  login(): Promise<{ code: string }>;
  randomBytes(): Promise<Uint8Array>;
  request(input: { url: string; method: Method; header: Record<string, string>; timeout: number; data?: string }): Task;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: Session): void;
  removeStorageSync(key: string): void;
};

export class ClientError extends Error {
  constructor(readonly code: string, readonly details?: ErrorDetails, readonly status?: number, readonly retryAt?: number) {
    const messages: Record<string, string> = {
      CONFIG_REQUIRED: "请先配置街坊味服务地址", UNAUTHORIZED: "请重新登录", FORBIDDEN: "当前微信账号没有经营权限",
      LOGIN_FAILED: "微信登录失败，请重试", WECHAT_REQUIRED: "请在微信小程序中登录", STORAGE_FAILED: "无法保存本机会话，请重试",
      INVALID_REQUEST: "请检查输入内容", DUPLICATE_DISH_NAME: "菜名重复，请修改清单或恢复已停用菜品",
      VERSION_CONFLICT: "菜品已在另一处更新，请重新读取后再调整", BUSY: "正在处理，请稍候",
      PENDING_WRITE: "上次保存结果尚未确认，请先重试原请求或读取核对", REVIEW_REQUIRED: "请先读取菜品池并核对上次保存结果",
      REQUEST_UNKNOWN: "请求结果未确认，可能已保存，请重试原请求", RANDOM_UNAVAILABLE: "无法生成安全请求标识，请更新微信后重试",
      RATE_LIMITED: "操作太频繁，请稍后重试原请求", IDEMPOTENCY_KEY_REUSED: "请求标识有冲突，请读取核对后再提交",
      LIMIT_EXCEEDED: "已达到数量限制，请调整后重试", PAYLOAD_TOO_LARGE: "本次内容过多，请减少菜品后重试",
      WECHAT_LOGIN_FAILED: "微信登录失败，请重新登录"
    };
    super(messages[code] ?? "操作未完成，请稍后重试");
    this.name = "ClientError";
  }
}

export function taroPlatform(): ApiPlatform {
  return {
    login: () => {
      if (process.env.TARO_ENV !== "weapp") return Promise.reject(new ClientError("WECHAT_REQUIRED"));
      return Taro.login({ timeout });
    },
    randomBytes: async () => {
      try {
        if (process.env.TARO_ENV === "weapp") {
          return await new Promise<Uint8Array>((resolve, reject) => {
            Taro.getUserCryptoManager().getRandomValues({
              length: 16, success: (value) => resolve(new Uint8Array(value.randomValues)), fail: reject
            });
          });
        }
        return globalThis.crypto.getRandomValues(new Uint8Array(16));
      } catch { throw new ClientError("RANDOM_UNAVAILABLE"); }
    },
    request: (input) => Taro.request(input),
    getStorageSync: (key) => Taro.getStorageSync(key) as unknown,
    setStorageSync: (key, value) => Taro.setStorageSync(key, value),
    removeStorageSync: (key) => Taro.removeStorageSync(key)
  };
}

async function deadline<T>(task: Promise<T> & { abort?: () => void }): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ClientError("REQUEST_UNKNOWN"));
        try { task.abort?.(); } catch { /* The result stays unknown even if cancellation fails. */ }
      }, timeout);
    })]);
  } finally { clearTimeout(timer!); }
}

type Pending = { kind: "batch" | "update"; path: string; body: string; key: string; createdAt: number; state: "unknown" | "rejected" | "review" };
export type WriteResult = { kind: "batch"; items: Dish[] } | { kind: "update"; dish: Dish };
const rejectionStatuses: Record<string, number> = {
  INVALID_REQUEST: 400, NOT_FOUND: 404, DUPLICATE_DISH_NAME: 409, VERSION_CONFLICT: 409,
  DISH_UNAVAILABLE: 409, LIMIT_EXCEEDED: 422, PAYLOAD_TOO_LARGE: 413
};

export function createKithInnClient(options: {
  baseUrl?: string; platform?: ApiPlatform; now?: () => number;
} = {}) {
  const baseUrl = (options.baseUrl ?? process.env.TARO_APP_KITH_INN_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const address = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/i.exec(baseUrl);
  if (!address || (address[2] && (+address[2] < 1 || +address[2] > 65535))) throw new ClientError("CONFIG_REQUIRED");
  const storageKey = `kith-inn:session:v1:${baseUrl}`;
  const platform = options.platform ?? taroPlatform(), now = options.now ?? Date.now;
  let session: Session | null = null, restored = false, busy = false, retryAt = 0;
  let pending: Pending | null = null, reviewedKey: string | null = null;

  function clearSession() {
    session = null;
    restored = true;
    reviewedKey = null;
    try { platform.removeStorageSync(storageKey); } catch { /* Never retain a rejected token in memory. */ }
  }
  function restoreSession(): boolean {
    if (!restored) {
      restored = true;
      try {
        const parsed = SessionSchema.safeParse(platform.getStorageSync(storageKey));
        session = parsed.success ? parsed.data : null;
      } catch { session = null; }
    }
    if (!session || Date.parse(session.expiresAt) <= now()) clearSession();
    return session !== null;
  }
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (busy) throw new ClientError("BUSY");
    busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function request(method: Method, path: string, body?: string, key?: string, authenticate = true): Promise<Response> {
    if (authenticate && !restoreSession()) throw new ClientError("UNAUTHORIZED");
    if (now() < retryAt) throw new ClientError("RATE_LIMITED", undefined, 429, retryAt);
    let response: Response;
    try {
      response = await deadline(platform.request({
        url: `${baseUrl}/api/kith-inn${path}`, method, timeout,
        header: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(authenticate ? { authorization: `Bearer ${session!.token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
        ...(body === undefined ? {} : { data: body })
      }));
    } catch { throw new ClientError("REQUEST_UNKNOWN"); }
    if (response.statusCode === 401 || response.statusCode === 403) {
      clearSession();
      throw new ClientError(response.statusCode === 401 ? "UNAUTHORIZED" : "FORBIDDEN", undefined, response.statusCode);
    }
    if (response.statusCode === 429) {
      const value = String(Object.entries(response.header ?? {}).find(([name]) => name.toLowerCase() === "retry-after")?.[1] ?? "");
      const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now();
      retryAt = now() + (Number.isFinite(delay) && delay >= 0 ? delay : 60_000);
      throw new ClientError("RATE_LIMITED", undefined, 429, retryAt);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const parsed = ErrorResponseSchema.safeParse(response.data);
      if (!parsed.success) throw new ClientError("REQUEST_UNKNOWN");
      throw new ClientError(parsed.data.error.code, parsed.data.error.details, response.statusCode);
    }
    return response;
  }
  async function attempt(): Promise<WriteResult> {
    if (!pending) throw new ClientError("INVALID_REQUEST");
    if (pending.state === "review" || now() - pending.createdAt >= receiptLifetime) throw new ClientError("REVIEW_REQUIRED");
    const operation = pending;
    operation.state = "unknown";
    reviewedKey = null;
    try {
      const response = await request(operation.kind === "batch" ? "POST" : "PATCH", operation.path, operation.body, operation.key);
      const result: WriteResult = operation.kind === "batch"
        ? { kind: "batch", items: DishBatchResultSchema.parse(response.data).items }
        : { kind: "update", dish: DishSchema.parse(response.data) };
      if (response.statusCode !== (operation.kind === "batch" ? 201 : 200)) throw new ClientError("REQUEST_UNKNOWN");
      pending = null;
      return result;
    } catch (error) {
      if (error instanceof ClientError) {
        if (error.status !== undefined && rejectionStatuses[error.code] === error.status) operation.state = "rejected";
        if (error.code === "IDEMPOTENCY_KEY_REUSED") operation.state = "review";
        throw error;
      }
      throw new ClientError("REQUEST_UNKNOWN");
    }
  }
  async function write(kind: Pending["kind"], path: string, body: unknown) {
    if (!restoreSession()) throw new ClientError("UNAUTHORIZED");
    if (pending && pending.state !== "rejected") throw new ClientError("PENDING_WRITE");
    let bytes: Uint8Array;
    try { bytes = await deadline(platform.randomBytes()); }
    catch { throw new ClientError("RANDOM_UNAVAILABLE"); }
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new ClientError("RANDOM_UNAVAILABLE");
    bytes = bytes.slice();
    bytes[6] = (bytes[6]! & 15) | 64;
    bytes[8] = (bytes[8]! & 63) | 128;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const key = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    pending = { kind, path, body: JSON.stringify(body), key, createdAt: now(), state: "unknown" };
    return attempt();
  }

  return {
    restoreSession,
    pendingWrite: () => pending ? { kind: pending.kind, createdAt: pending.createdAt, state: pending.state } : null,
    login: () => exclusive(async () => {
      clearSession();
      let code: string;
      try { code = LoginInputSchema.parse({ code: (await deadline(platform.login())).code }).code; }
      catch (error) { throw error instanceof ClientError ? error : new ClientError("LOGIN_FAILED"); }
      const response = await request("POST", "/sessions/wechat", JSON.stringify({ code }), undefined, false);
      const parsed = SessionSchema.safeParse(response.data);
      if (response.statusCode !== 201 || !parsed.success || Date.parse(parsed.data.expiresAt) <= now()) throw new ClientError("LOGIN_FAILED");
      try { platform.setStorageSync(storageKey, parsed.data); }
      catch { clearSession(); throw new ClientError("STORAGE_FAILED"); }
      // The API's immutable singleton binding permits only the same configured owner.
      // Pending writes stay in this client instance and origin, never in shared storage.
      session = parsed.data;
    }),
    logout: () => exclusive(async () => {
      try {
        const response = await request("DELETE", "/sessions/current");
        if (response.statusCode !== 204) throw new ClientError("REQUEST_UNKNOWN");
      } catch (error) { if (!(error instanceof ClientError && error.code === "UNAUTHORIZED")) throw error; }
      finally { clearSession(); }
    }),
    getDishes: () => exclusive(async () => {
      const readAt = now();
      const response = await request("GET", "/dishes");
      const parsed = DishListSchema.safeParse(response.data);
      if (response.statusCode !== 200 || !parsed.success) throw new ClientError("REQUEST_UNKNOWN");
      reviewedKey = pending && (pending.state !== "unknown" || readAt - pending.createdAt >= receiptLifetime) ? pending.key : null;
      return parsed.data.items;
    }),
    addDishes: (input: DishBatchInput) => exclusive(() => {
      const parsed = DishBatchInputSchema.safeParse(input);
      if (!parsed.success) throw new ClientError("INVALID_REQUEST");
      return write("batch", "/dishes", parsed.data);
    }),
    updateDish: (id: string, input: DishUpdateInput) => exclusive(() => {
      const parsed = DishUpdateInputSchema.safeParse(input);
      if (!IdSchema.safeParse(id).success || !parsed.success) throw new ClientError("INVALID_REQUEST");
      return write("update", `/dishes/${id.toLowerCase()}`, parsed.data);
    }),
    retryPendingWrite: () => exclusive(attempt),
    discardPendingAfterReview: () => {
      if (busy) throw new ClientError("BUSY");
      // A read can finish before a timed-out write commits; it cannot unlock a new key.
      if (pending?.state === "unknown" && now() - pending.createdAt < receiptLifetime) throw new ClientError("PENDING_WRITE");
      if (!pending || reviewedKey !== pending.key) throw new ClientError("REVIEW_REQUIRED");
      pending = null;
      reviewedKey = null;
    }
  };
}
