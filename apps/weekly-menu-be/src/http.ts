import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  AuthenticationError,
  type AuthenticatedSession,
  type SessionService
} from "./auth";

const BODY_LIMIT_BYTES = 16 * 1_024;
const KNOWN_ROUTES = new Set([
  "/api/health",
  "/api/ready",
  "/api/v1/auth/session",
  "/api/v1/auth/wechat"
]);

export type SafeLogEvent = Readonly<{
  event: "http_request";
  method: string;
  path: string;
  requestId: string;
  status: number;
}>;

export type SafeLogger = (event: SafeLogEvent) => void;

export type ReadinessProbe = () => Promise<void>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string
  ) {
    super(code);
    this.name = "HttpError";
  }
}

function defaultLogger(event: SafeLogEvent): void {
  console.log(JSON.stringify(event));
}

function writeJson(
  response: ServerResponse,
  status: number,
  requestId: string,
  body: unknown
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId
  });
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, error: HttpError, requestId: string): void {
  writeJson(response, error.status, requestId, {
    error: {
      code: error.code,
      message: error.publicMessage,
      requestId
    }
  });
}

function asHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof AuthenticationError) {
    return error.code === "INVALID_TOKEN"
      ? new HttpError(401, "UNAUTHORIZED", "Authentication is required")
      : new HttpError(502, "WECHAT_LOGIN_FAILED", "WeChat login is unavailable");
  }
  return new HttpError(500, "INTERNAL_ERROR", "An internal error occurred");
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT_BYTES) {
    request.resume();
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  const body = await new Promise<string>((resolve, reject) => {
    let settled = false;
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        settled = true;
        reject(new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", () => {
      if (!settled) reject(new HttpError(400, "INVALID_REQUEST", "Invalid request body"));
    });
  });

  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "Invalid JSON request body");
  }
}

function parseLoginCode(body: Record<string, unknown>): string {
  if (
    Object.keys(body).length !== 1 ||
    typeof body.code !== "string" ||
    body.code.trim().length === 0 ||
    body.code.length > 256
  ) {
    throw new HttpError(400, "INVALID_REQUEST", "A valid login code is required");
  }
  return body.code;
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    throw new AuthenticationError("INVALID_TOKEN");
  }
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match?.[1]) throw new AuthenticationError("INVALID_TOKEN");
  return match[1];
}

export async function requireBearerSession(
  request: IncomingMessage,
  auth: Pick<SessionService, "authenticate">
): Promise<AuthenticatedSession> {
  return auth.authenticate(bearerToken(request));
}

export function createWeeklyMenuHttpServer(input: Readonly<{
  auth: Pick<SessionService, "authenticate" | "login" | "revoke">;
  readiness: ReadinessProbe;
  release: string;
  logger?: SafeLogger;
  requestId?: () => string;
}>): Server {
  const logger = input.logger ?? defaultLogger;
  const createRequestId = input.requestId ?? randomUUID;

  return createServer((request, response) => {
    void (async () => {
      const requestId = createRequestId();
      const method = request.method ?? "UNKNOWN";
      let path = "<invalid>";
      let logPath = "<invalid>";
      let status = 500;

      try {
        try {
          path = new URL(request.url ?? "/", "http://weekly-menu.local").pathname;
          logPath = KNOWN_ROUTES.has(path) ? path : "<unmatched>";
        } catch {
          throw new HttpError(400, "INVALID_REQUEST", "Invalid request target");
        }
        if (path === "/api/health") {
          if (method !== "GET") {
            response.setHeader("allow", "GET");
            throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
          }
          status = 200;
          writeJson(response, status, requestId, { status: "ok", release: input.release });
          return;
        }

        if (path === "/api/ready") {
          if (method !== "GET") {
            response.setHeader("allow", "GET");
            throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
          }
          try {
            await input.readiness();
          } catch {
            throw new HttpError(503, "SERVICE_NOT_READY", "Service is not ready");
          }
          status = 200;
          writeJson(response, status, requestId, { status: "ready" });
          return;
        }

        if (path === "/api/v1/auth/wechat") {
          if (method !== "POST") {
            response.setHeader("allow", "POST");
            throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
          }
          const body = await readJsonBody(request);
          const session = await input.auth.login(parseLoginCode(body));
          status = 201;
          writeJson(response, status, requestId, session);
          return;
        }

        if (path === "/api/v1/auth/session") {
          if (method !== "DELETE") {
            response.setHeader("allow", "DELETE");
            throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
          }
          const session = await requireBearerSession(request, input.auth);
          await input.auth.revoke(session);
          status = 204;
          response.writeHead(status, {
            "cache-control": "no-store",
            "x-request-id": requestId
          });
          response.end();
          return;
        }

        throw new HttpError(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        const publicError = asHttpError(error);
        status = publicError.status;
        writeError(response, publicError, requestId);
      } finally {
        try {
          logger({ event: "http_request", method, path: logPath, requestId, status });
        } catch {
          // Observability must never change an HTTP response or expose request data.
        }
      }
    })();
  });
}
