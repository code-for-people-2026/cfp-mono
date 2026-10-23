import { createHash, randomBytes } from "node:crypto";
import { AppError, type Baby, type LegacyBackend, type LegacyUser } from "./contracts";

type Doc = Record<string, unknown>;
type Where = Record<string, unknown>;
type Collection = "app-users" | "baby-users" | "babies" | "activities" | "daily-stats";
interface LegacyHttpOptions {
  origin: string;
  cmsEmail: string;
  cmsPassword: string;
  fetch?: typeof fetch;
}
const upstreamFailure = () => new AppError(502, "LEGACY_UNAVAILABLE", "旧版服务暂时不可用，请稍后重试");
const invalidCredentials = () => new AppError(401, "LEGACY_CREDENTIALS_INVALID", "旧账号或密码不正确");
const scopeFailure = () => new AppError(502, "LEGACY_SCOPE_INVALID", "旧版服务返回了不匹配的宝宝范围");
const isDoc = (value: unknown): value is Doc => !!value && typeof value === "object" && !Array.isArray(value);
function id(value: unknown): string | null {
  if (typeof value === "string" && value.length && value.length <= 256) return value;
  if (isDoc(value)) return id(value.id);
  return null;
}
function doc(value: unknown): Doc {
  if (!isDoc(value)) throw upstreamFailure();
  return value;
}
function baby(value: unknown): Baby {
  const row = doc(value);
  const babyId = id(row.id);
  if (!babyId || typeof row.name !== "string") throw upstreamFailure();
  const text = (field: string) => typeof row[field] === "string" ? row[field] as string : null;
  return { id: babyId, name: row.name, fullName: text("fullName"), avatarUrl: text("avatarUrl"), birthDate: text("birthDate"), gender: text("gender") };
}
function putQuery(query: URLSearchParams, key: string, value: unknown): void {
  if (Array.isArray(value)) value.forEach((item, index) => putQuery(query, `${key}[${index}]`, item));
  else if (isDoc(value)) Object.entries(value).forEach(([child, item]) => putQuery(query, `${key}[${child}]`, item));
  else if (value !== undefined) query.set(key, String(value));
}
function isoDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
// Same Asia/Shanghai day boundaries as the original GET routes. No metrics are recomputed.
function chinaDay(value: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD");
  const start = isoDate(`${value}T00:00:00+08:00`);
  const end = isoDate(`${value}T23:59:59.999+08:00`);
  if (!start || !end) throw new AppError(400, "INVALID_DATE", "日期格式无效");
  return { start, end };
}
function deterministicId(kind: string, identityId: string): string {
  const hash = createHash("sha256").update(`bubu-log-miniapp:v1:${kind}:${identityId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Only this server-side adapter holds the legacy CMS credential. Never expose it as a generic proxy. */
export class HttpLegacyBackend implements LegacyBackend {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private cmsToken?: { value: string; expiresAt: number };
  private loginPending?: Promise<string>;

  constructor(private readonly options: LegacyHttpOptions) {
    let url: URL;
    try { url = new URL(options.origin); } catch { throw new AppError(503, "LEGACY_CONFIG_INVALID", "旧版服务地址未正确配置"); }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new AppError(503, "LEGACY_CONFIG_INVALID", "旧版服务须使用 HTTPS 或本机地址");
    }
    this.origin = url.origin;
    this.fetcher = options.fetch ?? fetch;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      const response = await this.fetcher(`${this.origin}${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (response.status >= 300 && response.status < 400) throw upstreamFailure();
      return response;
    } catch { throw upstreamFailure(); }
  }

  private async json(response: Response): Promise<unknown> {
    try { return await response.json(); } catch { throw upstreamFailure(); }
  }

  async verifyCredentials(username: string, password: string): Promise<LegacyUser> {
    if (!username.trim() || username.length > 320 || !password || password.length > 256) throw invalidCredentials();
    // A fresh, in-memory cookie jar prevents caller cookies or a prior attempt from proving identity.
    const cookies = new Map<string, string>();
    const collect = (response: Response) => {
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";", 1)[0] || "";
        const equals = pair.indexOf("=");
        const name = pair.slice(0, equals);
        if (equals < 1 || !/^(?:(?:__Secure|__Host)-)?(?:authjs|next-auth)\.(?:csrf-token|callback-url|session-token(?:\.\d+)?)$/.test(name)) continue;
        const value = pair.slice(equals + 1);
        if (!value || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(header)) cookies.delete(name);
        else cookies.set(name, value);
      }
    };
    const cookieHeader = () => Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
    try {
      const csrfResponse = await this.request("/api/auth/csrf");
      if (!csrfResponse.ok) throw upstreamFailure();
      collect(csrfResponse);
      const csrf = doc(await this.json(csrfResponse)).csrfToken;
      if (typeof csrf !== "string" || !csrf || csrf.length > 1024 || !cookies.size) throw upstreamFailure();
      const callback = await this.request("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1", Cookie: cookieHeader() },
        body: new URLSearchParams({ username, password, csrfToken: csrf, callbackUrl: this.origin }).toString(),
      });
      if (!callback.ok) {
        if (callback.status >= 400 && callback.status < 500) throw invalidCredentials();
        throw upstreamFailure();
      }
      collect(callback);
      const result = doc(await this.json(callback));
      if (typeof result.url !== "string") throw upstreamFailure();
      let destination: URL;
      try { destination = new URL(result.url, this.origin); } catch { throw upstreamFailure(); }
      if (destination.origin !== this.origin) throw upstreamFailure();
      if (destination.searchParams.has("error")) throw invalidCredentials();
      if (![...cookies.keys()].some((name) => name.includes("session-token"))) throw invalidCredentials();
      const sessionResponse = await this.request("/api/auth/session", { headers: { Cookie: cookieHeader() } });
      if (!sessionResponse.ok) throw invalidCredentials();
      const session = doc(await this.json(sessionResponse));
      const userId = isDoc(session.user) ? id(session.user.id) : null;
      if (!userId || typeof session.expires !== "string" || !(Date.parse(session.expires) > Date.now())) throw invalidCredentials();
      return { id: userId };
    } finally { cookies.clear(); }
  }

  private async token(force = false): Promise<string> {
    if (!force && this.cmsToken && this.cmsToken.expiresAt > Date.now() + 30_000) return this.cmsToken.value;
    if (this.loginPending) return this.loginPending;
    if (!this.options.cmsEmail || !this.options.cmsPassword) throw new AppError(503, "LEGACY_CONFIG_MISSING", "旧版服务凭证尚未配置");
    this.loginPending = (async () => {
      const response = await this.request("/api/cms-admins/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: this.options.cmsEmail, password: this.options.cmsPassword }) });
      if (!response.ok) throw new AppError(503, "LEGACY_CMS_UNAVAILABLE", "旧版服务凭证不可用，请联系运营方");
      const value = doc(await this.json(response));
      if (typeof value.token !== "string" || !value.token || value.token.length > 16_384 || typeof value.exp !== "number" || !Number.isFinite(value.exp) || value.exp * 1000 <= Date.now()) throw upstreamFailure();
      this.cmsToken = { value: value.token, expiresAt: value.exp * 1000 };
      return value.token;
    })();
    try { return await this.loginPending; } finally { this.loginPending = undefined; }
  }

  private async cms(path: string, init: RequestInit = {}, missing = false): Promise<unknown> {
    const send = async (force: boolean) => this.request(`/api/${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers, Authorization: `JWT ${await this.token(force)}` } });
    let response = await send(false);
    if (response.status === 401 || response.status === 403) response = await send(true);
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new AppError(response.status === 409 || response.status === 400 ? 409 : 502, "LEGACY_REQUEST_FAILED", "旧版数据操作未完成，请稍后重试");
    return this.json(response);
  }

  private async find(collection: Collection, where: Where, limit: number, sort?: string): Promise<Doc[]> {
    const query = new URLSearchParams({ depth: "0", limit: String(limit), pagination: "false" });
    putQuery(query, "where", where);
    if (sort) query.set("sort", sort);
    const result = doc(await this.cms(`${collection}?${query}`));
    if (!Array.isArray(result.docs) || result.docs.some((row) => !isDoc(row))) throw upstreamFailure();
    return result.docs as Doc[];
  }

  private async get(collection: Collection, documentId: string): Promise<Doc | null> {
    const value = await this.cms(`${collection}/${encodeURIComponent(documentId)}?depth=0`, {}, true);
    if (value === null) return null;
    const row = doc(value);
    if (id(row.id) !== documentId) throw scopeFailure();
    return row;
  }

  async userExists(userId: string): Promise<boolean> { return !!await this.get("app-users", userId); }
  async getBaby(babyId: string): Promise<Baby | null> { const value = await this.get("babies", babyId); return value ? baby(value) : null; }

  async listBabies(userId: string): Promise<Baby[]> {
    const bindings = await this.find("baby-users", { user: { equals: userId } }, 200, "-isDefault,createdAt");
    if (bindings.some((row) => id(row.user) !== userId || !id(row.baby))) throw scopeFailure();
    const result: Baby[] = [];
    for (const binding of bindings) {
      const babyId = id(binding.baby)!;
      if (result.some((item) => item.id === babyId)) continue;
      const value = await this.getBaby(babyId);
      if (value) result.push({ ...value, isDefault: binding.isDefault === true });
    }
    return result;
  }

  async createFamily(identityId: string, input: { name: string }): Promise<{ userId: string; baby: Baby }> {
    const name = input.name.trim();
    if (!identityId || identityId.length > 256 || !name || name.length > 30) throw new AppError(400, "INVALID_FAMILY", "请输入 1 到 30 字的宝宝昵称");
    const userId = deterministicId("user", identityId);
    const babyId = deterministicId("baby", identityId);
    const bindingId = deterministicId("binding", identityId);
    const username = `bubu_${createHash("sha256").update(identityId).digest("hex").slice(0, 24)}`;
    // Stable IDs permit safe retry after a network failure between legacy writes.
    // Never overwrite existing users, passwords, names, or memberships on retry.
    const ensure = async (collection: Collection, documentId: string, data: Doc): Promise<Doc> => {
      const existing = await this.get(collection, documentId);
      if (existing) return existing;
      try { await this.cms(collection, { method: "POST", body: JSON.stringify({ id: documentId, ...data }) }); }
      catch (error) {
        const recovered = await this.get(collection, documentId);
        if (recovered) return recovered;
        throw error;
      }
      const created = await this.get(collection, documentId);
      if (!created) throw upstreamFailure();
      return created;
    };
    const user = await ensure("app-users", userId, { username, name: "微信照护者", password: `${randomBytes(32).toString("base64url")}Aa1!`, role: "OTHER" });
    if (user.username !== username) throw scopeFailure();
    const createdBaby = baby(await ensure("babies", babyId, { name, gender: "OTHER" }));
    const binding = await ensure("baby-users", bindingId, { baby: babyId, user: userId, isDefault: true });
    if (id(binding.user) !== userId || id(binding.baby) !== babyId) throw scopeFailure();
    return { userId, baby: { ...createdBaby, isDefault: binding.isDefault === true } };
  }

  async updateBabyNames(babyId: string, input: { name: string; fullName: string | null }): Promise<Baby> {
    const name = input.name.trim();
    const fullName = input.fullName?.trim() || null;
    if (!name || name.length > 30 || (fullName && fullName.length > 60)) throw new AppError(400, "INVALID_BABY_NAME", "宝宝昵称或姓名长度无效");
    const response = doc(await this.cms(`babies/${encodeURIComponent(babyId)}?depth=0`, { method: "PATCH", body: JSON.stringify({ name, fullName }) }));
    // Payload REST mutations wrap the document, unlike its GET-by-ID endpoint.
    const value = baby(response.doc);
    if (value.id !== babyId) throw scopeFailure();
    return value;
  }

  async read(babyId: string, path: string, query: URLSearchParams): Promise<unknown> {
    if (!id(babyId)) throw new AppError(400, "INVALID_BABY", "缺少宝宝范围");
    const match = /^(activities|daily-stats)(?:\/([^/]+))?$/.exec(path);
    if (!match) throw new AppError(404, "NOT_FOUND", "没有此读取接口");
    const collection = match[1] as "activities" | "daily-stats";
    const detail = match[2];
    const conditions: Where[] = [{ babyId: { equals: babyId } }];
    let limit = collection === "activities" ? Number.parseInt(query.get("limit") || "50", 10) : 500;
    let sort = collection === "activities" ? "-startTime" : "date";
    let single = false;
    let nullable = false;
    if (collection === "activities") {
      if (detail === "latest") {
        const types = query.get("types")?.split(",").map((item) => item.trim());
        if (!types?.length) throw new AppError(400, "TYPES_REQUIRED", "请指定活动类型");
        conditions.push({ type: { in: types } });
        limit = 1; single = true; nullable = true;
      } else if (detail) {
        conditions.push({ id: { equals: detail } });
        limit = 1; single = true; sort = "";
      } else {
        if (!Number.isFinite(limit) || limit < 1 || limit > 1000) throw new AppError(400, "INVALID_LIMIT", "记录数量应为 1 到 1000");
        const type = query.get("type");
        const types = query.get("types")?.split(",").map((item) => item.trim()).filter(Boolean);
        if (type) conditions.push({ type: { equals: type } });
        else if (types?.length) conditions.push({ type: { in: types } });
        const from = query.get("startTimeGte");
        const until = query.get("startTimeLt");
        if (from || until) {
          const start = isoDate(from); const end = isoDate(until);
          const range: Record<string, string> = {};
          if (start) range.greater_than_equal = start;
          if (end) range.less_than = end;
          const alternatives: Where[] = Object.keys(range).length ? [{ startTime: range }] : [];
          const crossing = (boundary: string): Where => ({ and: [{ startTime: { less_than: boundary } }, { or: [{ endTime: { greater_than_equal: boundary } }, { endTime: { exists: false } }] }] });
          if (query.get("crossStartTime") === "true" && start) alternatives.push(crossing(start));
          if (query.get("crossEndTime") === "true" && end) alternatives.push(crossing(end));
          if (alternatives.length === 1) conditions.push(alternatives[0]!);
          else if (alternatives.length > 1) conditions.push({ or: alternatives });
        } else if (query.get("date")) {
          const day = chinaDay(query.get("date")!);
          conditions.push({ and: [{ startTime: { less_than_equal: day.end } }, { or: [{ endTime: { greater_than_equal: day.start } }, { endTime: { exists: false } }] }] });
        }
      }
    } else if (detail) {
      const day = chinaDay(detail);
      conditions.push({ date: { greater_than_equal: day.start } }, { date: { less_than_equal: day.end } });
      single = true; limit = 1; sort = "";
    } else {
      const start = query.get("startDate"); const end = query.get("endDate");
      if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) conditions.push({ date: { greater_than_equal: chinaDay(start).start } });
      if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) conditions.push({ date: { less_than_equal: chinaDay(end).end } });
    }
    const rows = await this.find(collection, { and: conditions }, limit, sort || undefined);
    if (rows.some((row) => row.babyId !== babyId)) throw scopeFailure();
    if (single) {
      if (!rows[0] && !nullable) throw new AppError(404, "NOT_FOUND", "未找到此记录");
      if (collection === "activities" && detail !== "latest" && rows[0] && rows[0].id !== detail) throw scopeFailure();
      return rows[0] ?? null;
    }
    return rows;
  }
}

export function legacyBackendFromEnv(): HttpLegacyBackend {
  return new HttpLegacyBackend({ origin: process.env.BUBU_LEGACY_ORIGIN || "http://127.0.0.1:1030", cmsEmail: process.env.BUBU_LEGACY_CMS_EMAIL || "", cmsPassword: process.env.BUBU_LEGACY_CMS_PASSWORD || "" });
}
