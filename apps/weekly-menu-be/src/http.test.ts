import type { AddressInfo } from "node:net";
import {
  WeeklyMenuDomainError,
  confirmDraftPlan,
  generateDraftPlan,
  type DishPools
} from "@cfp/weekly-menu-shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, type AuthenticatedSession } from "./auth";
import { createWeeklyMenuHttpServer, type SafeLogEvent } from "./http";
import { WeeklyMenuApiError } from "./weekly-menu-service";

const token = "t".repeat(43);
const activeSession: AuthenticatedSession = {
  id: "session-1",
  identityId: "owner-1",
  expiresAt: "2026-09-01T00:00:00.000Z"
};
const servers: ReturnType<typeof createWeeklyMenuHttpServer>[] = [];
const pools: DishPools = {
  bigMeat: ["红烧肉", "糖醋排骨"],
  smallMeat: ["番茄炒蛋", "青椒肉丝"],
  vegetable: ["清炒时蔬", "蒜蓉西兰花"]
};

function makeDraft(id = "plan-1") {
  return generateDraftPlan(
    { id, weekStart: "2026-08-03", dishPools: pools },
    () => 0
  );
}

type ServerInput = Parameters<typeof createWeeklyMenuHttpServer>[0];

async function start(input: Omit<ServerInput, "weeklyMenu"> & { weeklyMenu?: ServerInput["weeklyMenu"] }) {
  const server = createWeeklyMenuHttpServer({
    ...input,
    weeklyMenu: input.weeklyMenu ?? fakeWeeklyMenu()
  });
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

function fakeWeeklyMenu(): ServerInput["weeklyMenu"] {
  return {
    bootstrap: vi.fn(),
    confirm: vi.fn(),
    copy: vi.fn(),
    delete: vi.fn(),
    detail: vi.fn(),
    dishChecklist: vi.fn(),
    generate: vi.fn(),
    list: vi.fn(),
    replace: vi.fn(),
    save: vi.fn()
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

  it("serves the authenticated plan happy path with versioned DTOs", async () => {
    const draft = makeDraft();
    const confirmed = confirmDraftPlan(
      draft,
      { actorId: "owner-1", ownerId: "owner-1" },
      "2026-08-01T08:00:00Z"
    );
    const weeklyMenu = fakeWeeklyMenu();
    vi.mocked(weeklyMenu.bootstrap).mockResolvedValue({ contractVersion: 1, latestDraft: draft });
    vi.mocked(weeklyMenu.generate).mockResolvedValue(draft);
    vi.mocked(weeklyMenu.save).mockResolvedValue(draft);
    vi.mocked(weeklyMenu.detail).mockResolvedValue(draft);
    vi.mocked(weeklyMenu.replace).mockResolvedValue(draft);
    vi.mocked(weeklyMenu.confirm).mockResolvedValue(confirmed);
    vi.mocked(weeklyMenu.list).mockResolvedValue({
      contractVersion: 1,
      items: [draft],
      page: { limit: 10, offset: 0, hasMore: false }
    });
    vi.mocked(weeklyMenu.copy).mockResolvedValue({ ...draft, id: "copy-1", sourcePlanId: draft.id });
    vi.mocked(weeklyMenu.dishChecklist).mockResolvedValue({
      contractVersion: 1,
      planId: draft.id,
      items: [{ name: "红烧肉" }]
    });
    const logger = vi.fn();
    const baseUrl = await start({
      auth: fakeAuth(),
      readiness: vi.fn(),
      release: "development",
      weeklyMenu,
      logger
    });
    const authHeaders = { authorization: `Bearer ${token}` };

    expect((await fetch(`${baseUrl}/api/v1/weekly-menu/bootstrap`, { headers: authHeaders })).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans/generate`, {
          method: "POST",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify({ weekStart: "2026-08-03" })
        })
      ).status
    ).toBe(201);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans/${draft.id}`, {
          method: "PUT",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify(draft)
        })
      ).status
    ).toBe(200);
    expect((await fetch(`${baseUrl}/api/v1/weekly-menu/plans/${draft.id}`, { headers: authHeaders })).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans/${draft.id}/dish`, {
          method: "PATCH",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify({ dayIndex: 0, mealIndex: 0, slot: "bigMeat" })
        })
      ).status
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans/${draft.id}/confirm`, {
          method: "POST",
          headers: authHeaders
        })
      ).status
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans?limit=10&offset=0`, {
          headers: authHeaders
        })
      ).status
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans/${draft.id}/copy`, {
          method: "POST",
          headers: authHeaders
        })
      ).status
    ).toBe(201);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans/${draft.id}/dish-checklist`, {
          headers: authHeaders
        })
      ).status
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/weekly-menu/plans/${draft.id}`, {
          method: "DELETE",
          headers: authHeaders
        })
      ).status
    ).toBe(204);

    expect(weeklyMenu.generate).toHaveBeenCalledWith("owner-1", { weekStart: "2026-08-03" });
    expect(weeklyMenu.list).toHaveBeenCalledWith("owner-1", { limit: 10, offset: 0 });
    expect(weeklyMenu.copy).toHaveBeenCalledWith("owner-1", draft.id);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/api/v1/weekly-menu/plans/:id", status: 200 })
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain(draft.id);
  });

  it("validates plan path, body and pagination before application calls", async () => {
    const weeklyMenu = fakeWeeklyMenu();
    const baseUrl = await start({
      auth: fakeAuth(),
      readiness: vi.fn(),
      release: "development",
      weeklyMenu,
      logger: vi.fn()
    });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const invalidRequests = [
      fetch(`${baseUrl}/api/v1/weekly-menu/plans?limit=0`, { headers }),
      fetch(`${baseUrl}/api/v1/weekly-menu/plans?limit=10&limit=20`, { headers }),
      fetch(`${baseUrl}/api/v1/weekly-menu/plans/%20`, { headers }),
      fetch(`${baseUrl}/api/v1/weekly-menu/plans/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ weekStart: "2026/08/03", extra: true })
      }),
      fetch(`${baseUrl}/api/v1/weekly-menu/plans/plan-1/dish`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ dayIndex: 7, mealIndex: 0, slot: "bigMeat" })
      }),
      fetch(`${baseUrl}/api/v1/weekly-menu/plans/plan-1/copy`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "generate", weekStart: "2026-08-10" })
      }),
      fetch(`${baseUrl}/api/v1/weekly-menu/plans/plan-1/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ unexpected: true })
      }),
      fetch(`${baseUrl}/api/v1/weekly-menu/plans/plan-1`, {
        method: "DELETE",
        headers,
        body: "x".repeat(17_000)
      })
    ];
    for (const response of await Promise.all(invalidRequests)) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({ code: "INVALID_REQUEST" })
      });
    }
    expect(weeklyMenu.generate).not.toHaveBeenCalled();
    expect(weeklyMenu.replace).not.toHaveBeenCalled();
    expect(weeklyMenu.copy).not.toHaveBeenCalled();
    expect(weeklyMenu.confirm).not.toHaveBeenCalled();
    expect(weeklyMenu.delete).not.toHaveBeenCalled();
    expect(weeklyMenu.list).not.toHaveBeenCalled();

    const reserved = await fetch(`${baseUrl}/api/v1/weekly-menu/plans/generate`, {
      headers
    });
    expect(reserved.status).toBe(405);
    expect(weeklyMenu.detail).not.toHaveBeenCalled();
  });

  it("maps missing, immutable and rate-limited plans to stable redacted errors", async () => {
    const weeklyMenu = fakeWeeklyMenu();
    vi.mocked(weeklyMenu.detail).mockRejectedValue(new WeeklyMenuApiError("PLAN_NOT_FOUND"));
    vi.mocked(weeklyMenu.generate).mockRejectedValue(new WeeklyMenuApiError("RATE_LIMITED"));
    vi.mocked(weeklyMenu.confirm).mockRejectedValue(
      new WeeklyMenuDomainError("PLAN_IMMUTABLE")
    );
    const baseUrl = await start({
      auth: fakeAuth(),
      readiness: vi.fn(),
      release: "development",
      weeklyMenu,
      requestId: () => "request-api",
      logger: vi.fn()
    });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const missing = await fetch(`${baseUrl}/api/v1/weekly-menu/plans/private-plan`, { headers });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "PLAN_NOT_FOUND", message: "Plan not found", requestId: "request-api" }
    });
    const limited = await fetch(`${baseUrl}/api/v1/weekly-menu/plans/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ weekStart: "2026-08-03" })
    });
    expect(limited.status).toBe(429);
    expect(JSON.stringify(await limited.json())).not.toContain("owner-1");
    const immutable = await fetch(
      `${baseUrl}/api/v1/weekly-menu/plans/private-plan/confirm`,
      { method: "POST", headers }
    );
    expect(immutable.status).toBe(409);
    expect(await immutable.json()).toEqual({
      error: {
        code: "PLAN_IMMUTABLE",
        message: "Plan operation is not allowed",
        requestId: "request-api"
      }
    });
  });
});
