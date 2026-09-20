import Taro from "@tarojs/taro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientError, createKithInnClient, taroPlatform, type ApiPlatform } from "./api";

vi.mock("@tarojs/taro", () => ({ default: {
  login: vi.fn(), request: vi.fn(), getUserCryptoManager: vi.fn(),
  getStorageSync: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn()
} }));
const origin = "https://kith.example.test";
const storageKey = `kith-inn:session:v1:${origin}`;
const now = Date.parse("2026-09-21T00:00:00Z");
const session = { token: "t".repeat(43), expiresAt: new Date(now + 30 * 86400000).toISOString() };
const dish = { id: "11111111-1111-4111-8111-111111111111", name: "菜心", category: "vegetable" as const,
  active: true, version: 1, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
const batch = () => ({ items: [{ name: dish.name, category: dish.category }] });
const update = { name: dish.name, category: dish.category, active: false, baseVersion: 1 };
const failure = (statusCode: number, code: string, details?: unknown) => ({ statusCode,
  data: { error: { code, message: "server-private-text", requestId: dish.id, ...(details ? { details } : {}) } } });

function fixture() {
  let time = now, sequence = 0;
  const storage = new Map<string, unknown>([[storageKey, session]]);
  const platform = {
    login: vi.fn(async () => ({ code: "one-use-code", errMsg: "login:ok" })),
    randomBytes: vi.fn(async () => new Uint8Array(16).fill(++sequence)),
    request: vi.fn<Parameters<ApiPlatform["request"]>, ReturnType<ApiPlatform["request"]>>(),
    getStorageSync: vi.fn((key: string) => storage.get(key)),
    setStorageSync: vi.fn((key: string, value: unknown) => { storage.set(key, value); }),
    removeStorageSync: vi.fn((key: string) => { storage.delete(key); })
  };
  const client = createKithInnClient({ baseUrl: origin, platform, now: () => time });
  return { client, platform, storage, advance: (ms: number) => { time += ms; } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Kith Inn session and transport", () => {
  it("requires an HTTPS origin without credentials, paths, queries or invalid ports", () => {
    vi.stubEnv("TARO_APP_KITH_INN_API_BASE_URL", "");
    delete process.env.TARO_APP_KITH_INN_API_BASE_URL;
    expect(() => createKithInnClient()).toThrow(expect.objectContaining({ code: "CONFIG_REQUIRED" }));
    for (const baseUrl of ["", "http://localhost", "https://token@host", "https://host/path", "https://host?key=x", "https://host..test", "https://host:99999", "https://host:0"]) {
      expect(() => createKithInnClient({ baseUrl })).toThrow(expect.objectContaining({ code: "CONFIG_REQUIRED" }));
    }
    vi.stubEnv("TARO_APP_KITH_INN_API_BASE_URL", origin);
    expect(createKithInnClient().pendingWrite()).toBeNull();
    expect(createKithInnClient({ baseUrl: ` ${origin}/ ` }).pendingWrite()).toBeNull();
  });
  it("restores only valid opaque sessions, expires them and isolates service origins", () => {
    const f = fixture();
    expect(f.client.restoreSession()).toBe(true);
    f.advance(30 * 86400000);
    expect(f.client.restoreSession()).toBe(false);
    for (const value of [null, "invalid", { ...session, extra: true }, { ...session, expiresAt: "invalid" }]) {
      const f = fixture(); f.storage.set(storageKey, value);
      expect(f.client.restoreSession()).toBe(false);
      expect(f.storage.size).toBe(0);
    }
    const broken = fixture();
    broken.platform.getStorageSync.mockImplementation(() => { throw Error("private storage"); });
    broken.platform.removeStorageSync.mockImplementation(() => { throw Error("private storage"); });
    expect(broken.client.restoreSession()).toBe(false);
    const other = createKithInnClient({ baseUrl: "https://other.example.test", platform: fixture().platform });
    expect(other.restoreSession()).toBe(false);
  });
  it("accepts real login metadata, stores only the contract session and revokes without a body", async () => {
    const { client, platform, storage } = fixture();
    platform.request.mockResolvedValueOnce({ statusCode: 201, data: session }).mockResolvedValueOnce({ statusCode: 204, data: null });
    await client.login();
    expect(platform.request.mock.calls[0]![0]).toMatchObject({ method: "POST", timeout: 10000,
      url: `${origin}/api/kith-inn/sessions/wechat`, data: JSON.stringify({ code: "one-use-code" }) });
    expect(platform.request.mock.calls[0]![0].header.authorization).toBeUndefined();
    expect(storage.get(storageKey)).toEqual(session);
    await client.logout();
    expect(platform.request.mock.calls[1]![0].data).toBeUndefined();
    expect(storage.size).toBe(0);
  });
  it("redacts denied identities, rejects malformed login responses and storage failures", async () => {
    const { client, platform } = fixture();
    platform.request.mockResolvedValueOnce({ statusCode: 403, data: { private: "openid" } });
    await expect(client.login()).rejects.toMatchObject({ code: "FORBIDDEN", details: undefined });
    expect(client.restoreSession()).toBe(false);
    platform.login.mockRejectedValueOnce(Error("secret code"));
    await expect(client.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    platform.request.mockResolvedValueOnce({ statusCode: 201, data: { token: "bad" } });
    await expect(client.login()).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    platform.request.mockResolvedValueOnce({ statusCode: 201, data: session });
    platform.setStorageSync.mockImplementationOnce(() => { throw Error("disk"); });
    await expect(client.login()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    expect(client.restoreSession()).toBe(false);
    await client.logout();
  });
  it("preserves explicit unsupported login and rejects unconfirmed logout responses", async () => {
    const { client, platform } = fixture();
    platform.login.mockRejectedValueOnce(new ClientError("WECHAT_REQUIRED"));
    await expect(client.login()).rejects.toMatchObject({ code: "WECHAT_REQUIRED" });
    platform.request.mockResolvedValueOnce({ statusCode: 201, data: session }).mockResolvedValueOnce({ statusCode: 200, data: {} });
    await client.login();
    await expect(client.logout()).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
    expect(client.restoreSession()).toBe(false);
  });
  it("validates inputs and complete dish responses and sends versioned updates", async () => {
    const { client, platform } = fixture();
    await expect(client.addDishes({ items: [] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(client.updateDish("bad", update)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    platform.request.mockResolvedValueOnce({ statusCode: 200, data: { items: [dish] } })
      .mockResolvedValueOnce({ statusCode: 201, data: { items: [dish] } })
      .mockResolvedValueOnce({ statusCode: 200, data: { ...dish, active: false, version: 2 } });
    expect(await client.getDishes()).toEqual([dish]);
    expect(await client.addDishes(batch())).toEqual({ kind: "batch", items: [dish] });
    expect(await client.updateDish(dish.id, update)).toMatchObject({ kind: "update", dish: { active: false, version: 2 } });
    const sent = platform.request.mock.calls[2]![0];
    expect(sent).toMatchObject({ method: "PATCH", timeout: 10000 });
    expect(JSON.parse(sent.data!)).toEqual(update);
    expect(sent.header["Idempotency-Key"]).toBe("02020202-0202-4202-8202-020202020202");
    expect(client.pendingWrite()).toBeNull();
    platform.request.mockResolvedValueOnce({ statusCode: 200, data: { items: [{ private: true }] } });
    await expect(client.getDishes()).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
  });
});

describe("write outcomes and safe retries", () => {
  it.each([
    { statusCode: 201, data: { items: [] } }, { statusCode: 200, data: { items: [dish] } },
    { statusCode: 500, data: "bad gateway" }, failure(500, "INTERNAL_ERROR")
  ])("retains the immutable request after uncertain response %#", async (response) => {
    const { client, platform } = fixture();
    platform.request.mockResolvedValueOnce(response).mockResolvedValueOnce({ statusCode: 201, data: { items: [dish] } });
    const input = batch();
    await expect(client.addDishes(input)).rejects.toBeDefined();
    input.items[0]!.name = "changed after submission";
    await expect(client.addDishes(input)).rejects.toMatchObject({ code: "PENDING_WRITE" });
    expect(client.pendingWrite()?.state).toBe("unknown");
    await client.retryPendingWrite();
    expect(platform.request.mock.calls[1]![0]).toEqual(platform.request.mock.calls[0]![0]);
    expect(client.pendingWrite()).toBeNull();
  });
  it("returns duplicate/version details, permits corrected writes and resets rejected retry state", async () => {
    const { client, platform } = fixture();
    platform.request.mockResolvedValueOnce(failure(409, "DUPLICATE_DISH_NAME", { names: [dish.name] }))
      .mockResolvedValueOnce(failure(409, "VERSION_CONFLICT", { currentVersion: 2 }))
      .mockRejectedValueOnce(Error("network private"));
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "DUPLICATE_DISH_NAME", details: { names: [dish.name] } });
    expect(client.pendingWrite()?.state).toBe("rejected");
    await expect(client.updateDish(dish.id, update)).rejects.toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: 2 } });
    expect(platform.request.mock.calls[0]![0].header["Idempotency-Key"]).not.toBe(platform.request.mock.calls[1]![0].header["Idempotency-Key"]);
    await expect(client.retryPendingWrite()).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
    expect(client.pendingWrite()?.state).toBe("unknown");
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "PENDING_WRITE" });
  });
  it("honors Retry-After before replaying the same key and body", async () => {
    const { client, platform, advance } = fixture();
    platform.request.mockResolvedValueOnce({ ...failure(429, "RATE_LIMITED"), header: { "Retry-After": "60" } })
      .mockResolvedValueOnce({ statusCode: 201, data: { items: [dish] } });
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "RATE_LIMITED", retryAt: now + 60000 });
    advance(59999);
    await expect(client.retryPendingWrite()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(platform.request).toHaveBeenCalledTimes(1);
    advance(1);
    await client.retryPendingWrite();
    expect(platform.request.mock.calls[1]![0]).toEqual(platform.request.mock.calls[0]![0]);
  });
  it.each([undefined, { "Retry-After": "invalid" }, { "retry-after": new Date(now + 60000).toUTCString() }])(
    "handles missing, invalid and HTTP-date retry headers without a retry loop", async (header) => {
      const { client, platform } = fixture();
      platform.request.mockResolvedValueOnce({ ...failure(429, "RATE_LIMITED"), header });
      await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "RATE_LIMITED", retryAt: now + 60000 });
      await expect(client.retryPendingWrite()).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(platform.request).toHaveBeenCalledTimes(1);
    }
  );
  it("does not unlock an uncertain write when a concurrent transaction is absent from a read", async () => {
    const { client, platform } = fixture();
    platform.request.mockRejectedValueOnce(Error("timeout")).mockResolvedValueOnce({ statusCode: 200, data: { items: [] } });
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
    await client.getDishes();
    expect(() => client.discardPendingAfterReview()).toThrow(expect.objectContaining({ code: "PENDING_WRITE" }));
    await expect(client.addDishes({ items: [{ name: "新菜", category: "meat" }] })).rejects.toMatchObject({ code: "PENDING_WRITE" });
  });
  it("requires a read begun after the receipt expires instead of reusing an earlier empty read", async () => {
    const { client, platform, advance } = fixture();
    platform.request.mockRejectedValueOnce(Error("timeout"))
      .mockResolvedValueOnce({ statusCode: 200, data: { items: [] } })
      .mockResolvedValueOnce({ statusCode: 200, data: { items: [dish] } });
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
    await client.getDishes();
    advance(86400000);
    expect(() => client.discardPendingAfterReview()).toThrow(expect.objectContaining({ code: "REVIEW_REQUIRED" }));
    await client.getDishes();
    client.discardPendingAfterReview();
    expect(client.pendingWrite()).toBeNull();
  });
  it("reauthenticates the server's sole allowed owner before replaying the original key", async () => {
    const { client, platform } = fixture();
    platform.request.mockResolvedValueOnce(failure(401, "UNAUTHORIZED"))
      .mockResolvedValueOnce(failure(403, "FORBIDDEN"))
      .mockResolvedValueOnce({ statusCode: 201, data: { ...session, token: "n".repeat(43) } })
      .mockResolvedValueOnce({ statusCode: 201, data: { items: [dish] } });
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.login()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(client.retryPendingWrite()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(platform.request).toHaveBeenCalledTimes(2);
    await client.login();
    await client.retryPendingWrite();
    expect(platform.request.mock.calls[3]![0].header["Idempotency-Key"]).toBe(platform.request.mock.calls[0]![0].header["Idempotency-Key"]);
    expect(platform.request.mock.calls[3]![0].header.authorization).toBe(`Bearer ${"n".repeat(43)}`);
  });
  it.each(["expired", "reused"])("requires a fresh read and explicit review for %s receipts", async (reason) => {
    const { client, platform, advance } = fixture();
    platform.request.mockResolvedValueOnce(reason === "reused" ? failure(409, "IDEMPOTENCY_KEY_REUSED") : failure(500, "INTERNAL_ERROR"));
    await expect(client.addDishes(batch())).rejects.toBeDefined();
    if (reason === "expired") advance(86400000);
    await expect(client.retryPendingWrite()).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(() => client.discardPendingAfterReview()).toThrow(expect.objectContaining({ code: "REVIEW_REQUIRED" }));
    platform.request.mockResolvedValueOnce({ statusCode: 200, data: { items: [dish] } });
    await client.getDishes();
    client.discardPendingAfterReview();
    expect(client.pendingWrite()).toBeNull();
    await expect(client.retryPendingWrite()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("bounds the full response by 10 seconds, blocks concurrency and ignores late completion", async () => {
    vi.useFakeTimers();
    const { client, platform } = fixture();
    let complete!: (response: { statusCode: number; data: unknown }) => void;
    const abort = vi.fn(() => { throw Error("abort failed"); });
    platform.request.mockReturnValueOnce(Object.assign(new Promise<{ statusCode: number; data: unknown }>((resolve) => { complete = resolve; }), { abort }));
    const attempt = expect(client.addDishes(batch())).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
    await expect(client.getDishes()).rejects.toMatchObject({ code: "BUSY" });
    expect(() => client.discardPendingAfterReview()).toThrow(expect.objectContaining({ code: "BUSY" }));
    await vi.advanceTimersByTimeAsync(10000);
    await attempt;
    expect(abort).toHaveBeenCalledOnce();
    complete({ statusCode: 201, data: { items: [dish] } });
    await Promise.resolve();
    expect(client.pendingWrite()?.state).toBe("unknown");
  });
  it("cannot bypass an uncertain write through failed logout, login and a stale read", async () => {
    const { client, platform } = fixture();
    platform.request.mockRejectedValueOnce(Error("write timeout")).mockRejectedValueOnce(Error("logout timeout"))
      .mockResolvedValueOnce({ statusCode: 201, data: session })
      .mockResolvedValueOnce({ statusCode: 200, data: { items: [] } })
      .mockResolvedValueOnce({ statusCode: 201, data: { items: [dish] } });
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
    await expect(client.logout()).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
    expect(client.restoreSession()).toBe(false);
    await client.login();
    await client.getDishes();
    expect(() => client.discardPendingAfterReview()).toThrow(expect.objectContaining({ code: "PENDING_WRITE" }));
    await client.retryPendingWrite();
    expect(platform.request.mock.calls[4]![0].header["Idempotency-Key"]).toBe(platform.request.mock.calls[0]![0].header["Idempotency-Key"]);
  });
  it("fails before sending when authentication or safe randomness is unavailable", async () => {
    const { client, platform, storage } = fixture();
    platform.randomBytes.mockRejectedValueOnce(Error("unsupported"));
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "RANDOM_UNAVAILABLE" });
    platform.randomBytes.mockResolvedValueOnce(new Uint8Array(1));
    await expect(client.addDishes(batch())).rejects.toMatchObject({ code: "RANDOM_UNAVAILABLE" });
    expect(platform.request).not.toHaveBeenCalled();
    storage.clear();
    const unauthenticated = createKithInnClient({ baseUrl: origin, platform });
    await expect(unauthenticated.addDishes(batch())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

it("adapts real Taro primitives and keeps H5 login separate from safe H5 randomness", async () => {
  const platform = taroPlatform();
  vi.stubEnv("TARO_ENV", "weapp");
  vi.mocked(Taro.login).mockResolvedValue({ code: "wx-code", errMsg: "login:ok" });
  await expect(platform.login()).resolves.toMatchObject({ code: "wx-code" });
  vi.mocked(Taro.getUserCryptoManager).mockReturnValue({ getRandomValues: ({ success }) => success!({ randomValues: new Uint8Array(16).buffer, errMsg: "ok" }) } as ReturnType<typeof Taro.getUserCryptoManager>);
  expect(await platform.randomBytes()).toHaveLength(16);
  vi.mocked(Taro.getUserCryptoManager).mockImplementationOnce(() => { throw Error("not supported"); });
  await expect(platform.randomBytes()).rejects.toMatchObject({ code: "RANDOM_UNAVAILABLE" });
  platform.getStorageSync(storageKey); platform.setStorageSync(storageKey, session); platform.removeStorageSync(storageKey);
  expect(Taro.setStorageSync).toHaveBeenCalledWith(storageKey, session);
  platform.request({ url: origin, method: "GET", header: {}, timeout: 10000 });
  expect(Taro.request).toHaveBeenCalledWith(expect.objectContaining({ timeout: 10000 }));
  vi.stubEnv("TARO_ENV", "h5");
  await expect(platform.login()).rejects.toMatchObject({ code: "WECHAT_REQUIRED" });
  vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
  expect((await platform.randomBytes())[0]).toBe(7);
  vi.stubGlobal("crypto", undefined);
  await expect(platform.randomBytes()).rejects.toMatchObject({ code: "RANDOM_UNAVAILABLE" });
});
