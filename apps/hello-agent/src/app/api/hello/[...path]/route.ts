import { InteractionService } from "../../../../interaction/service";
import { SERVICE_SCOPE } from "@cfp/hello-agent-contracts";
import { requirePlatformInput, rejectExternalConnection } from "../../../../server/service-scope";
import { publicImageState } from "../../../../images/service";
import { OperationsService } from "../../../../operations/service";
import { imageGenerationConfigured } from "../../../../images/wan";
import { imageReviewConfigured } from "../../../../operations/image-review";
import { avatarResponse, readProfile, PROFILE_BODY_LIMIT } from "../../../../profile/service";
import { AgeService } from "../../../../age/service";
import { agePost } from "../../../../age/http";
import { wechatLogin } from "../../../../age/wechat";
import { legalPage, privacyGet, privacyPost, recoveryResponse } from "../../../../privacy/http";
import { privacyPolicy } from "../../../../privacy/policy";
import { privacyService } from "../../../../privacy/service";
import { z } from "zod";
import { cms } from "../../../../cms/client";
import { Repository } from "../../../../cms/repository";
import { AppError, turnSchema } from "../../../../domain/contracts";
import { GreetingService } from "../../../../domain/greetings";
import { ContextService } from "../../../../domain/context";
import { adConfiguration } from "../../../../domain/rewarded-ads";
import { DEFAULT_MODEL } from "../../../../models/deepseek";
import {
  authenticate,
  withAuthenticatedExecution,
  checkOrigin,
  checkClientRequest,
  COOKIE,
  mintCredential,
  revokeTokens,
} from "../../../../server/auth";
import { withCredentialExecution, withCredentialLock } from "../../../../server/credential-lock";
import { rateLimitLogin } from "../../../../server/login-limits";
import { reservePublicAdmission } from "../../../../server/public-admission";
import { failure, readJson, rateLimit } from "../../../../server/http";
import { agentStream, readAgentInput } from "../../../../server/ag-ui";
import {
  illustrationPng,
  pageHtml,
  readArtifact,
} from "../../../../domain/artifact-rendering";
import {
  A2UI_VERSION,
  CATALOG_ID,
  a2uiCatalog,
} from "@cfp/hello-agent-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
type Context = { params: Promise<{ path: string[] }> };
const json = (value: unknown) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: Context) {
  try {
    const path = (await context.params).path;
    if (path[0] === "legal") return path[1] === "page" ? legalPage() : json(privacyPolicy());
    if (path[0] === "a2ui-catalog" && path.length === 1)
      return json(a2uiCatalog());
    if (path[0] === "config")
      return json({
        serviceScope: SERVICE_SCOPE,
        platformConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        imageGenerationConfigured: imageGenerationConfigured() && imageReviewConfigured(),
        model: process.env.HELLO_MODEL || DEFAULT_MODEL,
        origin: process.env.HELLO_ORIGIN || "http://127.0.0.1:3310",
        advertisement: adConfiguration(),
        protocols: { agUi: "1.0", a2ui: A2UI_VERSION, catalogId: CATALOG_ID },
      });
    const payload = await cms();
    const owner = await authenticate(payload, request);
    return await withAuthenticatedExecution(payload, request, owner, async (owner) => {
    if (path[0] === "safety") {
      if (owner.auth === "bearer") throw new AppError(403, "请本人在小程序或网页中查看投诉处理结果");
      const operations = new OperationsService(payload);
      return json({ configuration: await operations.configuration(), cases: await operations.mine(owner, path[1]) });
    }
      if (path[0] === "age" && path.length === 1) return json(await new AgeService(payload, owner).status());
      if (path[0] === "interaction" && path.length === 1) return json(await new InteractionService(payload, owner).status());
      if (path[0] === "privacy") return await privacyGet(payload, owner, path[1], request);
      if (owner.auth === "bearer") {
        await new AgeService(payload, owner).requireCapability();
        await privacyService(payload, owner).requireExternalAccess();
      }
      await new AgeService(payload, owner).requireLogin();
      if (path[0] === "profile") {
        if (owner.auth === "bearer") throw new AppError(403, "请本人在小程序或网页中查看资料");
        if (path.length === 1) return json(await readProfile(payload, owner.id));
        if (path.length === 2 && path[1] === "avatar") return avatarResponse(payload, owner.id);
      }
      const service = new GreetingService(new Repository(payload, owner));
      if (
        ["artifact-image", "artifact-page"].includes(path[0]) &&
        path.length === 3
      ) {
        const artifact = await readArtifact(
          service.repo,
          z.coerce.number().int().positive().parse(path[1]),
          path[2],
        );
        const turn = await service.repo.get("greetings", Number(path[1]));
        const contentId = `${owner.id}:${turn.id}:${turn.fingerprint}:${artifact.id}`;
        const external = turn.mode === "external";
        if (path[0] === "artifact-image" && artifact.kind === "image") {
          if (owner.auth === "bearer" && artifact.source.type === "media") await privacyService(payload, owner).require("sensitive");
          const result =
            artifact.source.type === "media"
              ? await service.media.read(artifact.source.mediaId)
              : { bytes: await illustrationPng(artifact, contentId, external), mimeType: "image/png" };
          return new Response(new Uint8Array(result.bytes), {
            headers: {
              "Content-Type": result.mimeType,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        if (path[0] === "artifact-page" && artifact.kind === "page")
          return new Response(pageHtml(artifact, contentId, external), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy":
                "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
              "Referrer-Policy": "no-referrer",
            },
          });
        throw new AppError(404, "作品类型不匹配");
      }
      if (path[0] === "context" && path.length === 2)
        return json(
          await new ContextService(service.repo).view(
            z.coerce.number().int().positive().parse(path[1]),
          ),
        );
      if (path[0] === "sessions" && !path[1])
        return json(await service.sessions());
      if (path[0] === "sessions" && path[2] === "requests" && path.length === 4)
        return json(
          await service.submission(
            z.coerce.number().int().positive().parse(path[1]),
            z.string().uuid().parse(path[3]),
          ),
        );
      if (path[0] === "sessions" && path[1])
        return json(
          await service.history(
            z.coerce.number().int().positive().parse(path[1]),
          ),
        );
      if (path[0] === "media" && path[1]) {
        if (owner.auth === "bearer") await privacyService(payload, owner).require("sensitive");
        const media = await service.media.read(
          z.coerce.number().int().positive().parse(path[1]),
        );
        return new Response(new Uint8Array(media.bytes), {
          headers: {
            "Content-Type": media.mimeType,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      throw new AppError(404, "接口不存在");
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const path = (await context.params).path;
    if (path[0] === "token" && path[1] !== "revoke") rejectExternalConnection();
    const payload = await cms();
    if (path[0] === "wechat-login" && path.length === 1) {
      rateLimitLogin(request, "wechat-login");
      return json(await wechatLogin(payload, request, await readJson(request, PROFILE_BODY_LIMIT)));
    }
    if (path[0] === "privacy-recover") return await recoveryResponse(payload, request);
    if (path[0] === "miniapp-identity") {
      if (request.headers.has("origin"))
        throw new AppError(403, "浏览器请使用访客 Cookie 入口");
      // 访客凭证仅用于登录前状态和数据权利；业务读取也必须完成微信登录。
      rateLimitLogin(request, "miniapp-identity");
      await reservePublicAdmission(payload, request, "identity");
      return json(await mintCredential(payload, "miniapp"));
    }
    if (path[0] === "identity") {
      checkOrigin(request);
      try {
        const owner = await authenticate(payload, request);
        return json({ owner: owner.id });
      } catch (error) {
        if (!(error instanceof AppError && error.status === 401)) throw error;
      }
      await reservePublicAdmission(payload, request, "identity");
      const credential = await mintCredential(payload, "cookie");
      const response = json({ owner: credential.owner });
      const secure = (process.env.HELLO_ORIGIN || "").startsWith("https:")
        ? "; Secure"
        : "";
      response.headers.set(
        "Set-Cookie",
        `${COOKIE}=${credential.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`,
      );
      return response;
    }
    const owner = await authenticate(payload, request);
    checkClientRequest(request, owner);
    if (path[0] === "privacy") return await privacyPost(payload, owner, path[1], request);
    if (path[0] === "interaction" && path.length === 2) {
      if (owner.auth === "bearer") throw new AppError(403, "请本人管理互动安全设置");
      rateLimit(`interaction:${owner.id}`);
      const body = await readJson(request, 2048);
      return await withAuthenticatedExecution(payload, request, owner, async (current) => {
        const service = new InteractionService(payload, current);
        if (path[1] === "contact") return json(await service.saveContact(body));
        if (path[1] === "remove-contact") return json(await service.removeContact());
        if (path[1] === "heartbeat") return json(await service.heartbeat());
        if (path[1] === "acknowledge") return json(await service.acknowledge(body));
        throw new AppError(404, "接口不存在");
      });
    }
    if (path[0] === "safety") {
      if (owner.auth === "bearer") throw new AppError(403, "请本人在小程序或网页中提交举报或申诉");
      const body = await readJson(request, 8 * 1024);
      return await withAuthenticatedExecution(payload, request, owner, async (current) => {
        await reservePublicAdmission(payload, request, "safety");
        return json(await new OperationsService(payload).complain(current, body));
      });
    }
    // Complaints remain available when generation or its request quota is blocked.
    // External business traffic cannot spend the person's privacy-control quota.
    rateLimit(path[0] === "token" && owner.auth !== "bearer" ? `privacy-control:${owner.id}` : owner.id);
    if (path[0] === "token") {
      return await withCredentialLock(owner.id, async () => {
        // Cached authentication can predate recovery. Validate it again inside
        // the same gate that protects revocation and credential insertion.
        const current = await authenticate(payload, request);
        if (current.id !== owner.id) throw new AppError(401, "连接身份已变更，请重新连接");
        if (path[1] === "revoke") {
          await revokeTokens(payload, current);
          return json({ revoked: true });
        }
        rejectExternalConnection();
      });
    }
    if (path[0] === "age") return await withAuthenticatedExecution(payload, request, owner, (current) => agePost(payload, current, path[1], request));
    const body = await readJson(
      request,
      path[0] === "ag-ui" ? 64 * 1024 : undefined,
    );
    if (["greet", "context", "image-resume"].includes(path[0])) requirePlatformInput(body);
    return await withAuthenticatedExecution(payload, request, owner, async (owner) => {
      checkClientRequest(request, owner);
      const privacy = privacyService(payload, owner);
      const service = new GreetingService(new Repository(payload, owner));
      await new AgeService(payload, owner).requireCapability();
      await privacy.require();
      if (owner.auth === "bearer") await privacy.requireExternalAccess();
      if (path[0] === "ag-ui" && path.length === 1) {
        const input = readAgentInput(body);
        await privacy.requireInput(input);
        // The stream starts generation before returning its Response. A nested
        // lease keeps revocation excluded until that work finishes or fails,
        // including when the client disconnects.
        return agentStream({ generateGreeting: (args, progress) => withCredentialExecution(owner.id, () => service.generateGreeting(args, progress)) }, input);
      }
    if (path[0] === "image-resume" && path.length === 1) {
      const retry = z.object({ turnId: z.number().int().positive(), requestId: z.string().uuid(), apiKey: z.string().min(10).max(256).optional() }).strict().parse(body);
      const row = await service.repo.get("greetings", retry.turnId);
      requirePlatformInput({ mode: row.mode, apiKey: retry.apiKey });
      await privacy.requireInput(row.input);
      const args = turnSchema.parse({ sessionId: row.sessionId, requestId: retry.requestId, input: row.input, mode: row.mode, apiKey: retry.apiKey });
      return agentStream({ generateGreeting: (args, progress) => withCredentialExecution(owner.id, () => service.generateGreeting(args, progress)), resumeImage: (id, key, progress) => withCredentialExecution(owner.id, () => service.resumeImage(id, key, progress)) }, args, row.id);
    }
      if (path[0] === "context") {
        const args = z
          .object({
            sessionId: z.number().int().positive(),
            rewardId: z.string().uuid().optional(),
            requestId: z.string().uuid().optional(),
            revision: z.number().int().nonnegative().optional(),
            completed: z.boolean().optional(),
            mode: z.enum(["platform", "byok"]).default("platform"),
            apiKey: z.string().min(10).max(256).optional(),
          })
          .parse(body);
        await privacy.requireInput({});
        const memory = new ContextService(service.repo);
        if (path[1] === "ad-start")
          return json(await memory.startAd(args.sessionId));
        if (path[1] === "preview-compact") {
          if (args.mode === "byok" && !args.apiKey)
            throw new AppError(400, "请填写本次用于整理记忆的 DeepSeek 密钥");
          return json(
            await memory.compactPreview(
              args.sessionId,
              z.string().uuid().parse(args.requestId),
              z.number().int().nonnegative().parse(args.revision),
              args.mode === "byok" ? args.apiKey : undefined,
            ),
          );
        }
        const rewardId = z.string().uuid().parse(args.rewardId);
        if (path[1] === "ad-complete")
          return json(
            await memory.finishAd(
              args.sessionId,
              rewardId,
              args.completed === true,
            ),
          );
        if (path[1] === "compact") {
          if (args.mode === "byok" && !args.apiKey)
            throw new AppError(400, "请填写本次用于整理记忆的 DeepSeek 密钥");
          return json(
            await memory.compact(
              args.sessionId,
              rewardId,
              args.mode === "byok" ? args.apiKey : undefined,
            ),
          );
        }
      }
      if (path[0] === "sessions") {
        const { title } = z
          .object({ title: z.string().trim().min(1).max(80).optional() })
          .parse(body);
        return json(await service.createSession(title));
      }
      if (path[0] === "greet") {
        await privacy.requireInput(body);
        return json(publicImageState(await service.generateGreeting(body)));
      }
      if (path[0] === "upload") {
        await privacy.requireImageInput();
        const { base64 } = z
          .object({ base64: z.string().min(1).max(7_000_000) })
          .parse(body);
        return json(await service.upload(Buffer.from(base64, "base64")));
      }
      throw new AppError(404, "接口不存在");
    });
  } catch (error) {
    return failure(error);
  }
}
