import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createReadinessProbe,
  installGracefulShutdown,
  startWeeklyMenuRuntime
} from "./runtime";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test port unavailable");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function recipesResponse(): Response {
  return new Response(
    JSON.stringify({
      docs: [
        { name: "红烧肉", category: "big-meat", active: true },
        { name: "番茄炒蛋", category: "small-meat", active: true },
        { name: "清炒时蔬", category: "vegetable", active: true }
      ]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("createReadinessProbe", () => {
  it("requires the database and all three active recipe categories", async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const fetchRecipes = vi.fn().mockResolvedValue({
      bigMeat: ["红烧肉"],
      smallMeat: ["番茄炒蛋"],
      vegetable: ["清炒时蔬"]
    });
    await expect(createReadinessProbe({ checkDatabase, fetchRecipes })()).resolves.toBeUndefined();
    expect(checkDatabase).toHaveBeenCalledOnce();
    expect(fetchRecipes).toHaveBeenCalledOnce();
  });

  it("fails closed for an empty category or a timed-out dependency", async () => {
    await expect(
      createReadinessProbe({
        checkDatabase: vi.fn().mockResolvedValue(undefined),
        fetchRecipes: vi.fn().mockResolvedValue({
          bigMeat: ["红烧肉"],
          smallMeat: [],
          vegetable: ["清炒时蔬"]
        })
      })()
    ).rejects.toThrow("RECIPES_INCOMPLETE");

    await expect(
      createReadinessProbe({
        checkDatabase: () => new Promise(() => undefined),
        fetchRecipes: vi.fn().mockResolvedValue({
          bigMeat: ["红烧肉"],
          smallMeat: ["番茄炒蛋"],
          vegetable: ["清炒时蔬"]
        }),
        timeoutMs: 5
      })()
    ).rejects.toThrow("READINESS_TIMEOUT");
  });
});

describe("installGracefulShutdown", () => {
  it("handles SIGTERM once and closes HTTP before PostgreSQL", async () => {
    const signals = new EventEmitter();
    const order: string[] = [];
    const shutdown = installGracefulShutdown({
      signals,
      closeServer: async () => {
        order.push("server");
      },
      closePool: async () => {
        order.push("pool");
      }
    });

    signals.emit("SIGTERM");
    signals.emit("SIGTERM");
    await shutdown();
    expect(order).toEqual(["server", "pool"]);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
});

describe("startWeeklyMenuRuntime", () => {
  it("starts independently with injected dependencies and closes cleanly", async () => {
    const port = await availablePort();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const end = vi.fn().mockResolvedValue(undefined);
    const pool = { query, end } as unknown as Pool;
    const runtime = await startWeeklyMenuRuntime({
      environment: {
        WEEKLY_MENU_DATABASE_URL: "postgresql://weekly@example.test/weekly_menu",
        WEEKLY_MENU_RECIPES_BASE_URL: "https://website.example.test",
        WEEKLY_MENU_WECHAT_APP_ID: "test-app-id",
        WEEKLY_MENU_WECHAT_APP_SECRET: "test-app-secret",
        PORT: String(port),
        RELEASE_SHA: "abcdef1234567890"
      },
      fetcher: vi.fn().mockResolvedValue(recipesResponse()),
      logger: vi.fn(),
      pool
    });

    await expect(
      fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json())
    ).resolves.toEqual({ status: "ok", release: "abcdef123456" });
    await expect(
      fetch(`http://127.0.0.1:${port}/api/ready`).then((response) => response.json())
    ).resolves.toEqual({ status: "ready" });
    expect(query).toHaveBeenCalledWith({
      text: "SELECT 1",
      query_timeout: 2_000
    });

    await runtime.close();
    expect(end).toHaveBeenCalledOnce();
  });
});
