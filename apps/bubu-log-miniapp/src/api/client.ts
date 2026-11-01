import { decodeSafetyNotices, decodePolicy, decodePrivacyStatus, type PersonalChoice, type GuardianChoice, type PrivacyRequest, type DeletionIntent, type DeletionJob } from "../privacy/contracts";
import { decodeAttachment, decodeHistory, decodePending, decodeTurn } from "../chat/contracts";
import type { ChatRequest } from "../chat/drafts";
import type { Activity, ActivityType, AuthContext } from "../model/types";
import * as decode from "./contracts";
import { SessionCookies, type SessionStorage } from "./session";
import { IdentitySession } from "./identity-session";
import { decodeMembership } from "../membership/contracts";

export interface TransportRequest {
  url: string;
  method: "GET" | "POST" | "PATCH";
  headers: Record<string, string>;
  body?: string;
  binary?: ArrayBuffer;
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
  constructor() { super(0, "尚未配置卜卜日记服务地址，请联系管理员。", "NOT_CONFIGURED"); }
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
  authMode?: "legacy" | "sidecar";
  wechatLogin?: () => Promise<string>;
  onSessionExpired?: () => void;
  onAccessRevoked?: (babyId?: string) => void;
  download?: (request: { url: string; headers: Record<string, string> }) => Promise<{ status: number; path: string }>;
  removeDownloadedFile?: (path: string) => void;
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
  const sidecar = options.authMode === "sidecar";
  const jar = !sidecar && options.native && origin ? new SessionCookies(origin, options.storage, options.now) : undefined;
  const identity = sidecar && options.native && origin ? new IdentitySession(origin, options.storage, options.now) : undefined;
  let revision = 0;
  let expiredRevision: number | undefined;
  let authenticatedContextSeen = false;
  let changingSession = false;
  let loggingOut = false;
  let pendingLogoutAuthorization: string | undefined;
  let activeChange: Promise<void> | undefined;
  let mediaRevision = 0;
  const babyRevisions = new Map<string, number>();
  const downloadedFiles = new Set<string>();
  function releasePhotoUrl(path: string): void {
    if (downloadedFiles.delete(path)) options.removeDownloadedFile?.(path);
  }
  function clearPhotos(): void {
    mediaRevision++;
    for (const path of downloadedFiles) releasePhotoUrl(path);
  }
  function beginChange(): () => void {
    if (changingSession || loggingOut) throw new ApiError(409, "正在处理登录状态，请稍候。");
    changingSession = true;
    clearPhotos();
    let resolveChange: () => void = () => {};
    const current = new Promise<void>((resolve) => { resolveChange = resolve; });
    activeChange = current;
    return () => { changingSession = false; if (activeChange === current) activeChange = undefined; resolveChange(); };
  }

  async function request(path: string, args: { method?: "GET" | "POST" | "PATCH"; form?: Record<string, string>; json?: object; binary?: ArrayBuffer; mime?: string; requestId?: string; babyId?: string; guestAllowed?: boolean; publicPolicy?: boolean; missingAllowed?: boolean; credentialExchange?: boolean; logout?: boolean } = {}): Promise<unknown> {
    if (options.native && !origin) throw new ConfigurationError();
    const generation = revision;
    const babyGeneration = args.babyId ? babyRevisions.get(args.babyId) ?? 0 : 0;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (sidecar) headers["X-Bubu-Client"] = options.native ? "native" : "browser";
    const authorization = args.logout ? pendingLogoutAuthorization ?? identity?.header() : identity?.header();
    if (authorization && !args.publicPolicy) headers.Authorization = authorization;
    if (args.babyId) headers["x-baby-id"] = requiredId(args.babyId);
    const cookie = jar?.header(path.split("?")[0]);
    if (cookie && !args.publicPolicy) headers.Cookie = cookie;
    if (args.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["X-Auth-Return-Redirect"] = "1";
    }
    if (args.json) headers["Content-Type"] = "application/json";
    if (args.binary) { headers["Content-Type"] = args.mime!; headers["X-Bubu-Request-Id"] = args.requestId!; }
    let response: TransportResponse;
    try {
      response = await options.transport({
        url: `${origin}${path}`, method: args.method ?? "GET", headers,
        ...(args.form ? { body: queryString(args.form).slice(1) } : {}),
        ...(args.json ? { body: JSON.stringify(args.json) } : {}),
        ...(args.binary ? { binary: args.binary } : {}),
        ...(!options.native ? { credentials: "include" as const } : {}),
      });
    } catch {
      throw new ApiError(0, "暂时无法连接卜卜日记，请检查网络后重试。");
    }
    if (!args.publicPolicy && generation !== revision) {
      // A native bind can rotate the token while logout waits. Revoke that new token
      // directly; it must never reach persistent storage or a restored UI context.
      if (loggingOut && sidecar && options.native && args.credentialExchange && response.status >= 200 && response.status < 300) {
        const stale = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : {};
        if (typeof stale.token === "string" && /^[A-Za-z0-9._~-]+$/.test(stale.token)
          && typeof stale.expiresAt === "string" && Date.parse(stale.expiresAt) > (options.now ?? Date.now)()) pendingLogoutAuthorization = `Bearer ${stale.token}`;
      }
      throw new ApiError(409, "登录状态已变化，请重新加载。", "SESSION_CHANGED");
    }
    if (args.babyId && babyGeneration !== (babyRevisions.get(args.babyId) ?? 0)) throw new ApiError(403, "宝宝访问权限已变化，请重新加载。", "BABY_FORBIDDEN");
    const data = response.data;
    const error = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    // Concurrent reads belong to the same identity even after one discovers expiry.
    // Keep them unauthorized, including late successes, before accepting any cookies.
    // The public policy must remain readable before login, after expiry and during
    // identity changes. Its response never restores or invalidates a session.
    if (!args.publicPolicy && ((response.status === 401 && (!args.credentialExchange || error.code === "UNAUTHORIZED")) || expiredRevision === generation)) {
      const firstExpiry = expiredRevision !== generation;
      expiredRevision = generation;
      jar?.clear();
      identity?.clear();
      clearPhotos();
      options.onAccessRevoked?.();
      if (firstExpiry && (authenticatedContextSeen || !args.guestAllowed)) options.onSessionExpired?.();
      authenticatedContextSeen = false;
      if (args.guestAllowed) return guest();
      throw new ApiError(401, sidecar ? "登录已失效，请重新登录。" : "登录已失效，请重新登录原有宝宝日记账号。", "UNAUTHORIZED");
    }
    if (jar && !args.publicPolicy) {
      const cookies = [...(response.cookies ?? [])];
      for (const [key, value] of Object.entries(response.headers ?? {})) {
        if (key.toLowerCase() !== "set-cookie") continue;
        if (typeof value === "string") cookies.push(value);
        else if (Array.isArray(value)) cookies.push(...value.filter((item): item is string => typeof item === "string"));
      }
      if (cookies.length) jar.receive(cookies);
    }
    if (response.status === 404 && args.missingAllowed && (!error.code || (sidecar && error.code === "NOT_FOUND"))) return null;
    if (response.status === 403 && args.babyId) { babyRevisions.set(args.babyId, babyGeneration + 1); clearPhotos(); options.onAccessRevoked?.(args.babyId); }
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
    clearPhotos();
    const result = await request(`/api/app/auth/context${queryString({ babyId })}`, { babyId, guestAllowed: true });
    const context = decode.authContext(result);
    if (sidecar && context.authenticated && (!context.identityId || context.legacyLinked === undefined)) throw new decode.ResponseFormatError();
    if (context.authenticated && babyId && context.baby?.id !== babyId) throw new decode.ResponseFormatError();
    authenticatedContextSeen = context.authenticated;
    return context;
  }
  async function csrfToken(): Promise<string> {
    const result = decode.object(await request("/api/auth/csrf"));
    if (typeof result.csrfToken !== "string" || !result.csrfToken) throw new decode.ResponseFormatError();
    return result.csrfToken;
  }
  function requireSidecar(): void {
    if (!sidecar) throw new ApiError(400, "当前服务未启用微信身份登录。", "IDENTITY_NOT_ENABLED");
  }
  async function identityExchange(path: string, input: Record<string, string> | (() => Promise<Record<string, string>>), preserveSession = false): Promise<AuthContext> {
    requireSidecar();
    const finish = beginChange();
    const generation = ++revision;
    expiredRevision = undefined;
    if (!preserveSession) identity?.clear();
    try {
      const payload = typeof input === "function" ? await input() : input;
      if (generation !== revision) throw new ApiError(409, "登录状态已变化，请重新加载。", "SESSION_CHANGED");
      const result = decode.object(await request(path, { method: "POST", json: payload, credentialExchange: true }));
      const context = decode.authContext(result.context);
      if (!context.authenticated || !context.identityId || context.legacyLinked === undefined) throw new decode.ResponseFormatError();
      if (identity) {
        if (typeof result.token !== "string" || typeof result.expiresAt !== "string") throw new decode.ResponseFormatError();
        identity.save({ token: result.token, expiresAt: result.expiresAt });
      }
      authenticatedContextSeen = true;
      return context;
    } finally { finish(); }
  }
  function credentials(input: { username: string; password: string }): { username: string; password: string } {
    if (!input.username.trim() || !input.password) throw new ApiError(400, "请输入原有账号和密码。");
    return { username: input.username.trim(), password: input.password };
  }
  async function updateIdentityContext(path: string, input: object): Promise<AuthContext> {
    requireSidecar();
    const finish = beginChange();
    revision++;
    try {
      const result = decode.object(await request(path, { method: "POST", json: input }));
      const context = decode.authContext(result.context);
      if (!context.authenticated || !context.identityId || context.legacyLinked === undefined) throw new decode.ResponseFormatError();
      authenticatedContextSeen = true;
      return context;
    } finally { finish(); }
  }
  return {
    async safetyNotices(babyId: string) { return decodeSafetyNotices(await request(scoped("safety", babyId), { babyId }), babyId); },
    async acknowledgeSafety(babyId: string, signalId: string) { await request("/api/app/safety/acknowledge", { method: "POST", babyId, json: { babyId, signalId } }); },
    async privacyPolicy() { return decodePolicy(await request("/api/app/privacy/policy", { publicPolicy: true })); },
    async privacyStatus(babyId?: string) { return decodePrivacyStatus(await request("/api/app/privacy/status" + queryString({ babyId }))); },
    async privacyConsent(input: PersonalChoice) { await request("/api/app/privacy/consent", { method: "POST", json: input }); },
    async privacyGuardian(babyId: string, consent: GuardianChoice) { await request("/api/app/privacy/guardian", { method: "POST", json: { babyId, consent } }); },
    async privacyWithdraw(babyId?: string) { await request("/api/app/privacy/withdraw", { method: "POST", json: { babyId } }); clearPhotos(); options.onAccessRevoked?.(babyId); },
    async privacyRequests() { return (await request("/api/app/privacy/requests") as { data: PrivacyRequest[] }).data; },
    async privacyRequest(kind: "privacy" | "complaint" | "appeal", message: string, babyId?: string) { await request("/api/app/privacy/requests", { method: "POST", json: { kind, message, ...(babyId ? { babyId } : {}) } }); },
    async deletionIntent(kind: "account" | "family", babyId?: string) { return await request("/api/app/privacy/delete-intent", { method: "POST", json: { kind, ...(babyId ? { babyId } : {}) } }) as DeletionIntent; },
    async deletionConfirm(token: string, confirmation: string) { const result = await request("/api/app/privacy/delete-confirm", { method: "POST", json: { token, confirmation } }); clearPhotos(); options.onAccessRevoked?.(); return result; },
    async deletionJobs() { return (await request("/api/app/privacy/deletions") as { data: DeletionJob[] }).data; },
    async privacyExport(babyId?: string) { return request("/api/app/privacy/export" + queryString({ babyId })); },
    getContext,
    releasePhotoUrl,
    async resolvePhotoUrl(url: string, babyId: string): Promise<string> {
      if (!sidecar) return url;
      // Never forward a Bearer credential to a data-supplied host or arbitrary route.
      const match = /^\/api\/app\/(?:media\/activities\/[A-Za-z0-9%_.~-]+|attachments\/att_[a-f0-9]{64})\?babyId=([^&#]+)$/.exec(url);
      let requestedBaby: string;
      try { requestedBaby = match ? decodeURIComponent(match[1]) : ""; } catch { throw new decode.ResponseFormatError(); }
      if (!match || requestedBaby !== requiredId(babyId)) throw new decode.ResponseFormatError();
      if (!options.native) return url;
      if (!origin) throw new ConfigurationError();
      if (!options.download) throw new ApiError(0, "当前客户端无法加载照片。");
      const authorization = identity?.header();
      if (!authorization) throw new ApiError(401, "登录已失效，请重新登录。", "UNAUTHORIZED");
      const generation = revision;
      const mediaGeneration = mediaRevision;
      let result: { status: number; path: string };
      try { result = await options.download({ url: `${origin}${url}`, headers: { Authorization: authorization, "X-Bubu-Client": "native", "x-baby-id": babyId } }); }
      catch { throw new ApiError(0, "图片暂时无法加载，请重试。"); }
      if (result.path) downloadedFiles.add(result.path);
      if (generation !== revision || mediaGeneration !== mediaRevision) {
        releasePhotoUrl(result.path);
        throw new ApiError(409, "宝宝或登录状态已变化。", "SESSION_CHANGED");
      }
      if (result.status === 401 || expiredRevision === generation) {
        const firstExpiry = expiredRevision !== generation;
        expiredRevision = generation; identity?.clear(); clearPhotos();
        authenticatedContextSeen = false;
        options.onAccessRevoked?.();
        if (firstExpiry) options.onSessionExpired?.();
        throw new ApiError(401, "登录已失效，请重新登录。", "UNAUTHORIZED");
      }
      if (result.status < 200 || result.status >= 300 || !result.path) {
        releasePhotoUrl(result.path);
        if (result.status === 403) { clearPhotos(); options.onAccessRevoked?.(babyId); }
        throw new ApiError(result.status, result.status === 403 ? "已无权查看这张照片。" : "图片暂时无法加载。", result.status === 403 ? "BABY_FORBIDDEN" : "MEDIA_UNAVAILABLE");
      }
      return result.path;
    },
    async login(input: { username: string; password: string }): Promise<AuthContext> {
      if (sidecar) return identityExchange("/api/identity/legacy-login", credentials(input));
      if (!input.username.trim() || !input.password) throw new ApiError(400, "请输入原有账号和密码。");
      const finish = beginChange();
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
      } finally { finish(); }
    },
    async loginWithWechat(noticeVersion?: string): Promise<AuthContext> {
      requireSidecar();
      if (!options.native || !options.wechatLogin) throw new ApiError(400, "请在微信小程序内使用微信登录。");
      return identityExchange("/api/identity/wechat", async () => {
        let code: string;
        try { code = await options.wechatLogin!(); }
        catch { throw new ApiError(0, "暂时无法获取微信登录凭证，请重试。", "WECHAT_LOGIN_FAILED"); }
        if (!code.trim()) throw new ApiError(400, "微信登录凭证为空，请重试。", "WECHAT_LOGIN_FAILED");
        return { code, ...(noticeVersion ? { noticeVersion } : {}) };
      });
    },
    async bindLegacy(input: { username: string; password: string }): Promise<AuthContext> {
      return identityExchange("/api/identity/bind-legacy", credentials(input), true);
    },
    async createFamily(input: { name: string; guardian?: GuardianChoice }): Promise<AuthContext> {
      const name = input.name.trim();
      if (!name || name.length > 30) throw new ApiError(400, "宝宝昵称不能为空，且不能超过 30 个字。");
      return updateIdentityContext("/api/identity/family", { name, ...(input.guardian ? { guardian: input.guardian } : {}) });
    },
    async acceptInvitation(input: { code: string }): Promise<AuthContext> {
      const code = input.code.trim();
      if (!code) throw new ApiError(400, "请输入照护邀请码。");
      return updateIdentityContext("/api/identity/invitations/accept", { code });
    },
    async logout(): Promise<void> {
      if (loggingOut) throw new ApiError(409, "正在退出登录，请稍候。");
      loggingOut = true;
      options.onAccessRevoked?.();
      clearPhotos();
      revision++;
      expiredRevision = undefined;
      try {
        // Wait for an in-flight login/bind response before clearing its browser cookie.
        // Its generation is already invalid, so it cannot restore a client view or token.
        await activeChange;
        if (sidecar) { await request("/api/identity/logout", { method: "POST", json: {}, logout: true }); return; }
        const token = await csrfToken();
        const result = decode.object(await request("/api/auth/signout", { method: "POST", form: { csrfToken: token, callbackUrl: `${origin}/` } }));
        if (typeof result.url !== "string" || /[?&]error=/.test(result.url)) throw new ApiError(502, "退出登录未完成，请重试。");
      } finally {
        revision++;
        jar?.clear();
        identity?.clear();
        pendingLogoutAuthorization = undefined;
        authenticatedContextSeen = false;
        loggingOut = false;
      }
    },
    async getBabies(babyId?: string) {
      return decode.babyList(await request(`/api/app/user-babies${queryString({ babyId })}`, { babyId }));
    },
    async getMembership(babyId: string) {
      requireSidecar();
      return decodeMembership(await request(scoped("membership", babyId), { babyId }), babyId);
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
    async getChatHistory(babyId: string) {
      requireSidecar();
      return decodeHistory(await request(scoped("chat", babyId), { babyId }), babyId);
    },
    async getChatRequest(babyId: string, requestId: string) {
      requireSidecar();
      const result = decode.object(await request(scoped("chat/request", babyId, { requestId }), { babyId }));
      const turn = result.turn === null ? null : decodeTurn(result.turn, babyId);
      if (turn && turn.requestId !== requestId) throw new decode.ResponseFormatError();
      return turn;
    },
    async sendChat(input: ChatRequest) {
      requireSidecar(); day(input.context.viewedDate);
      const result = decode.object(await request("/api/app/chat", { method: "POST", babyId: input.babyId, json: input }));
      const turn = decodeTurn(result.turn, input.babyId);
      if (turn.requestId !== input.requestId) throw new decode.ResponseFormatError();
      return turn;
    },
    async getPending(babyId: string) {
      requireSidecar();
      return decode.array(await request(scoped("records/pending", babyId), { babyId }), value => decodePending(value, babyId));
    },
    async uploadAttachment(babyId: string, requestId: string, bytes: ArrayBuffer, mime: string) {
      requireSidecar();
      if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || !bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) throw new ApiError(400, "请选择不超过 10 MB 的 JPG、PNG 或 WebP 照片。");
      const result = decode.object(await request(scoped("attachments", babyId), { method: "POST", babyId, binary: bytes, mime, requestId }));
      return decodeAttachment(result.data, babyId);
    },
    async getSnapshot(babyId: string, date: string) {
      if (!sidecar) throw new ApiError(400, "当前服务未启用统一记录视图。");
      day(date);
      const result = decode.recordSnapshot(await request(scoped("records/snapshot", babyId, { date }), { babyId }));
      result.activities.forEach(item => { if (item.babyId !== babyId) throw new decode.ResponseFormatError(); });
      result.events.forEach(item => verifyScope(item, babyId));
      result.questions.forEach(item => verifyScope(item, babyId));
      return result;
    },
    async getRecordEvent(babyId: string, eventId: string) {
      requireSidecar();
      const result = decode.recordCollection(await request(scoped("records/snapshot", babyId, { eventId: requiredId(eventId) }), { babyId }));
      result.activities.forEach(item => { if (item.babyId !== babyId) throw new decode.ResponseFormatError(); });
      result.events.forEach(item => verifyScope(item, babyId));
      result.questions.forEach(item => verifyScope(item, babyId));
      return result.events.find(item => item.id === eventId || item.legacyId === eventId) ?? null;
    },
    async getSyncStatus(babyId: string) {
      requireSidecar();
      return decode.array(await request(scoped("records/sync", babyId), { babyId }), decode.recordSyncStatus);
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
      // Legacy sends saved snapshots; sidecar adds live projection coverage and known-value masks.
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
