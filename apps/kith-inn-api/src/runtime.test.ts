import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { createReadinessProbe, installGracefulShutdown, startKithInnRuntime } from "./runtime";

afterEach(() => vi.useRealTimers());

it("requires the shipped migration checksum and all five tables", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
  const probe = await createReadinessProbe({ query });
  await expect(probe()).resolves.toBeUndefined();
  const checksum = createHash("sha256").update(await readFile(new URL("../migrations/0001_initial.sql", import.meta.url))).digest("hex");
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ values: ["0001_initial.sql", checksum], query_timeout: 2_000 }));
  for (const table of ["merchants", "sessions", "dishes", "week_plans", "mutation_receipts"]) {
    expect(query.mock.calls[0]?.[0].text).toContain(`to_regclass('${table}') IS NOT NULL`);
  }
  query.mockResolvedValue({ rows: [{ ready: false }] });
  await expect(probe()).rejects.toThrow("SCHEMA_NOT_READY");
  query.mockRejectedValue(new Error("database unavailable"));
  await expect(probe()).rejects.toThrow("database unavailable");
  query.mockImplementation(() => new Promise(() => undefined));
  vi.useFakeTimers();
  const result = expect(probe()).rejects.toThrow("READINESS_TIMEOUT");
  await vi.advanceTimersByTimeAsync(2_000);
  await result;
});

it.each(["SIGTERM", "SIGINT"])("handles %s once, drains HTTP before closing the pool and bounds drainage", async (signal) => {
  vi.useFakeTimers();
  const signals = new EventEmitter();
  const order: string[] = [];
  const server = { close: () => order.push("http"), closeAllConnections: () => order.push("disconnect") } as unknown as Server;
  const pool = { end: async () => { order.push("pool"); } };
  const close = installGracefulShutdown(server, pool, signals);
  signals.emit(signal);
  expect(close()).toBe(close());
  expect(order).toEqual(["http"]);
  await vi.advanceTimersByTimeAsync(10_000);
  await close();
  expect(order).toEqual(["http", "disconnect", "pool"]);
  expect(signals.listenerCount("SIGTERM") + signals.listenerCount("SIGINT")).toBe(0);
});

it("serves readiness independently, closes once and releases the pool after a listen failure", async () => {
  const reserved = createServer();
  await new Promise<void>((resolve) => reserved.listen(0, "0.0.0.0", resolve));
  const address = reserved.address();
  if (!address || typeof address === "string") throw new Error("missing test address");
  const environment = {
    KITH_INN_DATABASE_URL: "postgres://test@localhost/kith_inn_test", PORT: String(address.port),
    KITH_INN_WECHAT_APP_ID: "test-app", KITH_INN_WECHAT_APP_SECRET: "secret", KITH_INN_WECHAT_OWNER_OPEN_ID: "owner"
  };
  const end = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
  const pool = Object.assign(new EventEmitter(), { query, end }) as unknown as Pool;
  try {
    await expect(startKithInnRuntime({ environment, pool })).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(end).toHaveBeenCalledOnce();
    expect(pool.listenerCount("error")).toBe(0);
  } finally { await new Promise<void>((resolve) => reserved.close(() => resolve())); }
  end.mockClear();
  const logger = vi.fn();
  const runtime = await startKithInnRuntime({ environment, pool, logger });
  try {
    expect((await fetch(`http://127.0.0.1:${address.port}/api/kith-inn/ready`)).status).toBe(200);
    const failure = new Error("secret database connection details");
    expect(() => pool.emit("error", failure)).not.toThrow();
    query.mockRejectedValue(failure);
    expect((await fetch(`http://127.0.0.1:${address.port}/api/kith-inn/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${address.port}/api/kith-inn/ready`)).status).toBe(503);
    expect(JSON.stringify(logger.mock.calls)).not.toContain(failure.message);
  } finally { await Promise.all([runtime.close(), runtime.close()]); }
  expect(end).toHaveBeenCalledOnce();
  expect(pool.listenerCount("error")).toBe(0);
});
