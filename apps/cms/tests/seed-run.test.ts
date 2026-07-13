import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertDevResetAllowed,
  configuredPostgresUrl,
  parseSeedProject,
  runProjectSeed,
} from "../seed/run";

type Doc = { id: string | number; [key: string]: unknown };
type Operation = { action: "find" | "create" | "delete"; collection: string };

const matchesWhere = (doc: Doc, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([field, condition]) => {
    if (field === "and") {
      return (condition as Array<Record<string, unknown>>).every((entry) => matchesWhere(doc, entry));
    }
    if (condition && typeof condition === "object" && "equals" in condition) {
      return doc[field] === (condition as { equals: unknown }).equals;
    }
    return true;
  });

const fakePayload = (initial: Record<string, Doc[]>) => {
  const state = structuredClone(initial);
  const operations: Operation[] = [];
  let nextId = 0;
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => {
      operations.push({ action: "find", collection });
      return { docs: (state[collection] ?? []).filter((doc) => matchesWhere(doc, where)) };
    }),
    create: vi.fn(async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => {
      operations.push({ action: "create", collection });
      const doc = { id: `${collection}-created-${++nextId}`, ...data };
      (state[collection] ??= []).push(doc);
      return doc;
    }),
    delete: vi.fn(async ({ collection, id }: { collection: string; id: string | number }) => {
      operations.push({ action: "delete", collection });
      state[collection] = (state[collection] ?? []).filter((doc) => doc.id !== id);
    }),
  };
  return { operations, payload, state };
};

const allow = { KITH_INN_ALLOW_DEV_SEED_RESET: "1" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("project-scoped seed orchestration", () => {
  it.each([false, true])("kith-inn reset=%s preserves kiv1 sentinel with zero kiv1 access", async (resetDev) => {
    const sentinel = { id: "kiv1-sentinel", marker: { keep: true } };
    const { operations, payload, state } = fakePayload({ kiv1_sellers: [sentinel] });

    await runProjectSeed(payload, "kith-inn", resetDev);

    expect(state.kiv1_sellers).toEqual([sentinel]);
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.filter(({ collection }) => collection.startsWith("kiv1_"))).toEqual([]);
  });

  it.each([false, true])("kiv1 reset=%s preserves kith-inn sentinel with zero kith-inn access", async (resetDev) => {
    const sentinel = { id: "kith-sentinel", name: "不可改的旧项目", marker: { keep: true } };
    const { operations, payload, state } = fakePayload({ sellers: [sentinel] });

    await runProjectSeed(payload, "kiv1", resetDev);

    expect(state.sellers).toEqual([sentinel]);
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every(({ collection }) => collection.startsWith("kiv1_"))).toBe(true);
  });

  it("requires one known project and has no all-project fallback", () => {
    expect(parseSeedProject(["kith-inn"])).toBe("kith-inn");
    expect(parseSeedProject(["--reset-dev", "kiv1"])).toBe("kiv1");
    expect(() => parseSeedProject([])).toThrow(/project/);
    expect(() => parseSeedProject(["all"])).toThrow(/project/);
  });

  it("exposes only the four explicit project scripts", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).filter((name) => name.startsWith("seed"))).toEqual([
      "seed:kith-inn",
      "seed:kith-inn:reset:dev",
      "seed:kiv1",
      "seed:kiv1:reset:dev",
    ]);
  });
});

describe("configuredPostgresUrl", () => {
  it("mirrors Payload's Postgres URL fallback order", () => {
    expect(configuredPostgresUrl({
      DATABASE_URI: "postgresql://uri/db",
      POSTGRES_URL: "postgresql://postgres-url/db",
      POSTGRES_URL_NON_POOLING: "postgresql://non-pooling/db",
      DATABASE_URL_UNPOOLED: "postgresql://unpooled/db",
      DATABASE_URL: "postgresql://database-url/db",
      PAYLOAD_DATABASE_URL: "postgresql://payload/db",
    })).toBe("postgresql://payload/db");
  });

  it("ignores sqlite DATABASE_URI", () => {
    expect(configuredPostgresUrl({ DATABASE_URI: "file:./payload.db" })).toBeUndefined();
  });
});

describe("assertDevResetAllowed", () => {
  it("requires the explicit destructive-reset switch", () => {
    expect(() => assertDevResetAllowed({})).toThrow(/KITH_INN_ALLOW_DEV_SEED_RESET=1/);
  });

  it.each(["production", "staging", "preview"])("rejects the %s environment", (APP_ENV) => {
    expect(() => assertDevResetAllowed({ ...allow, APP_ENV })).toThrow(/outside local dev/);
  });

  it("rejects a remote Postgres URL from fallback env names", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      POSTGRES_URL: "postgresql://user:pass@db.example.com/cfp",
    })).toThrow(/non-local database URL/);
  });

  it("allows an explicit local dev reset against local Postgres", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      POSTGRES_URL_NON_POOLING: "postgresql://postgres:postgres@127.0.0.1:54324/cfp",
    })).not.toThrow();
  });

  it("allows sqlite fallback when no Postgres URL is configured", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      DATABASE_URI: "file:./payload.db",
    })).not.toThrow();
  });
});
