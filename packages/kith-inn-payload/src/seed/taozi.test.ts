import { describe, expect, it, vi } from "vitest";
import { applySeed, buildOfferingOps, buildSellerOp } from "./taozi";
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
    // 1 seller + 2 offerings
    expect(payload.create).toHaveBeenCalledTimes(3);
    expect(payload.create.mock.calls[0]?.[0]).toMatchObject({ collection: "sellers" });
    expect(payload.create.mock.calls[1]?.[0]).toMatchObject({ collection: "offerings" });
  });

  it("seeds the seller even with an empty offering pool", async () => {
    const payload = makePayload(null);
    const result = await applySeed(payload, { ...fixture, offerings: [] });
    expect(result).toEqual({ seeded: true, sellerId: 1, offeringCount: 0 });
    expect(payload.create).toHaveBeenCalledTimes(1); // seller only
  });
});
