import { legalPage, privacyGet, privacyPost, recoveryResponse } from "../../../../privacy/http";
import { privacyPolicy } from "../../../../privacy/policy";
import { privacyService } from "../../../../privacy/service";
import { z } from "zod";
import { cms } from "../../../../cms/client";
import { Repository } from "../../../../cms/repository";
import { AppError } from "../../../../domain/contracts";
import { GreetingService } from "../../../../domain/greetings";
import { ContextService } from "../../../../domain/context";
import { adConfiguration } from "../../../../domain/rewarded-ads";
import { DEFAULT_MODEL } from "../../../../models/deepseek";
import {
  authenticate,
  checkOrigin,
  checkClientRequest,
  COOKIE,
  mintCredential,
  revokeTokens,
} from "../../../../server/auth";
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
export const maxDuration = 90;
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
        platformConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        model: process.env.HELLO_MODEL || DEFAULT_MODEL,
        origin: process.env.HELLO_ORIGIN || "http://127.0.0.1:3310",
        advertisement: adConfiguration(),
        protocols: { agUi: "1.0", a2ui: A2UI_VERSION, catalogId: CATALOG_ID },
      });
    const payload = await cms();
    const owner = await authenticate(payload, request);
    if (path[0] === "privacy") return await privacyGet(payload, owner, path[1]);
    if (owner.auth === "bearer") {
      await privacyService(payload, owner).require("external");
      await privacyService(payload, owner).requireInput({});
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
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const path = (await context.params).path;
    const payload = await cms();
    if (path[0] === "privacy-recover") return await recoveryResponse(payload, request);
    if (path[0] === "miniapp-identity") {
      if (request.headers.has("origin"))
        throw new AppError(403, "浏览器请使用访客 Cookie 入口");
      // 本地架构示例的匿名设备身份，不冒充 wx.login。上线需接入正式微信登录。
      rateLimit("miniapp-identity");
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
    rateLimit(owner.id);
    if (path[0] === "privacy") return await privacyPost(payload, owner, path[1], request);
    const privacy = privacyService(payload, owner);
    const service = new GreetingService(new Repository(payload, owner));
    if (path[0] === "token") {
      if (path[1] === "revoke") {
        await revokeTokens(payload, owner);
        return json({ revoked: true });
      }
      await privacy.require("external");
      await privacy.requireInput({});
      const credential = await mintCredential(payload, "bearer", owner.id);
      return json({ token: credential.token, expiresAt: credential.expiresAt });
    }
    await privacy.require();
    const body = await readJson(
      request,
      path[0] === "ag-ui" ? 64 * 1024 : undefined,
    );
    if (path[0] === "ag-ui" && path.length === 1) {
      const input = readAgentInput(body);
      await privacy.requireInput(input);
      return agentStream(service, input);
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
      return json(await service.generateGreeting(body));
    }
    if (path[0] === "upload") {
      await privacy.requireImageInput();
      const { base64 } = z
        .object({ base64: z.string().min(1).max(7_000_000) })
        .parse(body);
      return json(await service.upload(Buffer.from(base64, "base64")));
    }
    throw new AppError(404, "接口不存在");
  } catch (error) {
    return failure(error);
  }
}
