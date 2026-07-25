import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest } from "payload";
import { describe, expect, it, vi } from "vitest";
import {
  captureKiv1MealSlotMenuGuardTarget,
  guardKiv1MealSlotMenuChange,
  withKiv1MealSlotMenuGuard
} from "../src/lib/kiv1-meal-slot-menu-guard";

const menuItems = [{
  offering: 1,
  nameSnapshot: "番茄牛腩",
  mainIngredientSnapshot: "牛肉",
  categorySnapshot: "meat"
}];

type HarnessOptions = {
  database?: string;
  latest?: Record<string, unknown> | null;
  session?: boolean;
  transactionId?: string | null;
};

function harness(options: HarnessOptions = {}) {
  const transactionId = options.transactionId === undefined ? "tx-1" : options.transactionId;
  const session = { db: { transaction: true } };
  const execute = vi.fn(async (): Promise<void> => undefined);
  const findOne = vi.fn(async () => options.latest === undefined ? {
    id: 11,
    menuItems,
    generatedAt: "2026-07-10T01:00:00.000Z",
    orderStatus: "draft"
  } : options.latest);
  const db = {
    name: options.database ?? "postgres",
    execute,
    findOne,
    sessions: options.session === false || transactionId === null
      ? {}
      : { [transactionId]: session }
  };
  const req = {
    context: {},
    payload: { db },
    transactionID: Promise.resolve(transactionId)
  } as unknown as PayloadRequest;
  return { db, execute, findOne, req, session };
}

async function invoke(
  req: PayloadRequest,
  data: Record<string, unknown>,
  originalDoc?: Record<string, unknown>,
  operation: "create" | "update" = "update",
  captureTarget = true
) {
  if (operation === "update" && captureTarget) {
    await captureKiv1MealSlotMenuGuardTarget({
      args: { id: 11 } as never,
      collection: {} as never,
      context: req.context,
      operation: "update",
      req
    });
  }
  return guardKiv1MealSlotMenuChange({
    collection: {} as Parameters<CollectionBeforeChangeHook>[0]["collection"],
    context: {},
    data,
    operation,
    originalDoc,
    req
  });
}

describe("kiv1 meal-slot menu persistence guard", () => {
  it.each(["local API", "Admin/REST"])("guards %s updates at the shared collection hook", async () => {
    const { execute, findOne, req, session } = harness();
    const data = { menuItems: [{ ...menuItems[0], nameSnapshot: "土豆牛腩" }] };

    await expect(invoke(req, data)).resolves.toBe(data);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ db: session.db }));
    expect(findOne).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_meal_slots",
      req,
      where: { id: { equals: 11 } }
    }));
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(findOne.mock.invocationCallOrder[0]!);
  });

  it("serializes behind an opening write and rejects after re-reading its committed status", async () => {
    let releaseLock!: () => void;
    let latestStatus = "draft";
    const waitingForOpenCommit = new Promise<void>((resolve) => { releaseLock = resolve; });
    const { execute, findOne, req } = harness();
    execute.mockImplementation(async () => waitingForOpenCommit);
    findOne.mockImplementation(async () => ({ id: 11, menuItems, orderStatus: latestStatus }));

    const menuWrite = invoke(
      req,
      { menuItems: [{ ...menuItems[0], nameSnapshot: "土豆牛腩" }] },
      { id: 11, orderStatus: "draft" }
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    latestStatus = "open";
    releaseLock();

    await expect(menuWrite).rejects.toMatchObject({ message: "meal-slot-menu-locked", status: 409 });
    expect(findOne).toHaveBeenCalledOnce();
  });

  it("uses the SQLite immediate transaction and rejects a locked latest row", async () => {
    const { execute, findOne, req } = harness({
      database: "sqlite",
      latest: { id: 11, menuItems, orderStatus: "closed" }
    });

    await expect(invoke(req, { menuItems: [] })).rejects.toMatchObject({
      message: "meal-slot-menu-locked",
      status: 409
    });
    expect(execute).not.toHaveBeenCalled();
    expect(findOne).toHaveBeenCalledOnce();
  });

  it("allows booking-only writes and full-document updates whose menu is unchanged", async () => {
    const latest = {
      id: 11,
      menuItems: [{ ...menuItems[0], id: "array-row", offering: { id: 1 } }],
      generatedAt: "2026-07-10T01:00:00.000Z",
      orderStatus: "open"
    };
    const untouched = harness({ latest });
    await expect(invoke(untouched.req, { orderDeadline: "2026-07-11T01:00:00.000Z" }))
      .resolves.toEqual({ orderDeadline: "2026-07-11T01:00:00.000Z" });
    expect(untouched.findOne).not.toHaveBeenCalled();

    const fullDocument = harness({ latest });
    const data = {
      menuItems,
      generatedAt: "2026-07-10T09:00:00+08:00",
      orderStatus: "closed"
    };
    await expect(invoke(fullDocument.req, data)).resolves.toBe(data);
  });

  it("does not require a row transaction for create operations", async () => {
    const { findOne, req } = harness({ transactionId: null });
    const data = { menuItems, orderStatus: "draft" };
    await expect(invoke(req, data, undefined, "create")).resolves.toBe(data);
    expect(findOne).not.toHaveBeenCalled();
  });

  it("fails closed when an update has no captured target instead of trusting originalDoc", async () => {
    const { req } = harness();
    await expect(invoke(
      req,
      { menuItems: [] },
      { id: 11, orderStatus: "draft" },
      "update",
      false
    )).rejects.toMatchObject({ message: "meal-slot-menu-guard-unavailable", status: 500 });
  });

  it.each([
    ["missing transaction", { transactionId: null }],
    ["missing transaction session", { session: false }],
    ["unsupported adapter", { database: "mongodb" }],
    ["missing locked row", { latest: null }]
  ] as const)("fails closed for %s", async (_label, options) => {
    const { req } = harness(options);
    await expect(invoke(req, { generatedAt: "2026-07-10T02:00:00.000Z" }))
      .rejects.toMatchObject({ message: "meal-slot-menu-guard-unavailable", status: 500 });
  });
});

describe("withKiv1MealSlotMenuGuard", () => {
  it("appends the guard only to the target collection and preserves existing hooks", () => {
    const existing = vi.fn();
    const target = {
      slug: "kiv1_meal_slots",
      fields: [],
      hooks: { beforeChange: [existing] }
    } satisfies CollectionConfig;
    const other = { slug: "kiv1_offerings", fields: [] } satisfies CollectionConfig;

    const configured = [target, other].map(withKiv1MealSlotMenuGuard);
    expect(configured[0]?.hooks?.beforeChange).toEqual([existing, guardKiv1MealSlotMenuChange]);
    expect(configured[0]?.hooks?.beforeOperation).toEqual([captureKiv1MealSlotMenuGuardTarget]);
    expect(configured[1]).toBe(other);
  });
});
