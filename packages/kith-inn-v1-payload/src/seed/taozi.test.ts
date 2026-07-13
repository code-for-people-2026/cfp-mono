import { describe, expect, it, vi } from "vitest";
import {
  applySeed,
  buildOperatorData,
  buildSellerData,
  resetSeedData,
  RESET_COLLECTIONS,
  TAOZI_OPERATOR_OPENID,
  TAOZI_SELLER_NAME
} from "./taozi";

describe("桃子 v1 seed", () => {
  it("只构造 v1 seller/operator 数据", () => {
    expect(buildSellerData()).toEqual({
      name: "桃子",
      defaultPriceCents: 3000,
      status: "active"
    });
    expect(buildOperatorData(1)).toEqual({
      seller: 1,
      wechatOpenid: "taozi-v1-dev-openid",
      active: true
    });
  });

  it("首次运行创建一条 seller 和一条 operator", async () => {
    const find = vi.fn()
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });
    const create = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });

    await expect(applySeed({ find, create })).resolves.toEqual({
      seeded: true,
      sellerId: 1,
      sellerCreated: true,
      operatorCreated: true
    });
    expect(create.mock.calls.map(([args]) => args.collection)).toEqual([
      "kiv1_sellers",
      "kiv1_operators"
    ]);
    expect(find.mock.calls.every(([args]) => args.collection.startsWith("kiv1_"))).toBe(true);
  });

  it("完整数据已存在时幂等跳过", async () => {
    const find = vi.fn()
      .mockResolvedValueOnce({ docs: [{ id: 1, name: TAOZI_SELLER_NAME }] })
      .mockResolvedValueOnce({ docs: [{ id: 2, wechatOpenid: TAOZI_OPERATOR_OPENID }] });
    const create = vi.fn();

    await expect(applySeed({ find, create })).resolves.toEqual({
      seeded: false,
      sellerId: 1,
      sellerCreated: false,
      operatorCreated: false
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("seller 已存在但 operator 缺失时只补 operator", async () => {
    const find = vi.fn()
      .mockResolvedValueOnce({ docs: [{ id: "seller-1" }] })
      .mockResolvedValueOnce({ docs: [] });
    const create = vi.fn().mockResolvedValue({ id: "operator-1" });

    await expect(applySeed({ find, create })).resolves.toMatchObject({
      seeded: true,
      sellerCreated: false,
      operatorCreated: true
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      collection: "kiv1_operators",
      data: buildOperatorData("seller-1"),
      overrideAccess: true
    });
  });

  it("operator 创建失败后可从已创建 seller 重试恢复", async () => {
    let seller: { id: number } | undefined;
    let operator: { id: number } | undefined;
    let failOperatorOnce = true;
    const find = vi.fn(async ({ collection }: { collection: string }) => ({
      docs: collection === "kiv1_sellers" ? (seller ? [seller] : []) : (operator ? [operator] : [])
    }));
    const create = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === "kiv1_sellers") return seller = { id: 1 };
      if (failOperatorOnce) {
        failOperatorOnce = false;
        throw new Error("temporary failure");
      }
      return operator = { id: 2 };
    });

    await expect(applySeed({ find, create })).rejects.toThrow("temporary failure");
    await expect(applySeed({ find, create })).resolves.toMatchObject({
      sellerCreated: false,
      operatorCreated: true
    });
    expect(create.mock.calls.filter(([args]) => args.collection === "kiv1_sellers")).toHaveLength(1);
  });
});

describe("v1 reset collection 顺序", () => {
  it("只包含七个 kiv1_ collection，并按外键安全顺序排列", () => {
    expect(RESET_COLLECTIONS).toEqual([
      "kiv1_orders",
      "kiv1_booking_batches",
      "kiv1_meal_slots",
      "kiv1_customer_profiles",
      "kiv1_offerings",
      "kiv1_operators",
      "kiv1_sellers"
    ]);
    expect(RESET_COLLECTIONS.every((slug) => slug.startsWith("kiv1_"))).toBe(true);
  });

  it("按外键安全顺序删除并汇总每个 kiv1 collection", async () => {
    const find = vi.fn(async ({ collection }: { collection: string }) => ({
      docs: [{ id: `${collection}-1` }, { id: `${collection}-2` }]
    }));
    const deleteDoc = vi.fn(async (_args: { collection: string; id: string | number; overrideAccess: boolean }) => undefined);

    await expect(resetSeedData({ find, delete: deleteDoc })).resolves.toEqual({
      deleted: Object.fromEntries(RESET_COLLECTIONS.map((collection) => [collection, 2]))
    });
    expect(find.mock.calls.map(([args]) => args.collection)).toEqual([...RESET_COLLECTIONS]);
    expect(deleteDoc).toHaveBeenCalledTimes(RESET_COLLECTIONS.length * 2);
    expect(deleteDoc.mock.calls[0]?.[0]).toEqual({
      collection: "kiv1_orders",
      id: "kiv1_orders-1",
      overrideAccess: true
    });
  });
});
