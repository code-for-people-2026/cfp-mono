import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../scripts/migrate.mjs";
import { createWechatExchanger } from "./auth";
import { resolveKithInnTestDatabaseUrl } from "./config";
import { createKithInnPool } from "./database";
import { Sessions } from "./sessions";
import { createReadinessProbe } from "./runtime";

describe("WeChat exchange boundary", () => {
  it.each([undefined, 0])("accepts success errcode %s and discards session_key", async (errcode) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ openid: "owner", session_key: "secret", errcode }));
    const exchange = createWechatExchanger({ appId: "app", appSecret: "secret", fetcher });
    await expect(exchange("code")).resolves.toBe("owner");
    const [url, options] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get("grant_type")).toBe("authorization_code");
    expect(options).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
  });
  it.each([{ errcode: 40029, openid: "owner" }, { errcode: "0", openid: "owner" }, {}, { openid: " " }, null])(
    "rejects invalid upstream replies", async (payload) => {
      const exchange = createWechatExchanger({ appId: "app", appSecret: "secret",
        fetcher: async () => Response.json(payload) });
      await expect(exchange("code")).rejects.toMatchObject({ code: "WECHAT_LOGIN_FAILED" });
    }
  );
  it("sets a 3s deadline and masks network errors", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const exchange = createWechatExchanger({ appId: "app", appSecret: "secret",
      fetcher: async () => { throw new Error("URL contains secret and code"); } });
    await expect(exchange("code")).rejects.toMatchObject({ message: "微信登录暂不可用，请重新登录" });
    expect(timeout).toHaveBeenCalledWith(3_000);
    timeout.mockRestore();
  });
});

describe("PostgreSQL owner sessions", () => {
  const pool = createKithInnPool({ KITH_INN_DATABASE_URL: resolveKithInnTestDatabaseUrl() });
  let now = new Date();
  const exchange = vi.fn(async () => "owner");
  const sessions = new Sessions(pool, { appId: "app", ownerOpenId: "owner" }, exchange, () => now);
  beforeAll(async () => {
    const { rows: [target] } = await pool.query("SELECT current_database() AS name");
    if (!target.name.endsWith("_test")) throw new Error("Test database required");
    await migrate(pool);
  });
  beforeEach(async () => {
    now = new Date();
    exchange.mockResolvedValue("owner");
    await pool.query("TRUNCATE mutation_receipts, week_plans, dishes, sessions, merchants");
  });
  afterAll(async () => { await pool.end(); });

  it("marks real PostgreSQL unready when the applied checksum or a required table is unavailable", async () => {
    const client = await pool.connect();
    const probe = await createReadinessProbe(client);
    try {
      await probe();
      await client.query("BEGIN");
      await client.query("UPDATE kith_inn_migrations SET checksum = repeat('0', 64)");
      await expect(probe()).rejects.toThrow("SCHEMA_NOT_READY");
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("ALTER TABLE dishes RENAME TO unavailable_dishes");
      await expect(probe()).rejects.toThrow("SCHEMA_NOT_READY");
    } finally { await client.query("ROLLBACK"); client.release(); }
    await expect((await createReadinessProbe(pool))()).resolves.toBeUndefined();
  });

  it("never registers a stranger, or accepts a client-chosen identity", async () => {
    exchange.mockResolvedValue("stranger");
    await expect(sessions.login("code")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pool.query("SELECT count(*)::int AS count FROM merchants")).rows[0].count).toBe(0);
    await expect(sessions.authenticate("forged")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("creates independent 32-byte tokens for one merchant and stores only SHA256 hashes", async () => {
    const [first, second] = await Promise.all([sessions.login("one"), sessions.login("two")]);
    expect(first.token).not.toBe(second.token);
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(Date.parse(first.expiresAt) - now.getTime()).toBe(30 * 86_400_000);
    const one = await sessions.authenticate(first.token), two = await sessions.authenticate(second.token);
    expect(one.merchantId).toBe(two.merchantId);
    expect(one.tokenHash).toEqual(createHash("sha256").update(first.token).digest());
    const stored = (await pool.query("SELECT token_hash FROM sessions")).rows;
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.token_hash.length === 32)).toBe(true);
    await sessions.revoke(one);
    await expect(sessions.authenticate(first.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(sessions.authenticate(second.token)).resolves.toMatchObject({ merchantId: two.merchantId });
    now = new Date(Date.parse(second.expiresAt));
    await expect(sessions.authenticate(second.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects disabled and reconfigured identities without reactivating or replacing them", async () => {
    const { token } = await sessions.login("code");
    await pool.query("UPDATE merchants SET active = false");
    await expect(sessions.login("code")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sessions.authenticate(token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pool.query("UPDATE merchants SET active = true");
    const other = new Sessions(pool, { appId: "new-app", ownerOpenId: "owner" }, exchange);
    await expect(other.login("code")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(other.authenticate(token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pool.query("SELECT app_id FROM merchants")).rows[0].app_id).toBe("app");
  });
});
