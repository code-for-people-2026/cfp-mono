import Taro from "@tarojs/taro";
import { describe, expect, it, vi } from "vitest";
import {
  WEEK_DAYS,
  WeeklyMenuDomainError,
  confirmDraftPlan,
  generateDraftPlan,
  type DishPools,
  type DraftPlanDto
} from "@cfp/weekly-menu-shared";
import {
  MockClientError,
  RealClientError,
  createMockWeeklyMenuClient,
  createRealWeeklyMenuClient,
  selectWeeklyMenuClient
} from "./weekly-menu-client";

vi.mock("@tarojs/taro", () => ({
  default: {
    getStorageSync: vi.fn(),
    login: vi.fn(),
    removeStorageSync: vi.fn(),
    request: vi.fn(),
    setStorageSync: vi.fn()
  }
}));

const fixedNow = () => new Date("2026-07-31T08:00:00Z");
const fixedRandom = () => 0;
const token = "t".repeat(43);
const expiresAt = "2026-08-30T08:00:00.000Z";
const pools: DishPools = {
  bigMeat: ["红烧肉", "糖醋排骨"],
  smallMeat: ["番茄炒蛋", "青椒肉丝"],
  vegetable: ["清炒时蔬", "蒜蓉西兰花"]
};

function makeDraft(id = "plan-1") {
  return generateDraftPlan(
    { id, weekStart: "2026-07-27", dishPools: pools },
    fixedRandom
  );
}

class FakeApiPlatform {
  readonly requests: Array<{
    data?: unknown;
    header: Record<string, string>;
    method: string;
    timeout: number;
    url: string;
  }> = [];
  readonly storage = new Map<string, unknown>();
  readonly removed: string[] = [];
  code = "wx-code";
  loginError: Error | undefined;
  responses: Array<{ data: unknown; statusCode: number } | Error> = [];

  getStorageSync(key: string): unknown {
    return this.storage.get(key);
  }

  async login(): Promise<{ code: string }> {
    if (this.loginError) throw this.loginError;
    return { code: this.code };
  }

  removeStorageSync(key: string): void {
    this.removed.push(key);
    this.storage.delete(key);
  }

  async request(input: {
    data?: unknown;
    header: Record<string, string>;
    method: string;
    timeout: number;
    url: string;
  }): Promise<{ data: unknown; statusCode: number }> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("missing fake response");
    return response;
  }

  setStorageSync(key: string, value: unknown): void {
    this.storage.set(key, value);
  }
}

describe("Mock Weekly Menu adapter", () => {
  it("覆盖登录、生成、换菜、保存、确认、历史、清单、复制与删除", async () => {
    let sequence = 0;
    const client = createMockWeeklyMenuClient({
      now: fixedNow,
      random: fixedRandom,
      nextId: () => `plan-${(sequence += 1)}`
    });

    expect(await client.restoreSession()).toBeNull();
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "LOGIN_REQUIRED"
    } satisfies Partial<MockClientError>);

    const session = await client.login();
    expect(session).toEqual({ displayName: "学习用户" });
    expect(await client.restoreSession()).toEqual(session);

    const draft = await client.generateDraft();
    expect(draft).toMatchObject({
      id: "plan-1",
      weekStart: "2026-07-27",
      status: "draft"
    });
    expect(draft.days).toHaveLength(WEEK_DAYS.length);
    expect(draft.days.every((day) => day.meals.length === 2)).toBe(true);
    expect(await client.listPlans()).toEqual([draft]);

    const previousDish = draft.days[0]!.meals[0]!.bigMeat;
    const replaced = await client.replaceDraftDish(draft, {
      dayIndex: 0,
      mealIndex: 0,
      slot: "bigMeat"
    });
    expect(replaced.days[0]!.meals[0]!.bigMeat).not.toBe(previousDish);
    expect(await client.getPlan(draft.id)).toEqual(replaced);

    expect(await client.saveDraft(replaced)).toEqual(replaced);
    expect(await client.getPlan(draft.id)).toEqual(replaced);
    expect(await client.listPlans()).toEqual([replaced]);

    const confirmed = await client.confirmDraft(replaced);
    expect(confirmed).toMatchObject({
      id: "plan-1",
      status: "confirmed",
      confirmedAt: "2026-07-31T08:00:00.000Z"
    });
    await expect(client.saveDraft(replaced)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    } satisfies Partial<WeeklyMenuDomainError>);
    await expect(client.confirmDraft(replaced)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    } satisfies Partial<WeeklyMenuDomainError>);
    expect(await client.getPlan(confirmed.id)).toEqual(confirmed);
    const checklist = await client.getDishChecklist(confirmed.id);
    expect(checklist.planId).toBe(confirmed.id);
    expect(checklist.items.length).toBeGreaterThan(0);
    expect(checklist.items[0]).toEqual({ name: expect.any(String) });
    expect(checklist.items[0]).not.toHaveProperty("checked");

    const copied = await client.copyConfirmed(confirmed.id);
    expect(copied).toMatchObject({
      id: "plan-2",
      weekStart: "2026-08-03",
      sourcePlanId: confirmed.id,
      status: "draft"
    });
    expect((await client.listPlans()).map(({ id }) => id)).toEqual([
      "plan-2",
      "plan-1"
    ]);

    await client.deleteDraft(copied.id);
    expect((await client.listPlans()).map(({ id }) => id)).toEqual(["plan-1"]);
    await expect(client.deleteDraft(confirmed.id)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    } satisfies Partial<WeeklyMenuDomainError>);
  });

  it("拒绝未知计划和伪装成 draft 的 confirmed DTO", async () => {
    const client = createMockWeeklyMenuClient({
      now: fixedNow,
      random: fixedRandom,
      nextId: () => "plan-1"
    });
    await client.login();

    await expect(client.getPlan("missing")).rejects.toMatchObject({
      code: "PLAN_NOT_FOUND"
    } satisfies Partial<MockClientError>);

    const draft = await client.generateDraft();
    const confirmed = await client.confirmDraft(draft);
    await expect(
      client.replaceDraftDish(confirmed as unknown as DraftPlanDto, {
        dayIndex: 0,
        mealIndex: 0,
        slot: "vegetable"
      })
    ).rejects.toThrow();
    await expect(
      client.saveDraft(confirmed as unknown as DraftPlanDto)
    ).rejects.toThrow();
    await expect(
      client.replaceDraftDish(draft, {
        dayIndex: 0,
        mealIndex: 0,
        slot: "vegetable"
      })
    ).rejects.toMatchObject({ code: "PLAN_IMMUTABLE" });
  });

  it("默认依赖也能生成唯一的 Mock 草稿", async () => {
    const client = createMockWeeklyMenuClient();
    await client.login();
    const first = await client.generateDraft();
    const second = await client.generateDraft();
    expect(first.id).not.toBe(second.id);
    await client.saveDraft(first);
    await client.saveDraft(second);
    expect(await client.listPlans()).toHaveLength(2);
  });

  it("按设备本地日历计算周一并拒绝未生成的草稿", async () => {
    const client = createMockWeeklyMenuClient({
      now: () => new Date(2026, 7, 3, 0, 30),
      random: fixedRandom,
      nextId: () => "local-monday"
    });
    await client.login();
    await expect(client.generateDraft()).resolves.toMatchObject({
      weekStart: "2026-08-03"
    });

    const fabricated = makeDraft("fabricated");
    await expect(client.saveDraft(fabricated)).rejects.toMatchObject({
      code: "PLAN_NOT_FOUND"
    });
    await expect(client.confirmDraft(fabricated)).rejects.toMatchObject({
      code: "PLAN_NOT_FOUND"
    });
  });
});

describe("Real Weekly Menu API adapter", () => {
  it("uses wx.login, persists only the opaque session and covers the API v1 happy path", async () => {
    const platform = new FakeApiPlatform();
    const draft = makeDraft();
    const confirmed = confirmDraftPlan(
      draft,
      { actorId: "owner-1", ownerId: "owner-1" },
      "2026-07-31T08:00:00Z"
    );
    const copy = { ...draft, id: "plan-2", sourcePlanId: draft.id, weekStart: "2026-08-03" };
    platform.responses.push(
      { statusCode: 201, data: { token, expiresAt } },
      { statusCode: 201, data: draft },
      { statusCode: 200, data: draft },
      { statusCode: 200, data: draft },
      { statusCode: 200, data: confirmed },
      {
        statusCode: 200,
        data: {
          contractVersion: 1,
          items: [confirmed],
          page: { limit: 50, offset: 0, hasMore: false }
        }
      },
      { statusCode: 200, data: confirmed },
      { statusCode: 201, data: copy },
      { statusCode: 204, data: undefined },
      {
        statusCode: 200,
        data: { contractVersion: 1, planId: confirmed.id, items: [{ name: "红烧肉" }] }
      }
    );
    const client = createRealWeeklyMenuClient({
      baseUrl: " https://weekly-menu.example.test/ ",
      now: fixedNow,
      platform
    });

    expect(await client.restoreSession()).toBeNull();
    await expect(client.login()).resolves.toEqual({
      displayName: "微信用户"
    });
    expect([...platform.storage.values()]).toEqual([{ token, expiresAt }]);
    expect(JSON.stringify([...platform.storage.values()])).not.toContain("wx-code");
    expect(await client.restoreSession()).toEqual({
      displayName: "微信用户"
    });

    await expect(client.generateDraft()).resolves.toEqual(draft);
    await expect(
      client.replaceDraftDish(draft, { dayIndex: 0, mealIndex: 0, slot: "bigMeat" })
    ).resolves.toEqual(draft);
    await expect(client.saveDraft(draft)).resolves.toEqual(draft);
    await expect(client.confirmDraft(draft)).resolves.toEqual(confirmed);
    await expect(client.listPlans()).resolves.toEqual([confirmed]);
    await expect(client.getPlan(draft.id)).resolves.toEqual(confirmed);
    await expect(client.copyConfirmed(draft.id)).resolves.toEqual(copy);
    await expect(client.deleteDraft(copy.id)).resolves.toBeUndefined();
    await expect(client.getDishChecklist(confirmed.id)).resolves.toMatchObject({
      planId: confirmed.id,
      items: [{ name: "红烧肉" }]
    });

    expect(platform.requests[0]).toMatchObject({
      method: "POST",
      timeout: 5_000,
      url: "https://weekly-menu.example.test/api/v1/auth/wechat",
      data: { code: "wx-code" },
      header: { accept: "application/json", "content-type": "application/json" }
    });
    expect(platform.requests[1]).toMatchObject({
      url: "https://weekly-menu.example.test/api/v1/weekly-menu/plans/generate",
      data: { weekStart: "2026-07-27" },
      header: { authorization: `Bearer ${token}` }
    });
    const noBodyRequests = platform.requests.filter(({ url }) =>
      /\/(confirm|copy)$/.test(url)
    );
    expect(noBodyRequests).toHaveLength(2);
    expect(noBodyRequests.every((request) => !("data" in request))).toBe(true);
    expect(platform.requests.find(({ method }) => method === "DELETE")).not.toHaveProperty("data");
  });

  it("clears malformed or expired local sessions and keeps Mock as the default", async () => {
    const platform = new FakeApiPlatform();
    const client = createRealWeeklyMenuClient({
      baseUrl: "https://weekly-menu.example.test",
      now: fixedNow,
      platform
    });
    for (const invalid of [
      "not-an-object",
      { token: "short", expiresAt },
      { token, expiresAt: "invalid" },
      { token, expiresAt: 123 },
      { token, expiresAt: "2026-07-30T00:00:00Z" },
      { token, expiresAt, extra: true }
    ]) {
      platform.storage.set("weekly-menu:api-session", invalid);
      await expect(client.restoreSession()).resolves.toBeNull();
      expect(platform.storage.size).toBe(0);
    }

    expect(selectWeeklyMenuClient()).toMatchObject({ mode: "mock" });
    expect(
      selectWeeklyMenuClient({
        baseUrl: "https://weekly-menu.example.test",
        realOptions: { now: fixedNow, platform }
      })
    ).toMatchObject({ mode: "real" });
    expect(() => createRealWeeklyMenuClient({ baseUrl: "http://unsafe.test" })).toThrowError(
      expect.objectContaining({ code: "CONFIG_REQUIRED" })
    );
    for (const unsafe of [
      "https://token@weekly-menu.example.test",
      "https://user:password@weekly-menu.example.test",
      "https://weekly-menu.example.test/api",
      "https://weekly-menu.example.test?token=secret"
    ]) {
      expect(() => createRealWeeklyMenuClient({ baseUrl: unsafe })).toThrowError(
        expect.objectContaining({ code: "CONFIG_REQUIRED" })
      );
    }
  });

  it("clears a rejected Bearer session and returns only recoverable redacted errors", async () => {
    const platform = new FakeApiPlatform();
    const client = createRealWeeklyMenuClient({
      baseUrl: "https://weekly-menu.example.test",
      now: fixedNow,
      platform
    });
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "SESSION_REQUIRED",
      message: "登录已失效，请重新登录"
    } satisfies Partial<RealClientError>);

    platform.storage.set("weekly-menu:api-session", { token, expiresAt });
    platform.responses.push({ statusCode: 401, data: { secret: "must-not-leak" } });
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
      message: "登录已失效，请重新登录"
    } satisfies Partial<RealClientError>);
    expect(platform.storage.size).toBe(0);

    platform.storage.set("weekly-menu:api-session", { token, expiresAt });
    platform.responses.push(
      { statusCode: 409, data: { error: { code: "PLAN_IMMUTABLE", message: "private" } } },
      { statusCode: 500, data: { error: { code: "unsafe-code", message: "database secret" } } },
      { statusCode: 500, data: null },
      { statusCode: 500, data: { error: "invalid" } },
      { statusCode: 199, data: {} },
      new Error("https://private-host/token")
    );
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      backendCode: "PLAN_IMMUTABLE",
      message: "服务暂时不可用，请稍后重试"
    } satisfies Partial<RealClientError>);
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      backendCode: undefined
    } satisfies Partial<RealClientError>);
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      backendCode: undefined
    } satisfies Partial<RealClientError>);
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      backendCode: undefined
    } satisfies Partial<RealClientError>);
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      backendCode: undefined
    } satisfies Partial<RealClientError>);
    const networkError = await client.generateDraft().catch((error: unknown) => error);
    expect(networkError).toMatchObject({ code: "API_UNAVAILABLE" });
    expect(JSON.stringify(networkError)).not.toContain("private-host");
  });

  it("follows shared pagination and rejects invalid continuation metadata", async () => {
    const platform = new FakeApiPlatform();
    platform.storage.set("weekly-menu:api-session", { token, expiresAt });
    const first = makeDraft("plan-1");
    const second = makeDraft("plan-2");
    platform.responses.push(
      {
        statusCode: 200,
        data: {
          contractVersion: 1,
          items: [first],
          page: { limit: 50, offset: 0, hasMore: true }
        }
      },
      {
        statusCode: 200,
        data: {
          contractVersion: 1,
          items: [second],
          page: { limit: 50, offset: 50, hasMore: false }
        }
      },
      {
        statusCode: 200,
        data: {
          contractVersion: 1,
          items: [],
          page: { limit: 50, offset: 0, hasMore: true }
        }
      },
      {
        statusCode: 200,
        data: {
          contractVersion: 1,
          items: [first],
          page: { limit: 50, offset: 1, hasMore: true }
        }
      },
      {
        statusCode: 200,
        data: {
          contractVersion: 1,
          items: [first],
          page: { limit: 49, offset: 0, hasMore: true }
        }
      }
    );
    const client = createRealWeeklyMenuClient({
      baseUrl: "https://weekly-menu.example.test",
      now: fixedNow,
      platform
    });

    await expect(client.listPlans()).resolves.toEqual([first, second]);
    expect(platform.requests.slice(0, 2).map(({ url }) => url)).toEqual([
      "https://weekly-menu.example.test/api/v1/weekly-menu/plans?limit=50&offset=0",
      "https://weekly-menu.example.test/api/v1/weekly-menu/plans?limit=50&offset=50"
    ]);
    await expect(client.listPlans()).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    await expect(client.listPlans()).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    await expect(client.listPlans()).rejects.toMatchObject({ code: "REQUEST_FAILED" });

    for (let offset = 0; offset <= 10_000; offset += 50) {
      platform.responses.push({
        statusCode: 200,
        data: {
          contractVersion: 1,
          items: [first],
          page: { limit: 50, offset, hasMore: true }
        }
      });
    }
    await expect(client.listPlans()).rejects.toMatchObject({ code: "REQUEST_FAILED" });
  });

  it("redacts wx.login, code and malformed auth response failures", async () => {
    const platform = new FakeApiPlatform();
    const client = createRealWeeklyMenuClient({
      baseUrl: "https://weekly-menu.example.test",
      now: fixedNow,
      platform
    });

    platform.code = " ";
    await expect(client.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    platform.code = "x".repeat(257);
    await expect(client.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    platform.loginError = new Error("wx secret details");
    await expect(client.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    platform.loginError = undefined;
    platform.code = "one-time-code";
    platform.responses.push(
      { statusCode: 201, data: { token, expiresAt: "2026-07-30T00:00:00Z" } },
      { statusCode: 201, data: { token: "invalid", expiresAt } }
    );
    await expect(client.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    const error = await client.login().catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "LOGIN_FAILED", message: "微信登录失败，请重试" });
    expect(JSON.stringify(error)).not.toContain("one-time-code");
  });

  it("adapts the real Taro primitives without exposing them to page code", async () => {
    vi.clearAllMocks();
    vi.mocked(Taro.getStorageSync).mockReturnValue({ token, expiresAt });
    vi.mocked(Taro.login).mockResolvedValue({ code: "wx-code", errMsg: "login:ok" });
    vi.mocked(Taro.request)
      .mockResolvedValueOnce({
        statusCode: 201,
        data: { token, expiresAt },
        header: {},
        cookies: [],
        errMsg: "request:ok"
      })
      .mockResolvedValueOnce({
        statusCode: 401,
        data: {},
        header: {},
        cookies: [],
        errMsg: "request:ok"
      });
    const client = createRealWeeklyMenuClient({
      baseUrl: "https://weekly-menu.example.test"
    });

    await expect(client.restoreSession()).resolves.toMatchObject({ displayName: "微信用户" });
    await expect(client.login()).resolves.toMatchObject({ displayName: "微信用户" });
    expect(Taro.setStorageSync).toHaveBeenCalledWith("weekly-menu:api-session", {
      token,
      expiresAt
    });
    await expect(client.generateDraft()).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(Taro.removeStorageSync).toHaveBeenCalledWith("weekly-menu:api-session");
  });
});
