import { describe, expect, it, vi } from "vitest";
import { applySeed, buildComboOp, buildOfferingOps, buildOperatorOp, buildSellerOp, resetSeedData, RESET_COLLECTIONS } from "./taozi";
import type { TaoziFixture } from "./taozi";

const fixture: TaoziFixture = {
  seller: { name: "测试商家", defaultPriceCents: 3000, enabledModules: ["menu-planning"] },
  offerings: [
    { name: "番茄炒蛋", mainIngredient: "鸡蛋", category: "veg", tags: ["清淡"] },
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
        tags: ["清淡"],
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
  const makePayload = (existingSeller: unknown) => ({
    find: vi.fn(async () => ({ docs: existingSeller ? [existingSeller] : [] })),
    create: vi.fn(async ({ data }: { collection: string; data: Record<string, unknown> }) => ({
      id: data.status === "active" ? 1 : 100, // seller gets id 1, offerings 100+
    })),
  });

  it("is idempotent — skips when the seller already exists", async () => {
    const payload = makePayload({ id: 9, name: "测试商家" });
    const result = await applySeed(payload, fixture);
    expect(result).toEqual({ seeded: false, offeringCount: 0 });
    expect(payload.create).not.toHaveBeenCalled();
  });

  it("creates the seller + offering pool when absent", async () => {
    const payload = makePayload(null);
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
    const payload = makePayload(null);
    const result = await applySeed(payload, { ...fixture, offerings: [] });
    expect(result).toEqual({ seeded: true, sellerId: 1, offeringCount: 0 });
    expect(payload.create).toHaveBeenCalledTimes(2); // seller + operator
  });

  it("seeds combo referencing the component pool, but NO customers (created at order time)", async () => {
    const payload = makePayload(null);
    const f: TaoziFixture = {
      seller: { name: "桃子测试", defaultPriceCents: 3000 },
      offerings: [{ name: "番茄炒蛋", mainIngredient: "鸡蛋", category: "veg" }],
      combo: { name: "4菜1汤套餐", priceCents: 3000 },
    };
    const result = await applySeed(payload, f);
    expect(result).toEqual({ seeded: true, sellerId: 1, offeringCount: 1 });
    // seller + 1 component + 1 combo + operator = 4 creates (no customers, no addresses)
    expect(payload.create).toHaveBeenCalledTimes(4);
    const comboCall = payload.create.mock.calls.find(
      (c) => (c[0] as { collection: string }).collection === "offerings" && (c[0].data as { kind?: string }).kind === "combo-meal",
    );
    expect((comboCall![0].data as unknown as { parentOfferings: number[] }).parentOfferings).toEqual([100]);
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
