import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { ErrorResponseSchema, LoginInputSchema } from "@cfp/kith-inn-contracts";
import { ApiError } from "./auth";
import type { Sessions } from "./sessions";
import type { Dishes } from "./dishes";

export type SafeLogger = (event: { requestId: string; method: string; route: string; status: number; durationMs: number }) => void;
const prefix = "/api/kith-inn";
const routes = ["/health", "/ready", "/sessions/wechat", "/sessions/current", "/dishes"];
const invalid = () => new ApiError(400, "INVALID_REQUEST", "请求格式不正确");

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 128 * 1024) {
        chunks.length = 0;
        reject(new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容过大"));
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { reject(invalid()); }
    });
    request.on("error", () => reject(invalid()));
  });
}

export function createKithInnHttpServer(input: {
  sessions: Pick<Sessions, "login" | "authenticate" | "revoke">;
  dishes?: Pick<Dishes, "list" | "create" | "update">;
  readiness: () => Promise<void>; logger?: SafeLogger; clock?: () => number;
}) {
  const clock = input.clock ?? Date.now;
  const windows = new Map<string, { count: number; expires: number }>();
  const limit = (key: string, max: number) => {
    const now = clock();
    for (const [key, window] of windows) if (window.expires <= now) windows.delete(key);
    const window = windows.get(key) ?? { count: 0, expires: now + 60_000 };
    windows.set(key, window);
    if (++window.count > max) throw new ApiError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试");
  };
  return createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, async (request, response) => {
    const requestId = randomUUID(), started = clock();
    let route = "unmatched", status = 500;
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-request-id", requestId);
    const send = (code: number, value?: unknown) => {
      status = code;
      response.statusCode = code;
      if (value !== undefined) response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(value === undefined ? undefined : JSON.stringify(value));
    };
    try {
      let url: URL;
      try { url = new URL(request.url ?? "/", "http://localhost"); }
      catch { throw invalid(); }
      route = routes.find((path) => url.pathname === prefix + path) ?? "unmatched";
      const dishId = /^\/api\/kith-inn\/dishes\/([^/]+)$/.exec(url.pathname)?.[1];
      if (dishId) route = "/dishes/{dishId}";
      if (request.method === "POST" && route === "/sessions/wechat") {
        limit(`ip:${request.socket.remoteAddress}`, 20); // Ignore spoofable forwarded headers.
      }
      const body = await readBody(request);
      if (url.search || (request.headersDistinct.authorization?.length ?? 0) > 1 ||
          (request.headersDistinct["idempotency-key"]?.length ?? 0) > 1 ||
          (request.headersDistinct["content-type"]?.length ?? 0) > 1 || (request.headers["content-type"] &&
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"]))) throw invalid();
      const json = (): unknown => {
        if (!request.headers["content-type"]) throw invalid();
        try { return JSON.parse(body); } catch { throw invalid(); }
      };
      if (request.method === "GET" && (route === "/health" || route === "/ready")) {
        if (body) throw invalid();
        if (route === "/ready") {
          try { await input.readiness(); }
          catch { throw new ApiError(503, "SERVICE_UNAVAILABLE", "服务暂不可用"); }
        }
        send(200, { status: route === "/health" ? "ok" : "ready" });
      } else if (request.method === "POST" && route === "/sessions/wechat") {
        const parsed = LoginInputSchema.safeParse(json());
        if (!parsed.success) throw invalid();
        send(201, await input.sessions.login(parsed.data.code));
      } else {
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? "")?.[1];
        if (!token) throw new ApiError(401, "UNAUTHORIZED", "请重新登录");
        const session = await input.sessions.authenticate(token);
        limit(`merchant:${session.merchantId}`, 120);
        if (input.dishes && route === "/dishes" && request.method === "GET") {
          if (body) throw invalid();
          send(200, await input.dishes.list(session));
        } else if (input.dishes && ((route === "/dishes" && request.method === "POST") ||
            (dishId && request.method === "PATCH"))) {
          const key = request.headers["idempotency-key"];
          if (typeof key !== "string") throw invalid();
          const result = dishId ? await input.dishes.update(session, key, dishId, json()) :
            await input.dishes.create(session, key, json());
          send(result.status, result.body);
        } else if (request.method === "DELETE" && route === "/sessions/current") {
          if (body) throw invalid();
          await input.sessions.revoke(session);
          send(204);
        } else {
          if (body) throw invalid();
          throw new ApiError(404, "NOT_FOUND", "没有找到请求的内容");
        }
      }
    } catch (error) {
      request.resume();
      const failure = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "服务处理失败，请稍后重试");
      if (failure.status === 429) response.setHeader("retry-after", "60");
      send(failure.status, ErrorResponseSchema.parse({ error: {
        code: failure.code, message: failure.message, requestId,
        ...(failure.details ? { details: failure.details } : {})
      } }));
    } finally {
      const logger = input.logger ?? ((event) => console.log(JSON.stringify(event)));
      try { logger({ requestId, method: request.method ?? "unknown", route, status, durationMs: clock() - started }); }
      catch { /* A logging failure must not reject an already handled request. */ }
    }
  });
}
