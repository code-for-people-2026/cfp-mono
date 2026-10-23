import { z } from "zod";
import { AppError } from "../contracts";
import { MAX_ATTACHMENT_BYTES } from "../records/attachments";
import { readOpsUser } from "./access";
import { actionSchema, readSchema, opsReason, opsRequestId, type MembershipOperations } from "./contracts";
import { OperationsService, type OperationsRuntime } from "./service";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
export function createOperationsHandler(runtime: OperationsRuntime, options: { membership?: MembershipOperations } = {}) {
  const service = new OperationsService(runtime, options.membership), origin = new URL(runtime.opsOrigin).origin;
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  return async (request: Request): Promise<Response> => {
    try {
      // An ordinary caregiver/collector Bearer can never use the privileged cookie bridge.
      if (request.headers.has("authorization") || !request.headers.get("cookie")) throw new AppError(401, "OPS_LOGIN_REQUIRED", "请登录运营后台。");
      if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== origin) throw new AppError(403, "OPS_ORIGIN_REJECTED", "请求来源不受信任。");
      const auth = await runtime.store.payload.auth({ headers: request.headers });
      if (!auth.user) throw new AppError(401, "OPS_LOGIN_REQUIRED", "运营登录已失效。");
      const user = await readOpsUser(runtime.store.payload, auth.user);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/ops/context") return json(await service.context(user));
      if (request.method === "GET" && url.pathname === "/api/ops/overview") return json(await service.overview(user, url.searchParams.get("babyId") || ""));
      if (request.method === "POST" && url.pathname === "/api/ops/attachment") {
        const reason = opsReason.parse(decodeURIComponent(request.headers.get("x-bubu-reason") || ""));
        const requestId = opsRequestId.parse(url.searchParams.get("requestId"));
        const length = Number(request.headers.get("content-length"));
        if (length > MAX_ATTACHMENT_BYTES) throw new AppError(413, "BODY_TOO_LARGE", "照片超过大小限制。");
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AppError(413, "BODY_TOO_LARGE", "照片超过大小限制。");
        return json({ data: await service.upload(user, url.searchParams.get("babyId") || "", reason, requestId, bytes, request.headers.get("content-type") || "") });
      }
      if (request.method === "POST") {
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415, "JSON_REQUIRED", "请发送 JSON 请求。");
        const text = await request.text();
        if (Buffer.byteLength(text) > 1024 * 1024) throw new AppError(413, "BODY_TOO_LARGE", "请求内容过长。");
        let raw: unknown; try { raw = JSON.parse(text); } catch { throw new AppError(400, "INVALID_JSON", "请求格式不正确。"); }
        if (url.pathname === "/api/ops/action") return json({ receipt: await service.execute(user, actionSchema.parse(raw)) });
        if (url.pathname === "/api/ops/read") {
          const input = readSchema.parse(raw), value = await service.read(user, input);
          if (input.kind === "attachment") {
            const { bytes, attachment } = value as { bytes: Buffer; attachment: { mime: string } };
            return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": attachment.mime, "Content-Length": String(bytes.byteLength), "Content-Disposition": "inline" } });
          }
          return json(value);
        }
      }
      return json({ code: "NOT_FOUND", error: "未找到此运营入口。" }, 404);
    } catch (error) {
      if (error instanceof z.ZodError) return json({ code: "INVALID_INPUT", error: "请核对字段、理由与操作范围。", retryable: false }, 400);
      if (error instanceof AppError) return json({ code: error.code, error: error.message, retryable: error.status >= 500 }, error.status);
      return json({ code: "OPS_UNCONFIRMED", error: "操作结果尚未确认，请保留原请求号重试。", retryable: true }, 503);
    }
  };
}
