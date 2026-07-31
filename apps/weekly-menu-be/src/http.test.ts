import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, type AuthenticatedSession } from "./auth";
import { createWeeklyMenuHttpServer, type SafeLogEvent } from "./http";

const token = "t".repeat(43);
const activeSession: AuthenticatedSession = {
  id: "session-1",
  identityId: "owner-1",
  expiresAt: "2026-09-01T00:00:00.000Z"
};
const servers: ReturnType<typeof createWeeklyMenuHttpServer>[] = [];

async function start(input: Parameters<typeof createWeeklyMenuHttpServer>[0]) {
  const server = createWeeklyMenuHttpServer(input);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function fakeAuth() {
  return {
    authenticate: vi.fn().mockResolvedValue(activeSession),
    login: vi.fn().mockResolvedValue({
      token,
      expiresAt: activeSession.expiresAt
    }),
    revoke: vi.fn().mockResolvedValue(undefined)
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

describe("Weekly Menu HTTP runtime", () => {
  it("serves liveness and readiness without internal dependency details", async () => {
    const events: SafeLogEvent[] = [];
    const baseUrl = await start({
      auth: fakeAuth(),
      readiness: vi.fn().mockResolvedValue(undefined),
      release: "abcdef123456",
      requestId: () => "request-1",
      logger: (event) => events.push(event)
    });

    const health = await fetch(`${baseUrl}/api/health`);
    expect(await health.json()).toEqual({ status: "ok", release: "abcdef123456" });
    expect(health.headers.get("x-request-id")).toBe("request-1");
    const ready = await fetch(`${baseUrl}/api/ready`);
    expect(await ready.json()).toEqual({ status: "ready" });
    expect(events).toEqual([
      expect.objectContaining({ event: "http_request", path: "/api/health", status: 200 }),
      expect.objectContaining({ event: "http_request", path: "/api/ready", status: 200 })
    ]);
  });

  it("maps readiness and unknown failures to stable redacted errors", async () => {
    const events: SafeLogEvent[] = [];
    const baseUrl = await start({
      auth: fakeAuth(),
      readiness: vi.fn().mockRejectedValue(
        new Error("postgresql://user:password@private-host/weekly_menu")
      ),
      release: "development",
      requestId: () => "request-safe",
      logger: (event) => events.push(event)
    });

    const response = await fetch(`${baseUrl}/api/ready`);
    expect(response.status).toBe(503);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("SERVICE_NOT_READY");
    expect(serialized).not.toContain("password");
    expect(JSON.stringify(events)).not.toContain("private-host");
  });

  it("logs in, authenticates Bearer tokens and revokes the current session", async () => {
    const auth = fakeAuth();
    const logger = vi.fn();
    const baseUrl = await start({
      auth,
      readiness: vi.fn(),
      release: "development",
      logger
    });

    const login = await fetch(`${baseUrl}/api/v1/auth/wechat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "code-sensitive" })
    });
    expect(login.status).toBe(201);
    expect(await login.json()).toEqual({ token, expiresAt: activeSession.expiresAt });
    expect(auth.login).toHaveBeenCalledWith("code-sensitive");

    const logout = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(logout.status).toBe(204);
    expect(auth.authenticate).toHaveBeenCalledWith(token);
    expect(auth.revoke).toHaveBeenCalledWith(activeSession);
    const logs = JSON.stringify(logger.mock.calls);
    expect(logs).not.toContain("code-sensitive");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("owner-1");
  });

  it("returns one 401 contract for absent, malformed, expired or revoked tokens", async () => {
    const auth = fakeAuth();
    auth.authenticate.mockRejectedValue(new AuthenticationError("INVALID_TOKEN"));
    const baseUrl = await start({
      auth,
      readiness: vi.fn(),
      release: "development",
      requestId: () => "request-auth",
      logger: vi.fn()
    });

    for (const authorization of [undefined, "Bearer malformed", `Bearer ${token}`]) {
      const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: "DELETE",
        headers: authorization ? { authorization } : undefined
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication is required",
          requestId: "request-auth"
        }
      });
    }
  });

  it("rejects invalid and oversized bodies before calling WeChat", async () => {
    const auth = fakeAuth();
    const baseUrl = await start({
      auth,
      readiness: vi.fn(),
      release: "development",
      logger: vi.fn()
    });

    const invalid = await fetch(`${baseUrl}/api/v1/auth/wechat`, {
      method: "POST",
      body: JSON.stringify({ code: "", extra: "not-allowed" })
    });
    expect(invalid.status).toBe(400);
    const oversized = await fetch(`${baseUrl}/api/v1/auth/wechat`, {
      method: "POST",
      body: JSON.stringify({ code: "x".repeat(17_000) })
    });
    expect(oversized.status).toBe(413);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("returns stable method and route errors", async () => {
    const logger = vi.fn();
    const baseUrl = await start({
      auth: fakeAuth(),
      readiness: vi.fn(),
      release: "development",
      logger
    });
    const method = await fetch(`${baseUrl}/api/health`, { method: "POST" });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
    const missing = await fetch(
      `${baseUrl}/api/v1/weekly-menu/code-sensitive/token-sensitive`
    );
    expect(missing.status).toBe(404);
    expect(logger).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "<unmatched>", status: 404 })
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain("code-sensitive");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("token-sensitive");
  });
});
