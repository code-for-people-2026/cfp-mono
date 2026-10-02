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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
type Context = { params: Promise<{ path: string[] }> };
const json = (value: unknown) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: Context) {
  try {
    const path = (await context.params).path;
    if (path[0] === "config")
      return json({
        platformConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        model: process.env.HELLO_MODEL || DEFAULT_MODEL,
        origin: process.env.HELLO_ORIGIN || "http://127.0.0.1:3310",
        advertisement: adConfiguration(),
      });
    const payload = await cms();
    const owner = await authenticate(payload, request);
    const service = new GreetingService(new Repository(payload, owner));
    if (path[0] === "context" && path.length === 2)
      return json(
        await new ContextService(service.repo).view(
          z.coerce.number().int().positive().parse(path[1]),
        ),
      );
    if (path[0] === "sessions" && !path[1])
      return json(await service.sessions());
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
    const service = new GreetingService(new Repository(payload, owner));
    if (path[0] === "token") {
      if (path[1] === "revoke") {
        await revokeTokens(payload, owner);
        return json({ revoked: true });
      }
      const credential = await mintCredential(payload, "bearer", owner.id);
      return json({ token: credential.token, expiresAt: credential.expiresAt });
    }
    const body = await readJson(request);
    if (path[0] === "context") {
      const args = z
        .object({
          sessionId: z.number().int().positive(),
          rewardId: z.string().uuid().optional(),
          completed: z.boolean().optional(),
          mode: z.enum(["platform", "byok"]).default("platform"),
          apiKey: z.string().min(10).max(256).optional(),
        })
        .parse(body);
      const memory = new ContextService(service.repo);
      if (path[1] === "ad-start")
        return json(await memory.startAd(args.sessionId));
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
    if (path[0] === "greet") return json(await service.generateGreeting(body));
    if (path[0] === "upload") {
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
