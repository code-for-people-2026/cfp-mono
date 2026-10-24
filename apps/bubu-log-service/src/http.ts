import type { SafetyService } from "./safety/service";
import type { DeletionService } from "./privacy/deletion";
import type { PrivacyService } from "./privacy/service";
import { z } from "zod";
import { AppError, permissions, type Permission } from "./contracts";
import { readLegacyPhoto, protectLegacyPhotos, protectRecordPhotos, type MediaOptions } from "./media";
import { IdentityService, type Principal } from "./identity";
import type { RecordsService } from "./records/service";
import { createAttachmentHandler, type AttachmentService } from "./records/attachments";
import type { CollectorService } from "./collector/service";
import { handleRecordsMcp } from "./records/mcp";
import { readRecordView, readSyncStatus } from "./records/read-model";
import type { ChatService } from "./chat/service";
import { chatInputSchema } from "./chat/contracts";
import type { MembershipService } from "./membership/service";
import { rejectPayment } from "./membership/payment";

const COOKIE = "bubu_session";
const id = z.string().trim().min(1).max(200);
const credentials = z.object({ username: z.string().trim().min(1).max(128), password: z.string().min(1).max(256) }).strict();
const babyScope = z.object({ babyId: id }).strict();
export function createHandler(service: IdentityService, publicOrigin: string, media: MediaOptions = { allowedOrigins: [] }, features?: {records:RecordsService;attachments:AttachmentService;collector:CollectorService;chat?:ChatService;membership?:MembershipService;privacy?:PrivacyService;deletion?:DeletionService;safety?:SafetyService}) {
  const origin = new URL(publicOrigin).origin;
  const secure = origin.startsWith("https://");
  const cookie = (token: string, age: number) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
  const sessions = (req: Request) => {
    const bearer = req.headers.get("authorization");
    const browserToken = req.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (bearer && browserToken) throw new AppError(400, "AMBIGUOUS_CREDENTIAL", "请使用一种登录凭证。");
    if (bearer) {
      if (!bearer.startsWith("Bearer ")) throw new AppError(401, "UNAUTHORIZED", "登录已失效。");
      return service.authenticate(bearer.slice(7), "bearer");
    }
    return service.authenticate(browserToken || "", "browser");
  };
  const resultWithSession = (result: { token: string; expiresAt: string; context: unknown }, browser: boolean) => browser
    ? json({ expiresAt: result.expiresAt, context: result.context }, 200, { "Set-Cookie": cookie(result.token, Math.max(0, Math.floor((Date.parse(result.expiresAt) - service.now()) / 1000))) })
    : json(result);
  // Admission limits are per server process and do not trust client-supplied forwarding headers.
  let loginWindow = 0;
  let logins = 0;
  return async function handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      const browser = req.headers.get("x-bubu-client") === "browser" || !!req.headers.get("origin") || !!req.headers.get("cookie");
      const mutation = !["GET", "HEAD"].includes(req.method);
      if (mutation) {
        if ((browser && req.headers.get("origin") !== origin) || (req.headers.has("origin") && req.headers.get("origin") !== origin)) throw new AppError(403, "UNTRUSTED_ORIGIN", "请求来源不受信任。");
        if (!(features && path === "/api/app/attachments" && req.method === "POST") && !req.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415, "JSON_REQUIRED", "请发送 JSON 请求。");
      }
      const body = async (limit=16384) => {
        const raw = await req.text();
        if (Buffer.byteLength(raw) > limit) throw new AppError(413, "BODY_TOO_LARGE", "请求内容过长。");
        try { return JSON.parse(raw) as unknown; } catch { throw new AppError(400, "INVALID_JSON", "请求格式不正确。"); }
      };
      if (req.method === "GET" && path === "/health") return json({ ok: true, service: "bubu-log-service" });
      if(features && path==="/api/mcp") {
        if(req.method!=="POST")return json({code:"METHOD_NOT_ALLOWED",error:"MCP使用无状态Streamable HTTP POST。"},405);
        return await handleRecordsMcp(req,await body(1024*1024),service,features.records,features.collector);
      }
      if (req.method === "POST" && ["/api/identity/wechat", "/api/identity/legacy-login", "/api/identity/bind-legacy"].includes(path)) {
        const window = Math.floor(service.now() / 60000);
        if (window !== loginWindow) { loginWindow = window; logins = 0; }
        if (++logins > 60) throw new AppError(429, "LOGIN_RATE_LIMIT", "登录尝试过多，请稍后重试。");
      }
      if (req.method === "POST" && path === "/api/identity/wechat") {
        if (browser) throw new AppError(400, "NATIVE_REQUIRED", "请在微信小程序内登录。");
        const input = z.object({ code: z.string().min(1).max(512), noticeVersion: z.string().max(100).optional() }).strict().parse(await body());
        features?.privacy?.checkLoginNotice(input.noticeVersion);
        return resultWithSession(await service.loginWechat(input.code), false);
      }
      if (req.method === "POST" && path === "/api/identity/legacy-login") {
        const input = credentials.parse(await body());
        return resultWithSession(await service.loginLegacy(input.username, input.password, browser ? "browser" : "native"), browser);
      }
      if (req.method === "GET" && path === "/api/app/privacy/policy" && features?.privacy) return json(features.privacy.policy());
      const principal: Principal = await sessions(req);
      if (features?.safety && req.method === "POST" && path === "/api/app/safety/acknowledge") {
        const input = z.object({ babyId: id, signalId: id }).strict().parse(await body());
        return json(await features.safety.acknowledge(principal, input.babyId, input.signalId));
      }
      if (features?.safety && req.method === "GET" && path === "/api/app/safety") return json({ data: await features.safety.notices(principal, id.parse(url.searchParams.get("babyId"))) });
      if (features?.privacy && path.startsWith("/api/app/privacy/")) {
        const privacy = features.privacy;
        if (features.deletion) {
          if (req.method === "GET" && path === "/api/app/privacy/export") return json(await features.deletion.export(principal, url.searchParams.get("babyId") || undefined));
          if (req.method === "GET" && path === "/api/app/privacy/deletions") return json({ data: await features.deletion.jobs(principal) });
          if (req.method === "POST" && path === "/api/app/privacy/delete-intent") {
            const input = z.object({ kind: z.enum(["account", "family"]), babyId: id.optional() }).strict().parse(await body());
            return json(await features.deletion.prepare(principal, input.kind, input.babyId));
          }
          if (req.method === "POST" && path === "/api/app/privacy/delete-confirm") {
            const input = z.object({ token: z.string().min(20).max(100), confirmation: z.string().max(50) }).strict().parse(await body());
            const job = await features.deletion.confirm(principal, input.token, input.confirmation);
            void features.deletion.processPending().catch(() => undefined);
            return json(job, 202);
          }
        }
        if (req.method === "GET" && path === "/api/app/privacy/status") return json(await privacy.status(principal, url.searchParams.get("babyId") || undefined));
        if (req.method === "GET" && path === "/api/app/privacy/requests") return json({ data: await privacy.requests(principal) });
        if (req.method === "POST" && path === "/api/app/privacy/consent") return json(await privacy.consent(principal, await body()));
        if (req.method === "POST" && path === "/api/app/privacy/guardian") {
          const input = z.object({ babyId: id, consent: z.unknown() }).strict().parse(await body());
          return json(await privacy.guardian(principal, input.babyId, input.consent));
        }
        if (req.method === "POST" && path === "/api/app/privacy/withdraw") {
          const input = z.object({ babyId: id.optional() }).strict().parse(await body());
          return json(await privacy.withdraw(principal, input.babyId));
        }
        if (req.method === "POST" && path === "/api/app/privacy/requests") return json(await privacy.request(principal, await body()), 201);
      }
      if (path === "/api/payments" || path.startsWith("/api/payments/")) rejectPayment();
      if(features) {const attachmentResponse=await createAttachmentHandler(features.attachments)(req,principal);if(attachmentResponse)return attachmentResponse;}
      if (features?.chat && path === "/api/app/chat" && req.method === "POST") {
        const input = chatInputSchema.parse(await body(32768));
        if (req.headers.has("x-baby-id") && req.headers.get("x-baby-id") !== input.babyId) throw new AppError(400, "SCOPE_MISMATCH", "宝宝范围不一致。");
        return json({ turn: await features.chat.submit(principal, input) });
      }
      if (req.method === "POST" && path === "/api/identity/bind-legacy") {
        await features?.privacy?.requirePerson(principal.subjectId);
        const input = credentials.parse(await body());
        return resultWithSession(await service.bindLegacy(principal, input.username, input.password), browser);
      }
      if (req.method === "POST" && path === "/api/identity/family") {
        await features?.privacy?.requirePerson(principal.subjectId);
        const input = z.object({ name: z.string().trim().min(1).max(30), guardian: z.unknown().optional() }).strict().parse(await body());
        return json(features?.privacy ? await features.privacy.createFamily(principal, input.name, input.guardian) : await service.createFamily(principal, input.name));
      }
      if (req.method === "POST" && path === "/api/identity/logout") {
        await service.logout(principal);
        return json({}, 200, browser ? { "Set-Cookie": cookie("", 0) } : {});
      }
      if (req.method === "POST" && path === "/api/identity/invitations") {
        const input = z.object({ babyId: id, access: z.enum(["read", "write"]) }).strict().parse(await body());
        return json(await service.invite(principal, input.babyId, input.access));
      }
      if (req.method === "POST" && path === "/api/identity/invitations/accept") {
        await features?.privacy?.requirePerson(principal.subjectId);
        const input = z.object({ code: z.string().min(1).max(128) }).strict().parse(await body());
        return json(await service.acceptInvite(principal, input.code));
      }
      if (req.method === "POST" && path === "/api/identity/grants") {
        const input = z.object({ babyId: id, subjectId: id, state: z.enum(["active", "revoked"]), permissions: z.array(z.enum(permissions as [Permission, ...Permission[]])).max(6).default([]) }).strict().parse(await body());
        return json(await service.setGrant(principal, input.babyId, input.subjectId, input.state, input.permissions));
      }
      if (req.method === "POST" && path === "/api/identity/group-bindings") {
        const input = z.object({ babyId: id, groupId: id, agentId: id, active: z.boolean() }).strict().parse(await body());
        return json(await service.bindGroup(principal, input.babyId, input.groupId, input.agentId, input.active));
      }
      if (req.method === "POST" && path === "/api/identity/agent-credentials") {
        const input = z.object({ babyId: id, kind: z.enum(["chat-agent", "collector"]), groupId: id.optional(), agentId: id.optional() }).strict().parse(await body());
        return json(await service.issueAgent(principal, input.babyId, input.kind, input));
      }
      if (req.method === "GET" && path === "/api/app/auth/context") return json(await service.context(principal, url.searchParams.get("babyId") || undefined));
      if (req.method === "GET" && path === "/api/app/user-babies") {
        const context = await service.context(principal, url.searchParams.get("babyId") || undefined);
        return json({ data: context.babies, defaultBabyId: context.defaultBabyId, currentBabyId: context.baby?.id || null });
      }
      const babyId = babyScope.parse({ babyId: url.searchParams.get("babyId") || req.headers.get("x-baby-id") }).babyId;
      if (req.headers.has("x-baby-id") && req.headers.get("x-baby-id") !== babyId) throw new AppError(400, "SCOPE_MISMATCH", "宝宝范围不一致。");
      if (features?.membership && req.method === "GET" && path === "/api/app/membership") return json(await features.membership.status(principal, babyId));
      if (features?.chat && req.method === "GET" && path === "/api/app/chat") return json(await features.chat.history(principal, babyId));
      if (features?.chat && req.method === "GET" && path === "/api/app/chat/request") return json({ turn: await features.chat.request(principal, babyId, id.parse(url.searchParams.get("requestId"))) });
      if(features&&req.method==="GET"&&path==="/api/app/records/snapshot") {
        const eventId=url.searchParams.get("eventId")||undefined;
        const snapshot=await features.records.query(principal,{babyId,date:url.searchParams.get("date")||(eventId?undefined:features.records.today()),eventId});
        const mediaQuestions=await features.collector.pendingMedia(principal,babyId);
        return json(protectRecordPhotos({...snapshot,mediaQuestions:mediaQuestions.filter(question=>!eventId||question.eventIds.includes(eventId))},babyId));
      }
      if(features&&req.method==="GET"&&path==="/api/app/records/pending")return json([...await features.records.pending(principal,babyId),...await features.collector.pendingMedia(principal,babyId)]);
      if(features&&req.method==="GET"&&path==="/api/app/records/sync")return json(await readSyncStatus(features.records,principal,babyId,features.collector));
      if(features&&req.method==="GET"&&path==="/api/app/records/revisions")return json(protectRecordPhotos(await features.records.revisions(principal,babyId,id.parse(url.searchParams.get("eventId"))),babyId));
      if (req.method === "GET" && path.startsWith("/api/app/media/activities/")) {
        const activityId = decodeURIComponent(path.slice("/api/app/media/activities/".length));
        return await service.executeAuthorized(principal, babyId, "media:read", async (scope, request) => {
          const activity = await service.legacy.read(babyId, `activities/${activityId}`, new URLSearchParams());
          return readLegacyPhoto(activity, babyId, { ...media, ...(features ? { readPrivate: async (id: string) => {
            const { attachment, bytes } = await features.attachments.readInScope(scope, request, id);
            return new Response(new Uint8Array(bytes), { headers: { "Content-Type": attachment.mime, "Content-Length": String(attachment.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
          } } : {}) });
        });
      }
      if (req.method === "PATCH" && path.startsWith("/api/app/user-babies/")) {
        if (decodeURIComponent(path.slice("/api/app/user-babies/".length)) !== babyId) throw new AppError(403, "BABY_FORBIDDEN", "宝宝范围不一致。");
        const input = z.object({ name: z.string().trim().min(1).max(30), fullName: z.string().trim().max(60).nullable() }).strict().parse(await body());
        return await service.executeAuthorized(principal, babyId, "baby:manage", async () => {
          const context = await service.context(principal);
          if (context.babies.some(baby => baby.id !== babyId && baby.name.trim().toLowerCase() === input.name.toLowerCase())) throw new AppError(409, "DUPLICATE_NAME", "已存在同名宝宝。");
          return json({ data: await service.legacy.updateBabyNames(babyId, input) });
        });
      }
      if (req.method === "GET" && /^\/api\/app\/(activities(?:\/[^/]+)?|daily-stats(?:\/[^/]+)?)$/.test(path)) {
        await service.authorize(principal, babyId, "records:read");
        const value=features?await readRecordView(features.records,principal,babyId,path.slice("/api/app/".length),url.searchParams):await service.legacy.read(babyId,path.slice("/api/app/".length),url.searchParams);
        return json(protectLegacyPhotos(value, babyId));
      }
      return json({ code: "NOT_FOUND", error: "未找到此接口。" }, 404);
    } catch (error) {
      if (error instanceof z.ZodError) return json({ code: "INVALID_INPUT", error: "请求字段或格式不正确。" }, 400);
      if (error instanceof AppError) return json({ code: error.code, error: error.message, retryable: error.retryable ?? error.status >= 500 }, error.status);
      // Do not leak upstream response bodies, credential URLs or stack traces to clients.
      return json({ code: "SERVICE_UNAVAILABLE", error: "服务暂时不可用，请稍后重试。" }, 503);
    }
  };
}
