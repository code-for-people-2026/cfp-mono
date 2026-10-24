import type { FamilyLifecycle } from "./privacy/deletion";
import { createHash, randomBytes } from "node:crypto";
import { AppError, type Baby, type LegacyBackend, type LegacyUser } from "./contracts";
import { activityTypes, type DailyMetrics, type LegacyActivity, type LegacyRecordsBackend } from "./records/types";
import { chinaDayRange, emptyDailyMetrics } from "./records/statistics";

export interface LegacyMediaReference { kind: "activity" | "baby-avatar" | "profile-avatar" | "audit-photo"; documentId: string; babyId: string; url: string }
type Doc = Record<string, unknown>;
type Where = Record<string, unknown>;
type Collection = "app-users" | "baby-users" | "babies" | "activities" | "daily-stats";
interface LegacyHttpOptions {
  origin: string;
  cmsEmail: string;
  cmsPassword: string;
  coreToken?: string;
  fetch?: typeof fetch;
}
const upstreamFailure = () => new AppError(502, "LEGACY_UNAVAILABLE", "旧版服务暂时不可用，请稍后重试");
const invalidCredentials = () => new AppError(401, "LEGACY_CREDENTIALS_INVALID", "旧账号或密码不正确");
const scopeFailure = () => new AppError(502, "LEGACY_SCOPE_INVALID", "旧版服务返回了不匹配的宝宝范围");
const isDoc = (value: unknown): value is Doc => !!value && typeof value === "object" && !Array.isArray(value);
const activityFields = ["type", "startTime", "endTime", "hasPoop", "hasPee", "poopColor", "poopPhotoUrl", "peeAmount", "burpSuccess", "milkAmount", "milkSource", "breastFirmness", "supplementType", "spitUpType", "count", "notes"] as const;
const legacyConflict = () => new AppError(409, "LEGACY_VERSION_CONFLICT", "旧版记录已发生变化，请重新核对后修改");
function activityDocument(value: unknown, babyId: string, documentId?: string): LegacyActivity {
  const row = doc(value);
  if (row.babyId !== babyId || !id(row.id) || (documentId && row.id !== documentId)) throw scopeFailure();
  if (!activityTypes.includes(row.type as LegacyActivity["type"]) || typeof row.startTime !== "string" || !Number.isFinite(Date.parse(row.startTime))) throw upstreamFailure();
  return row as unknown as LegacyActivity;
}
function activityData(value: LegacyActivity): Doc {
  return Object.fromEntries(activityFields.map(field => [field, value[field] ?? null]));
}
function sameActivity(left: LegacyActivity | null, right: LegacyActivity | null): boolean {
  if (!left || !right) return left === right;
  if (left.id !== right.id || left.babyId !== right.babyId) return false;
  const normalized = (row: LegacyActivity, field: typeof activityFields[number]) => {
    const value = row[field] ?? null;
    return (field === "startTime" || field === "endTime") && typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value;
  };
  return activityFields.every(field => normalized(left, field) === normalized(right, field));
}
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
export class HttpLegacyBackend implements LegacyBackend, LegacyRecordsBackend, FamilyLifecycle {
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
    if (options.coreToken && (!loopback || !/^[a-f0-9]{64}$/.test(options.coreToken))) throw new AppError(503, "CORE_CONFIG_INVALID", "私有数据层必须使用本机地址和独立凭证");
    this.origin = url.origin;
    this.fetcher = options.fetch ?? fetch;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      const response = await this.fetcher(`${this.origin}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...(this.options.coreToken ? { "x-bubu-core-token": this.options.coreToken } : {}) }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
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

  private async core(path: string, method: "GET" | "DELETE" | "POST", body?: unknown) {
    if (!this.options.coreToken) throw new AppError(503, "LEGACY_LIFECYCLE_UNAVAILABLE", "原照护数据尚未迁入私有存储，请联系隐私渠道处理。");
    const send = async (refresh: boolean) => this.request(path, { method, headers: { Authorization: `JWT ${await this.token(refresh)}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let response = await send(false); if (response.status === 401) response = await send(true);
    if (!response.ok) throw new AppError(response.status === 413 ? 413 : 503, "LEGACY_LIFECYCLE_UNAVAILABLE", "原照护数据操作尚未完成，请联系隐私渠道处理。");
    return doc(await this.json(response));
  }
  private async lifecycle(babyId: string, method: "GET" | "DELETE") {
    if (!id(babyId)) throw new AppError(400, "INVALID_BABY", "缺少宝宝范围");
    const result = await this.core(`/internal/family?${new URLSearchParams({ babyId })}`, method);
    if (result.babyId !== babyId || method === "DELETE" && result.deleted !== true) throw scopeFailure();
    return result;
  }
  async listLegacyMedia(): Promise<{ references: LegacyMediaReference[]; unresolvedProfiles: number }> {
    const result = await this.core("/internal/media", "GET");
    if (!Array.isArray(result.references) || !Number.isInteger(result.unresolvedProfiles) || Number(result.unresolvedProfiles) < 0) throw upstreamFailure();
    const references = result.references.map(item => {
      const row = doc(item);
      if (!["activity", "baby-avatar", "profile-avatar", "audit-photo"].includes(String(row.kind)) || !id(row.babyId) || !id(row.documentId) || typeof row.url !== "string" || !row.url || row.url.length > 4096) throw upstreamFailure();
      return row as unknown as LegacyMediaReference;
    });
    return { references, unresolvedProfiles: Number(result.unresolvedProfiles) };
  }
  async replaceLegacyMedia(reference: LegacyMediaReference, uri: string) {
    if (!/^bubu-attachment:att_[a-f0-9]{64}$/.test(uri)) throw new Error("Invalid private media reference");
    const result = await this.core("/internal/media", "POST", { ...reference, uri });
    if (result.babyId !== reference.babyId || result.documentId !== reference.documentId || result.uri !== uri) throw scopeFailure();
  }
  async exportFamilyData(babyId: string): Promise<unknown> {
    const result = await this.lifecycle(babyId, "GET");
    if (!isDoc(result.data) || result.data.babyId !== babyId || result.data.format !== "bubu-original-payload-v1") throw scopeFailure();
    return result.data;
  }
  async deleteFamilyData(babyId: string): Promise<void> { await this.lifecycle(babyId, "DELETE"); }

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

  /** Paginate explicitly: Payload may cap limit, and conflict checks must not silently inspect only 1000 rows. */
  async listActivities(babyId: string): Promise<LegacyActivity[]> {
    if (!id(babyId)) throw new AppError(400, "INVALID_BABY", "缺少宝宝范围");
    const result: LegacyActivity[] = []; const seen = new Set<string>();
    let page = 1;
    for (;;) {
      const query = new URLSearchParams({ depth: "0", limit: "500", page: String(page), pagination: "true", sort: "id" });
      putQuery(query, "where", { babyId: { equals: babyId } });
      const response = doc(await this.cms(`activities?${query}`));
      if (!Array.isArray(response.docs)) throw upstreamFailure();
      for (const value of response.docs) {
        const row = activityDocument(value, babyId);
        if (seen.has(row.id)) throw new AppError(502, "LEGACY_PAGINATION_CHANGED", "旧版记录分页发生变化，请重试读取");
        seen.add(row.id); result.push(row);
      }
      if (response.hasNextPage === false || (response.hasNextPage === undefined && response.nextPage == null)) return result;
      if (response.hasNextPage !== true || response.nextPage !== page + 1 || !response.docs.length || page >= 10_000) throw upstreamFailure();
      page++;
    }
  }

  async getActivity(babyId: string, documentId: string): Promise<LegacyActivity | null> {
    if (!id(babyId) || !id(documentId)) throw new AppError(400, "INVALID_ACTIVITY", "缺少宝宝或记录范围");
    const row = await this.get("activities", documentId);
    return row ? activityDocument(row, babyId, documentId) : null;
  }

  async writeActivity(babyId: string, documentId: string, desired: LegacyActivity | null, expected: LegacyActivity | null): Promise<LegacyActivity | null> {
    if (!id(babyId) || !id(documentId)) throw new AppError(400, "INVALID_ACTIVITY", "缺少宝宝或记录范围");
    if (desired) activityDocument(desired, babyId, documentId);
    if (expected) activityDocument(expected, babyId, documentId);
    const current = await this.getActivity(babyId, documentId);
    // A stable ID and the complete target snapshot recover a successful write whose response was lost.
    if (sameActivity(current, desired)) return current;
    if (!sameActivity(current, expected) || (current && expected?.updatedAt && current.updatedAt !== expected.updatedAt)) throw legacyConflict();
    let operationError: unknown;
    try {
      if (!expected && desired) {
        const response = doc(await this.cms("activities", { method: "POST", body: JSON.stringify({ id: documentId, babyId, ...activityData(desired) }) }));
        activityDocument(response.doc, babyId, documentId);
      } else if (expected) {
        // Payload applies this snapshot condition when selecting records, then updates by ID internally.
        // This selection precondition plus before/after verification detects observed external edits;
        // it is not a database-atomic CAS against a simultaneous write inside Payload's own operation.
        const conditions: Where[] = [{ id: { equals: documentId } }, { babyId: { equals: babyId } }];
        if (expected.updatedAt) conditions.push({ updatedAt: { equals: expected.updatedAt } });
        for (const field of activityFields) conditions.push({ [field]: expected[field] == null ? { exists: false } : { equals: expected[field] } });
        const query = new URLSearchParams({ depth: "0" }); putQuery(query, "where", { and: conditions });
        const response = doc(await this.cms(`activities?${query}`, { method: desired ? "PATCH" : "DELETE", ...(desired ? { body: JSON.stringify(activityData(desired)) } : {}) }));
        if (!Array.isArray(response.docs) || response.docs.length > 1 || (Array.isArray(response.errors) && response.errors.length)) throw upstreamFailure();
        for (const value of response.docs) activityDocument(value, babyId, documentId);
        if (!response.docs.length) throw legacyConflict();
      }
    } catch (error) { operationError = error; }
    const actual = await this.getActivity(babyId, documentId);
    if (sameActivity(actual, desired)) return actual;
    if (operationError) throw operationError;
    throw legacyConflict();
  }

  async saveDailyStats(babyId: string, date: string, metrics: DailyMetrics): Promise<void> {
    if (!id(babyId)) throw new AppError(400, "INVALID_BABY", "缺少宝宝范围");
    const metricNames = Object.keys(emptyDailyMetrics());
    if (Object.keys(metrics).some(key => !metricNames.includes(key)) || metricNames.some(key => typeof metrics[key] !== "number" || !Number.isFinite(metrics[key]) || metrics[key]! < 0)) throw new AppError(400, "INVALID_METRICS", "日报指标无效");
    const dateValue = new Date(chinaDayRange(date).start).toISOString();
    const rows = await this.find("daily-stats", { and: [{ babyId: { equals: babyId } }, { date: { equals: dateValue } }] }, 2);
    if (rows.length > 1 || rows.some(row => row.babyId !== babyId || isoDate(String(row.date)) !== dateValue)) throw scopeFailure();
    const existing = rows[0];
    const documentId = existing ? id(existing.id) : deterministicId("daily-stat", `${babyId}:${date}`);
    if (!documentId) throw upstreamFailure();
    const matches = (row: Doc | null) => !!row && row.babyId === babyId && isoDate(String(row.date)) === dateValue && metricNames.every(key => row[key] === metrics[key]);
    if (matches(existing || null)) return;
    try {
      const response = doc(await this.cms(existing ? `daily-stats/${encodeURIComponent(documentId)}?depth=0` : "daily-stats", {
        method: existing ? "PATCH" : "POST", body: JSON.stringify(existing ? metrics : { id: documentId, babyId, date: dateValue, ...metrics }),
      }));
      const saved = doc(response.doc);
      if (saved.id !== documentId || !matches(saved)) throw scopeFailure();
    } catch (error) {
      const recovered = await this.get("daily-stats", documentId);
      if (!matches(recovered)) throw error;
    }
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
  return new HttpLegacyBackend({ origin: process.env.BUBU_LEGACY_ORIGIN || "http://127.0.0.1:1030", cmsEmail: process.env.BUBU_LEGACY_CMS_EMAIL || "", cmsPassword: process.env.BUBU_LEGACY_CMS_PASSWORD || "", coreToken: process.env.BUBU_CORE_SERVICE_TOKEN });
}
