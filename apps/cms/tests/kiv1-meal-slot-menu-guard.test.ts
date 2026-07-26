import type {
  CollectionBeforeChangeHook,
  CollectionConfig,
  Payload,
  PayloadRequest
} from "payload";
import { getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import config from "../payload.config";
import {
  guardKiv1MealSlotMenuChange,
  KIV1_AVAILABILITY_CHECKED,
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

function invoke(
  req: PayloadRequest,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null = { id: 11, orderStatus: "open" },
  operation: "create" | "update" = "update"
) {
  return guardKiv1MealSlotMenuChange({
    collection: {} as Parameters<CollectionBeforeChangeHook>[0]["collection"],
    context: {},
    data,
    operation,
    originalDoc: originalDoc ?? undefined,
    req
  });
}

describe("kiv1 meal-slot menu persistence guard", () => {
  it.each(["local API", "Admin/REST", "where bulk record"])(
    "guards %s updates at the shared collection hook",
    async () => {
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
    }
  );

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

  it("fails closed when an update has no row identifier", async () => {
    const { req } = harness();
    await expect(invoke(req, { menuItems: [] }, null))
      .rejects.toMatchObject({ message: "meal-slot-menu-guard-unavailable", status: 500 });
  });

  it.each([
    ["open", "draft", false],
    ["open", "closed", true],
    ["closed", "open", false],
    ["closed", "draft", false],
    ["draft", "open", false]
  ])("guards uncontrolled lifecycle transition %s -> %s", async (current, requested, allowed) => {
    const { req } = harness({ latest: { id: 11, menuItems, orderStatus: current } });
    const result = invoke(req, { orderStatus: requested });
    if (allowed) await expect(result).resolves.toEqual({ orderStatus: requested });
    else await expect(result).rejects.toMatchObject({ status: 409 });
  });

  it.each(["draft", "closed"])("allows a controlled %s -> open transition", async (current) => {
    const { req } = harness({ latest: { id: 11, menuItems, orderStatus: current } });
    req.context[KIV1_AVAILABILITY_CHECKED] = true;
    await expect(invoke(req, { orderStatus: "open" })).resolves.toEqual({ orderStatus: "open" });
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
    expect(configured[1]).toBe(other);
  });
});

describe.skipIf(!process.env.DATABASE_URL && !process.env.PAYLOAD_DATABASE_URL)(
  "Postgres menu/status serialization",
  () => {
    let payload: Payload;

    beforeAll(async () => {
      payload = await getPayload({ config });
    }, 60_000);

    afterAll(async () => {
      if (payload) await payload.destroy();
    });

    it("serializes menu and status writes on the Payload transaction", async () => {
      const suffix = crypto.randomUUID();
      const seller = await payload.create({
        collection: "kiv1_sellers",
        data: { name: `菜单锁 ${suffix}`, defaultPriceCents: 3000, status: "active" },
        overrideAccess: true
      });
      const offering = await payload.create({
        collection: "kiv1_offerings",
        data: { seller: seller.id, name: `菜 ${suffix}`, category: "veg", active: true },
        overrideAccess: true
      });
      const originalItem = { ...menuItems[0], offering: offering.id };
      const slot = await payload.create({
        collection: "kiv1_meal_slots",
        data: {
          seller: seller.id,
          date: "2031-07-25",
          occasion: "lunch",
          menuItems: [originalItem],
          orderStatus: "draft"
        },
        overrideAccess: true
      });
      const heldSlot = await payload.create({
        collection: "kiv1_meal_slots",
        data: {
          seller: seller.id,
          date: "2031-07-26",
          occasion: "lunch",
          menuItems: [originalItem],
          orderStatus: "draft"
        },
        overrideAccess: true
      });

      let menuReachedHook!: () => void;
      let releaseMenu!: () => void;
      let menuHeldLock!: () => void;
      let releaseHeldMenu!: () => void;
      const atHook = new Promise<void>((resolve) => { menuReachedHook = resolve; });
      const released = new Promise<void>((resolve) => { releaseMenu = resolve; });
      const holdingLock = new Promise<void>((resolve) => { menuHeldLock = resolve; });
      const releaseLock = new Promise<void>((resolve) => { releaseHeldMenu = resolve; });
      const observed = new Map<string, unknown>();
      const interleave: CollectionBeforeChangeHook = async ({ originalDoc, req }) => {
        const actor = req.context.menuGuardActor;
        if (typeof actor !== "string") return;
        observed.set(actor, originalDoc?.orderStatus);
        if (actor === "menu") {
          menuReachedHook();
          await released;
        }
      };
      const hooks = payload.collections.kiv1_meal_slots!.config.hooks.beforeChange;
      const holdAfterLock: CollectionBeforeChangeHook = async ({ req }) => {
        if (req.context.menuGuardActor !== "held-menu") return;
        menuHeldLock();
        await releaseLock;
      };
      hooks.unshift(interleave);
      hooks.push(holdAfterLock);

      try {
        const menuWrite = payload.update({
          collection: "kiv1_meal_slots",
          id: slot.id,
          context: { menuGuardActor: "menu" },
          data: { menuItems: [{ ...originalItem, nameSnapshot: "新菜" }] },
          overrideAccess: true
        });
        await atHook;
        await payload.update({
          collection: "kiv1_meal_slots",
          id: slot.id,
          context: { menuGuardActor: "open", [KIV1_AVAILABILITY_CHECKED]: true },
          data: { orderStatus: "open" },
          overrideAccess: true
        });
        releaseMenu();
        await expect(menuWrite).rejects.toMatchObject({ message: "meal-slot-menu-locked", status: 409 });
        expect(observed).toEqual(new Map([["menu", "draft"], ["open", "draft"]]));
        await expect(payload.findByID({
          collection: "kiv1_meal_slots",
          id: slot.id,
          overrideAccess: true
        })).resolves.toMatchObject({ orderStatus: "open", menuItems: [{ nameSnapshot: "番茄牛腩" }] });

        const heldMenuWrite = payload.update({
          collection: "kiv1_meal_slots",
          id: heldSlot.id,
          context: { menuGuardActor: "held-menu" },
          data: { menuItems: [{ ...originalItem, nameSnapshot: "持锁新菜" }] },
          overrideAccess: true
        });
        await holdingLock;
        let openingSettled = false;
        const openingWrite = payload.update({
          collection: "kiv1_meal_slots",
          id: heldSlot.id,
          context: { menuGuardActor: "held-open", [KIV1_AVAILABILITY_CHECKED]: true },
          data: { orderStatus: "open" },
          overrideAccess: true
        }).then((value) => {
          openingSettled = true;
          return value;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(openingSettled).toBe(false);
        releaseHeldMenu();
        await expect(heldMenuWrite).resolves.toMatchObject({ menuItems: [{ nameSnapshot: "持锁新菜" }] });
        await expect(openingWrite).resolves.toMatchObject({ orderStatus: "open" });
      } finally {
        releaseMenu();
        releaseHeldMenu();
        for (const hook of [interleave, holdAfterLock]) {
          const index = hooks.indexOf(hook);
          if (index >= 0) hooks.splice(index, 1);
        }
        await payload.delete({ collection: "kiv1_meal_slots", id: slot.id, overrideAccess: true });
        await payload.delete({ collection: "kiv1_meal_slots", id: heldSlot.id, overrideAccess: true });
        await payload.delete({ collection: "kiv1_offerings", id: offering.id, overrideAccess: true });
        await payload.delete({ collection: "kiv1_sellers", id: seller.id, overrideAccess: true });
      }
    }, 60_000);
  }
);
