import type { Activity, ActivityType, AuthContext } from "../model/types";
import * as decode from "./contracts";
import { SessionCookies, type SessionStorage } from "./session";

export interface TransportRequest {
  url: string;
  method: "GET" | "POST" | "PATCH";
  headers: Record<string, string>;
  body?: string;
  credentials?: "include";
}
export interface TransportResponse {
  status: number;
  data: unknown;
  headers?: Record<string, unknown>;
  cookies?: string[];
}
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}
export class ConfigurationError extends ApiError {
  constructor() { super(0, "尚未配置哺哺日记服务地址，请联系管理员。", "NOT_CONFIGURED"); }
}
export const ACTIVITY_LIMIT = 1000;
export interface ActivityQuery {
  babyId: string;
  date?: string;
  startTimeGte?: string;
  startTimeLt?: string;
  crossStartTime?: boolean;
  crossEndTime?: boolean;
  types?: ActivityType[];
}
export interface ActivityResult { activities: Activity[]; complete: boolean; limit: number }
export interface ClientOptions {
  native: boolean;
  origin: string;
  transport: Transport;
  storage: SessionStorage;
  now?: () => number;
}

function normalizeOrigin(value: string): string {
  const clean = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[a-zA-Z0-9.\-[\]:]+$/.test(clean)) return "";
  // Passwords and session cookies must use TLS, except for a local development server.
  if (clean.startsWith("http://") && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(clean)) return "";
  return clean;
}
function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  return entries.length ? `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}` : "";
}
function requiredId(value: string): string {
  if (!value.trim()) throw new ApiError(400, "请选择宝宝或记录。");
  return value;
}
function day(value: string): number {
  const date = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value)
    throw new ApiError(400, "日期格式不正确。");
  return date;
}
function verifyScope<T extends { babyId?: string }>(row: T, babyId: string): T {
  if (row.babyId !== undefined && row.babyId !== babyId) throw new decode.ResponseFormatError();
  return row;
}
const guest = (): AuthContext => ({ authenticated: false, hasBaby: false, baby: null, babies: [] });

export function createBubuApi(options: ClientOptions) {
  // H5 deliberately ignores an API origin: browser-managed HttpOnly cookies stay same-origin.
  const origin = options.native ? normalizeOrigin(options.origin) : "";
  const jar = options.native && origin ? new SessionCookies(origin, options.storage, options.now) : undefined;
  let revision = 0;
  let expiredRevision: number | undefined;
  let changingSession = false;

  async function request(path: string, args: { method?: "GET" | "POST" | "PATCH"; form?: Record<string, string>; json?: Record<string, string | null>; babyId?: string; guestAllowed?: boolean; missingAllowed?: boolean } = {}): Promise<unknown> {
    if (options.native && !origin) throw new ConfigurationError();
    const generation = revision;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (args.babyId) headers["x-baby-id"] = requiredId(args.babyId);
    const cookie = jar?.header(path.split("?")[0]);
    if (cookie) headers.Cookie = cookie;
    if (args.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["X-Auth-Return-Redirect"] = "1";
    }
    if (args.json) headers["Content-Type"] = "application/json";
    let response: TransportResponse;
    try {
      response = await options.transport({
        url: `${origin}${path}`, method: args.method ?? "GET", headers,
        ...(args.form ? { body: queryString(args.form).slice(1) } : {}),
        ...(args.json ? { body: JSON.stringify(args.json) } : {}),
        ...(!options.native ? { credentials: "include" as const } : {}),
      });
    } catch {
      throw new ApiError(0, "暂时无法连接哺哺日记，请检查网络后重试。");
    }
    if (generation !== revision) throw new ApiError(409, "登录状态已变化，请重新加载。", "SESSION_CHANGED");
    // Concurrent reads belong to the same identity even after one discovers expiry.
    // Keep them unauthorized, including late successes, before accepting any cookies.
    if (response.status === 401 || expiredRevision === generation) {
      expiredRevision = generation;
      jar?.clear();
      if (args.guestAllowed) return guest();
      throw new ApiError(401, "登录已失效，请重新登录原有宝宝日记账号。", "UNAUTHORIZED");
    }
    if (jar) {
      const cookies = [...(response.cookies ?? [])];
      for (const [key, value] of Object.entries(response.headers ?? {})) {
        if (key.toLowerCase() !== "set-cookie") continue;
        if (typeof value === "string") cookies.push(value);
        else if (Array.isArray(value)) cookies.push(...value.filter((item): item is string => typeof item === "string"));
      }
      if (cookies.length) jar.receive(cookies);
    }
    const data = response.data;
    const error = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    if (response.status === 404 && args.missingAllowed && !error.code) return null;
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(response.status,
        typeof error.error === "string" ? error.error.slice(0, 300) : "请求未完成，请稍后重试。",
        typeof error.code === "string" ? error.code : undefined);
    }
    return data;
  }
  function scoped(path: string, babyId: string, query: Record<string, string | number | boolean | undefined> = {}) {
    return `/api/app/${path}${queryString({ ...query, babyId: requiredId(babyId) })}`;
  }
  async function getContext(babyId?: string): Promise<AuthContext> {
    const result = await request(`/api/app/auth/context${queryString({ babyId })}`, { babyId, guestAllowed: true });
    return decode.authContext(result);
  }
  async function csrfToken(): Promise<string> {
    const result = decode.object(await request("/api/auth/csrf"));
    if (typeof result.csrfToken !== "string" || !result.csrfToken) throw new decode.ResponseFormatError();
    return result.csrfToken;
  }
  return {
    getContext,
    async login(input: { username: string; password: string }): Promise<AuthContext> {
      if (changingSession) throw new ApiError(409, "正在处理登录状态，请稍候。");
      if (!input.username.trim() || !input.password) throw new ApiError(400, "请输入原有账号和密码。");
      changingSession = true;
      revision++;
      expiredRevision = undefined;
      jar?.clear();
      try {
        const token = await csrfToken();
        const result = decode.object(await request("/api/auth/callback/credentials", {
          method: "POST", form: { username: input.username.trim(), password: input.password, csrfToken: token, callbackUrl: `${origin}/` },
        }));
        if (typeof result.url !== "string") throw new decode.ResponseFormatError();
        if (/[?&]error=/.test(result.url)) throw new ApiError(401, "用户名或密码错误，请核对原有宝宝日记账号。", "LOGIN_FAILED");
        const context = await getContext();
        if (!context.authenticated) throw new ApiError(401, "登录未完成，请重试。", "LOGIN_FAILED");
        return context;
      } catch (error) {
        jar?.clear();
        throw error;
      } finally { changingSession = false; }
    },
    async logout(): Promise<void> {
      if (changingSession) throw new ApiError(409, "正在处理登录状态，请稍候。");
      changingSession = true;
      revision++;
      expiredRevision = undefined;
      try {
        const token = await csrfToken();
        const result = decode.object(await request("/api/auth/signout", { method: "POST", form: { csrfToken: token, callbackUrl: `${origin}/` } }));
        if (typeof result.url !== "string" || /[?&]error=/.test(result.url)) throw new ApiError(502, "退出登录未完成，请重试。");
      } finally {
        revision++;
        jar?.clear();
        changingSession = false;
      }
    },
    async getBabies(babyId?: string) {
      return decode.babyList(await request(`/api/app/user-babies${queryString({ babyId })}`, { babyId }));
    },
    async updateBabyNames(babyId: string, input: { name: string; fullName: string }) {
      const name = input.name.trim();
      const fullName = input.fullName.trim();
      if (!name || name.length > 30) throw new ApiError(400, "宝宝昵称不能为空，且不能超过 30 个字。");
      if (fullName.length > 60) throw new ApiError(400, "宝宝姓名不能超过 60 个字。");
      const result = decode.object(await request(scoped(`user-babies/${encodeURIComponent(requiredId(babyId))}`, babyId), {
        method: "PATCH", babyId, json: { name, fullName: fullName || null },
      }));
      const updated = decode.baby(result.data);
      if (updated.id !== babyId) throw new decode.ResponseFormatError();
      return updated;
    },
    async getActivities(input: ActivityQuery): Promise<ActivityResult> {
      if (input.date) day(input.date);
      if (input.startTimeGte || input.startTimeLt) {
        if (!input.startTimeGte || !input.startTimeLt || !Number.isFinite(Date.parse(input.startTimeGte)) || !Number.isFinite(Date.parse(input.startTimeLt)) || Date.parse(input.startTimeGte) >= Date.parse(input.startTimeLt)) throw new ApiError(400, "请选择有效的活动时间范围。");
      } else if (!input.date) throw new ApiError(400, "请选择要查看的日期范围。");
      const { babyId } = input;
      const result = await request(scoped("activities", babyId, {
        date: input.date, startTimeGte: input.startTimeGte, startTimeLt: input.startTimeLt,
        crossStartTime: input.crossStartTime ?? true, crossEndTime: input.crossEndTime,
        types: input.types?.join(","), limit: ACTIVITY_LIMIT,
      }), { babyId });
      const activities = decode.array(result, (item) => verifyScope(decode.activity(item), babyId));
      return { activities, complete: activities.length < ACTIVITY_LIMIT, limit: ACTIVITY_LIMIT };
    },
    async getActivity(babyId: string, activityId: string) {
      return verifyScope(decode.activity(await request(scoped(`activities/${encodeURIComponent(requiredId(activityId))}`, babyId), { babyId })), babyId);
    },
    async getLatestActivity(babyId: string, types: ActivityType[]) {
      if (!types.length) throw new ApiError(400, "请选择活动类型。");
      const result = await request(scoped("activities/latest", babyId, { types: types.join(",") }), { babyId });
      return result === null ? null : verifyScope(decode.activity(result), babyId);
    },
    async getDailyStats(input: { babyId: string; startDate: string; endDate: string }) {
      const range = day(input.endDate) - day(input.startDate);
      if (range < 0 || range > 365 * 86_400_000) throw new ApiError(400, "汇总查询一次最多查看一年，请缩小日期范围。");
      const result = await request(scoped("daily-stats", input.babyId, { startDate: input.startDate, endDate: input.endDate }), { babyId: input.babyId });
      // These are stored snapshots. Missing dates remain missing, never synthesized as zeros.
      return decode.array(result, (item) => verifyScope(decode.dailyStat(item), input.babyId));
    },
    async getDailyStat(babyId: string, date: string) {
      day(date);
      const result = await request(scoped(`daily-stats/${date}`, babyId), { babyId, missingAllowed: true });
      return result === null ? null : verifyScope(decode.dailyStat(result), babyId);
    },
  };
}
export type BubuApi = ReturnType<typeof createBubuApi>;
