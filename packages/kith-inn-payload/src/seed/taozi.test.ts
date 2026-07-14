import { describe, expect, it, vi } from "vitest";
import { applySeed, buildComboOp, buildOfferingOps, buildOperatorOp, buildSellerOp, resetSeedData, RESET_COLLECTIONS } from "./taozi";
import type { PayloadRequest } from "payload";
import type { TaoziFixture } from "./taozi";

const fixture: TaoziFixture = {
  seller: { name: "测试商家", defaultPriceCents: 3000, enabledModules: ["menu-planning"] },
  offerings: [
    { name: "番茄炒蛋", mainIngredient: "鸡蛋", category: "veg" },
    { name: "红烧牛肉", mainIngredient: "牛肉", category: "meat" },
  ],
};

describe("buildSellerOp", () => {
  it("builds a sellers create-op with status forced active", () => {
    expect(buildSellerOp(fixture)).toEqual({
      collection: "sellers",
      data: { name: "测试商家", defaultPriceCents: 3000, enabledModules: ["menu-planning"], status: "active" },
    });
  });
});

describe("buildOfferingOps", () => {
  it("attributes every offering to the given seller as a component", () => {
    const ops = buildOfferingOps(fixture, 7);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({
      collection: "offerings",
      data: {
        name: "番茄炒蛋",
        kind: "component",
        mainIngredient: "鸡蛋",
        category: "veg",
        seller: 7,
        active: true,
      },
    });
    expect(ops[1]?.data).toMatchObject({ name: "红烧牛肉", seller: 7, kind: "component", active: true });
  });

  it("returns no ops for an empty offering pool", () => {
    expect(buildOfferingOps({ ...fixture, offerings: [] }, 7)).toEqual([]);
  });
});

describe("buildOperatorOp", () => {
  it("builds an operators create-op with dev openid + synthetic auth", () => {
    expect(buildOperatorOp(7)).toEqual({
      collection: "operators",
      data: {
        wechatOpenid: "taozi-dev-openid",
        email: "taozi@kith-inn.local",
        password: "taozi-dev-password",
        role: "owner",
        active: true,
        seller: 7,
      },
    });
  });

  it("accepts a production OpenID without changing the dev default", () => {
    expect(buildOperatorOp(7, "trial-openid").data.wechatOpenid).toBe("trial-openid");
    expect(buildOperatorOp(7).data.wechatOpenid).toBe("taozi-dev-openid");
  });
});

describe("buildComboOp", () => {
  it("builds a combo-meal offering op referencing the component pool", () => {
    const f: TaoziFixture = { seller: { name: "x" }, offerings: [], combo: { name: "4菜1汤套餐", priceCents: 3000 } };
    expect(buildComboOp(f, 7, [100, 101])).toEqual({
      collection: "offerings",
      data: { name: "4菜1汤套餐", kind: "combo-meal", priceCents: 3000, parentOfferings: [100, 101], seller: 7, active: true },
    });
  });
});

describe("applySeed", () => {
  type Doc = { id: string | number; [key: string]: unknown };
  const makePayload = (initial: Record<string, Doc[]> = {}) => {
    const state = structuredClone(initial);
    let nextId = 10;
    const matches = (doc: Doc, where: Record<string, unknown>): boolean =>
      Object.entries(where).every(([field, condition]) => field === "and"
        ? (condition as Record<string, unknown>[]).every((entry) => matches(doc, entry))
        : doc[field] === (condition as { equals: unknown }).equals);
    return {
      state,
      find: vi.fn(async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => ({
        docs: (state[collection] ?? []).filter((doc) => matches(doc, where)),
      })),
      create: vi.fn(async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => {
        const doc = { id: ++nextId, ...data };
        (state[collection] ??= []).push(doc);
        return doc;
      }),
      update: vi.fn(async ({ collection, id, data }: { collection: string; id: string | number; data: Record<string, unknown> }) => {
        const doc = state[collection]!.find((entry) => entry.id === id)!;
        Object.assign(doc, data);
        return doc;
      }),
    };
  };

  it("creates the seller + offering pool when absent", async () => {
    const payload = makePayload();
    const result = await applySeed(payload, fixture);
    expect(result.seeded).toBe(true);
    expect(result.offeringCount).toBe(2);
    // 1 seller + 2 offerings + 1 operator
    expect(payload.create).toHaveBeenCalledTimes(4);
    expect(payload.create.mock.calls[0]?.[0]).toMatchObject({ collection: "sellers" });
    expect(payload.create.mock.calls[1]?.[0]).toMatchObject({ collection: "offerings" });
    expect(payload.create.mock.calls[3]?.[0]).toMatchObject({ collection: "operators" });
  });

  it("seeds the seller even with an empty offering pool", async () => {
    const payload = makePayload();
    const result = await applySeed(payload, { ...fixture, offerings: [] });
    expect(result).toMatchObject({ seeded: true, offeringCount: 0 });
    expect(payload.create).toHaveBeenCalledTimes(2); // seller + operator
  });

  it("recovers a partial seed and converges repeatedly by stable keys", async () => {
    const payload = makePayload({
      sellers: [{ id: 1, name: fixture.seller.name, status: "inactive" }],
      offerings: [{ id: 2, name: fixture.offerings[0]!.name, kind: "component", seller: 1 }],
    });
    const req = { transactionID: Promise.resolve("seed") } as PayloadRequest;

    const first = await applySeed(payload, fixture, { operatorOpenid: "trial-openid", req });
    const second = await applySeed(payload, fixture, { operatorOpenid: "trial-openid", req });

    expect(first).toEqual({ seeded: true, sellerId: 1, offeringCount: 2 });
    expect(second).toEqual({ seeded: false, sellerId: 1, offeringCount: 2 });
    expect(payload.state.sellers).toHaveLength(1);
    expect(payload.state.offerings).toHaveLength(2);
    expect(payload.state.operators).toHaveLength(1);
    expect(payload.state.operators![0]).toMatchObject({ email: "taozi@kith-inn.local", wechatOpenid: "trial-openid", seller: 1 });
    for (const call of [...payload.create.mock.calls, ...payload.update.mock.calls]) {
      expect(call[0]).toMatchObject({ req });
    }
  });

  it("fails closed when a stable seed key is already ambiguous", async () => {
    const payload = makePayload({ sellers: [
      { id: 1, name: fixture.seller.name },
      { id: 2, name: fixture.seller.name },
    ] });
    await expect(applySeed(payload, fixture)).rejects.toThrow(/ambiguous seed key in sellers/);
    expect(payload.create).not.toHaveBeenCalled();
  });

  it("refuses to reassign the fixed operator email from another seller", async () => {
    const payload = makePayload({
      sellers: [{ id: 1, name: fixture.seller.name }],
      operators: [{ id: 2, email: "taozi@kith-inn.local", seller: 99, wechatOpenid: "other" }],
    });
    await expect(applySeed(payload, fixture)).rejects.toThrow(/conflicting seed key in operators/);
    expect(payload.state.operators![0]).toMatchObject({ seller: 99, wechatOpenid: "other" });
  });

  it("accepts a populated operator relationship owned by the 桃子 seller", async () => {
    const payload = makePayload({
      sellers: [{ id: 1, name: fixture.seller.name }],
      operators: [{ id: 2, email: "taozi@kith-inn.local", seller: { id: 1 }, wechatOpenid: "old" }],
    });
    await expect(applySeed(payload, fixture, { operatorOpenid: "new" })).resolves.toMatchObject({ sellerId: 1 });
    expect(payload.state.operators![0]).toMatchObject({ seller: 1, wechatOpenid: "new" });
  });

  it("seeds combo referencing the component pool, but NO customers (created at order time)", async () => {
    const payload = makePayload();
    const f: TaoziFixture = {
      seller: { name: "桃子测试", defaultPriceCents: 3000 },
      offerings: [{ name: "番茄炒蛋", mainIngredient: "鸡蛋", category: "veg" }],
      combo: { name: "4菜1汤套餐", priceCents: 3000 },
    };
    const result = await applySeed(payload, f);
    expect(result).toMatchObject({ seeded: true, offeringCount: 1 });
    // seller + 1 component + 1 combo + operator = 4 creates (no customers, no addresses)
    expect(payload.create).toHaveBeenCalledTimes(4);
    const comboCall = payload.create.mock.calls.find(
      (c) => (c[0] as { collection: string }).collection === "offerings" && (c[0].data as { kind?: string }).kind === "combo-meal",
    );
    expect((comboCall![0].data as unknown as { parentOfferings: number[] }).parentOfferings).toHaveLength(1);
    // no customer/address collections touched
    expect(payload.create.mock.calls.some((c) => (c[0] as { collection: string }).collection === "customers")).toBe(false);
    expect(payload.create.mock.calls.some((c) => (c[0] as { collection: string }).collection === "customer_addresses")).toBe(false);
  });
});

describe("resetSeedData", () => {
  it("deletes every kith-inn collection in FK-safe order", async () => {
    const find = vi.fn(async ({ collection }: { collection: string }) => ({ docs: [{ id: `${collection}-1` }, { id: `${collection}-2` }] }));
    const del = vi.fn(async () => undefined);
    const result = await resetSeedData({ find, delete: del });

    expect(result.deleted.chat_messages).toBe(2);
    const findCalls = find.mock.calls as Array<[{ collection: string }]>;
    const deleteCalls = del.mock.calls as unknown as Array<[{ collection: string; id: string; overrideAccess: true }]>;
    expect(findCalls.map((c) => c[0].collection)).toEqual([...RESET_COLLECTIONS]);
    expect(deleteCalls.slice(0, 2).map((c) => c[0])).toEqual([
      { collection: "chat_messages", id: "chat_messages-1", overrideAccess: true },
      { collection: "chat_messages", id: "chat_messages-2", overrideAccess: true },
    ]);
    expect(del).toHaveBeenCalledTimes(RESET_COLLECTIONS.length * 2);
  });
});
