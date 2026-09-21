import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorResponseSchema, SessionSchema } from "@cfp/kith-inn-contracts";
import { ApiError } from "./auth";
import { createKithInnHttpServer } from "./http";

describe("HTTP boundary on a real socket", () => {
  const token = "a".repeat(43), authorization = `Bearer ${token}`;
  const session = { merchantId: "owner", tokenHash: Buffer.alloc(32) };
  const logger = vi.fn(), readiness = vi.fn(async () => {});
  const sessions = {
    login: vi.fn(async () => ({ token, expiresAt: new Date(Date.now() + 60_000).toISOString() })),
    authenticate: vi.fn(async () => session), revoke: vi.fn(async () => {})
  };
  let server: Server, port: number, now: number;
  beforeEach(async () => {
    vi.clearAllMocks();
    readiness.mockResolvedValue();
    now = Date.now();
    server = createKithInnHttpServer({ sessions, readiness, logger, clock: () => now });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const call = (path: string, method = "GET", body?: string | Buffer,
    headers: Record<string, string | string[]> = {}) => new Promise<{
      status: number; headers: Record<string, unknown>; body: unknown;
    }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port,
      path: path.startsWith("http:") ? path : `/api/kith-inn${path}`, method,
      headers: { ...(body === undefined ? {} : { "content-length": Buffer.byteLength(body) }), ...headers }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined }));
    });
    request.on("error", reject);
    request.end(body);
  });

  it("returns contract sessions, no-store/request IDs and scoped logout", async () => {
    const login = await call("/sessions/wechat", "POST", '{"code":"private-code"}', {
      "content-type": "application/json", "x-request-id": "attacker-value"
    });
    expect(login.status).toBe(201);
    expect(SessionSchema.safeParse(login.body).success).toBe(true);
    expect(login.headers["cache-control"]).toBe("no-store");
    expect(login.headers["x-request-id"]).not.toBe("attacker-value");
    expect((await call("/sessions/current", "DELETE", undefined, { authorization })).status).toBe(204);
    expect(sessions.revoke).toHaveBeenCalledWith(session);
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/private-code|attacker-value|Bearer/);
    expect(logger.mock.calls[0]?.[0]).toMatchObject({ method: "POST", route: "/sessions/wechat", status: 201 });
  });
  it.each([
    ["/sessions/wechat", "POST", '{"code":"c","merchantId":"forged"}', "application/json"],
    ["/sessions/wechat", "POST", "{", "application/json"],
    ["/sessions/wechat", "POST", '{"code":"c"}', "text/plain"],
    ["/sessions/wechat?x=1&x=2", "POST", '{"code":"c"}', "application/json"],
    ["/health", "GET", "{}", "application/json"],
    ["/sessions/current", "DELETE", "{}", "application/json"]
  ])("rejects non-contract request %s %s", async (path, method, body, contentType) => {
    const response = await call(path!, method, body, { authorization, "content-type": contentType! });
    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(response.body).error.code).toBe("INVALID_REQUEST");
  });
  it("rejects invalid UTF8, oversized bodies and duplicate credentials", async () => {
    expect((await call("/sessions/wechat", "POST", Buffer.from([0xff]), { "content-type": "application/json" })).status).toBe(400);
    expect((await call("/sessions/wechat", "POST", "x".repeat(128 * 1024 + 1))).status).toBe(413);
    expect((await call("/sessions/current", "DELETE", undefined, { authorization: [authorization, authorization] })).status).toBe(400);
  });
  it("returns a contract validation error for a malformed absolute request target", async () => {
    const response = await call("http://[");
    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(response.body).error.code).toBe("INVALID_REQUEST");
  });
  it("guards unknown business requests and masks dependency failures and paths in logs", async () => {
    expect((await call("/dishes")).status).toBe(401);
    expect((await call("/private-openid", "GET", undefined, { authorization })).status).toBe(404);
    readiness.mockRejectedValue(new Error("secret database URL"));
    const failed = await call("/ready");
    expect(failed.status).toBe(503);
    expect(JSON.stringify([failed.body, logger.mock.calls])).not.toMatch(/secret database|private-openid/);
    sessions.login.mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "没有权限"));
    expect((await call("/sessions/wechat", "POST", '{"code":"c"}', { "content-type": "application/json" })).status).toBe(403);
  });
  it("limits login by socket IP despite spoofed forwarding and resets after one minute", async () => {
    for (let index = 0; index < 20; index++) {
      expect((await call("/sessions/wechat", "POST", "{}", {
        "content-type": "application/json", "x-forwarded-for": `192.0.2.${index}`
      })).status).toBe(400);
    }
    const limited = await call("/sessions/wechat", "POST", "{}");
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    now += 60_000;
    expect((await call("/sessions/wechat", "POST", "{}")).status).toBe(400);
  });
  it("shares the 120/minute budget between sessions of one merchant", async () => {
    for (let index = 0; index < 120; index++) {
      expect((await call("/dishes", "GET", undefined, { authorization: `Bearer ${index % 2 ? token : "b".repeat(43)}` })).status).toBe(404);
    }
    expect((await call("/dishes", "GET", undefined, { authorization })).status).toBe(429);
  });
});
