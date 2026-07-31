import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  WeeklyMenuDomainError,
  draftPlanDtoSchema,
  generatePlanInputSchema,
  planIdSchema,
  planListQuerySchema,
  replaceDishInputSchema
} from "@cfp/weekly-menu-shared";
import {
  AuthenticationError,
  type AuthenticatedSession,
  type SessionService
} from "./auth";
import { WeeklyMenuApiError, type WeeklyMenuService } from "./weekly-menu-service";

const BODY_LIMIT_BYTES = 16 * 1_024;
const KNOWN_ROUTES = new Set([
  "/api/health",
  "/api/ready",
  "/api/v1/auth/session",
  "/api/v1/auth/wechat",
  "/api/v1/weekly-menu/bootstrap",
  "/api/v1/weekly-menu/plans",
  "/api/v1/weekly-menu/plans/generate"
]);

const PLAN_ROUTE = /^\/api\/v1\/weekly-menu\/plans\/([^/]+?)(?:\/(dish|confirm|copy|dish-checklist))?$/;

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
  if (error instanceof WeeklyMenuApiError) {
    switch (error.code) {
      case "DEPENDENCY_UNAVAILABLE":
        return new HttpError(503, error.code, "Menu generation is unavailable");
      case "INVALID_REQUEST":
        return new HttpError(400, error.code, "Request validation failed");
      case "PLAN_ID_CONFLICT":
        return new HttpError(409, error.code, "Plan id already exists");
      case "PLAN_NOT_FOUND":
        return new HttpError(404, error.code, "Plan not found");
      case "RATE_LIMITED":
        return new HttpError(429, error.code, "Too many requests");
    }
  }
  if (error instanceof WeeklyMenuDomainError) {
    return error.code === "PLAN_FORBIDDEN"
      ? new HttpError(404, "PLAN_NOT_FOUND", "Plan not found")
      : new HttpError(409, error.code, "Plan operation is not allowed");
  }
  if (error instanceof Error && error.name === "ZodError") {
    return new HttpError(400, "INVALID_REQUEST", "Request validation failed");
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

async function assertEmptyBody(request: IncomingMessage): Promise<void> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > 0) {
    request.resume();
    throw new HttpError(400, "INVALID_REQUEST", "Request body must be empty");
  }
  if (request.readableEnded) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    request.on("data", () => {
      if (settled) return;
      settled = true;
      request.resume();
      reject(new HttpError(400, "INVALID_REQUEST", "Request body must be empty"));
    });
    request.on("end", () => {
      if (!settled) resolve();
    });
    request.on("error", () => {
      if (!settled) reject(new HttpError(400, "INVALID_REQUEST", "Invalid request body"));
    });
  });
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

function assertMethod(
  response: ServerResponse,
  actual: string,
  expected: "DELETE" | "GET" | "PATCH" | "POST" | "PUT"
): void {
  if (actual === expected) return;
  response.setHeader("allow", expected);
  throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
}

function parsePlanId(value: string): string {
  try {
    return planIdSchema.parse(decodeURIComponent(value));
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "Invalid plan id");
  }
}

function parsePlanListQuery(url: URL): { limit: number; offset: number } {
  const allowed = new Set(["limit", "offset"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new HttpError(400, "INVALID_REQUEST", "Invalid pagination query");
    }
  }
  const parseInteger = (name: "limit" | "offset"): number | undefined => {
    const value = url.searchParams.get(name);
    if (value === null) return undefined;
    if (!/^\d+$/.test(value)) {
      throw new HttpError(400, "INVALID_REQUEST", "Invalid pagination query");
    }
    return Number(value);
  };
  return planListQuerySchema.parse({
    limit: parseInteger("limit"),
    offset: parseInteger("offset")
  });
}

function planLogPath(suffix: string | undefined): string {
  return suffix
    ? `/api/v1/weekly-menu/plans/:id/${suffix}`
    : "/api/v1/weekly-menu/plans/:id";
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
  weeklyMenu: Pick<
    WeeklyMenuService,
    | "bootstrap"
    | "confirm"
    | "copy"
    | "delete"
    | "detail"
    | "dishChecklist"
    | "generate"
    | "list"
    | "replace"
    | "save"
  >;
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
          const parsedUrl = new URL(request.url ?? "/", "http://weekly-menu.local");
          path = parsedUrl.pathname;
          const planMatch = PLAN_ROUTE.exec(path);
          logPath = KNOWN_ROUTES.has(path)
            ? path
            : planMatch
              ? planLogPath(planMatch[2])
              : "<unmatched>";
        } catch {
          throw new HttpError(400, "INVALID_REQUEST", "Invalid request target");
        }
        if (path === "/api/health") {
          assertMethod(response, method, "GET");
          status = 200;
          writeJson(response, status, requestId, { status: "ok", release: input.release });
          return;
        }

        if (path === "/api/ready") {
          assertMethod(response, method, "GET");
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
          assertMethod(response, method, "POST");
          const body = await readJsonBody(request);
          const session = await input.auth.login(parseLoginCode(body));
          status = 201;
          writeJson(response, status, requestId, session);
          return;
        }

        if (path === "/api/v1/auth/session") {
          assertMethod(response, method, "DELETE");
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

        if (path === "/api/v1/weekly-menu/bootstrap") {
          assertMethod(response, method, "GET");
          const session = await requireBearerSession(request, input.auth);
          status = 200;
          writeJson(
            response,
            status,
            requestId,
            await input.weeklyMenu.bootstrap(session.identityId)
          );
          return;
        }

        if (path === "/api/v1/weekly-menu/plans") {
          const session = await requireBearerSession(request, input.auth);
          if (method === "GET") {
            const url = new URL(request.url ?? "/", "http://weekly-menu.local");
            status = 200;
            writeJson(
              response,
              status,
              requestId,
              await input.weeklyMenu.list(session.identityId, parsePlanListQuery(url))
            );
            return;
          }
          assertMethod(response, method, "GET");
        }

        if (path === "/api/v1/weekly-menu/plans/generate") {
          assertMethod(response, method, "POST");
          const session = await requireBearerSession(request, input.auth);
          const body = generatePlanInputSchema.parse(await readJsonBody(request));
          status = 201;
          writeJson(
            response,
            status,
            requestId,
            await input.weeklyMenu.generate(session.identityId, body)
          );
          return;
        }

        const planMatch = PLAN_ROUTE.exec(path);
        if (planMatch?.[1]) {
          const planId = parsePlanId(planMatch[1]);
          const suffix = planMatch[2];
          const session = await requireBearerSession(request, input.auth);
          const ownerId = session.identityId;

          if (!suffix && method === "GET") {
            status = 200;
            writeJson(response, status, requestId, await input.weeklyMenu.detail(ownerId, planId));
            return;
          }
          if (!suffix && method === "PUT") {
            const body = draftPlanDtoSchema.parse(await readJsonBody(request));
            status = 200;
            writeJson(response, status, requestId, await input.weeklyMenu.save(ownerId, planId, body));
            return;
          }
          if (!suffix && method === "DELETE") {
            await assertEmptyBody(request);
            await input.weeklyMenu.delete(ownerId, planId);
            status = 204;
            response.writeHead(status, {
              "cache-control": "no-store",
              "x-request-id": requestId
            });
            response.end();
            return;
          }
          if (suffix === "dish") {
            assertMethod(response, method, "PATCH");
            const body = replaceDishInputSchema.parse(await readJsonBody(request));
            status = 200;
            writeJson(response, status, requestId, await input.weeklyMenu.replace(ownerId, planId, body));
            return;
          }
          if (suffix === "confirm") {
            assertMethod(response, method, "POST");
            await assertEmptyBody(request);
            status = 200;
            writeJson(response, status, requestId, await input.weeklyMenu.confirm(ownerId, planId));
            return;
          }
          if (suffix === "copy") {
            assertMethod(response, method, "POST");
            await assertEmptyBody(request);
            status = 201;
            writeJson(response, status, requestId, await input.weeklyMenu.copy(ownerId, planId));
            return;
          }
          if (suffix === "dish-checklist") {
            assertMethod(response, method, "GET");
            status = 200;
            writeJson(
              response,
              status,
              requestId,
              await input.weeklyMenu.dishChecklist(ownerId, planId)
            );
            return;
          }
          response.setHeader("allow", "DELETE, GET, PUT");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
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
