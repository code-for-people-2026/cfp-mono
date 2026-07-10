import type { Field } from "payload";
import { describe, expect, it, vi } from "vitest";
import { assertSameSellerRefs, collectRelationshipRefs } from "./assertSameSellerRefs";

const fields: Field[] = [
  { name: "seller", type: "relationship", relationTo: "kiv1_sellers" },
  { name: "createdBy", type: "relationship", relationTo: "kiv1_operators" },
  { name: "mealSlots", type: "relationship", relationTo: "kiv1_meal_slots", hasMany: true },
  {
    name: "menuItems",
    type: "array",
    fields: [{ name: "offering", type: "relationship", relationTo: "kiv1_offerings" }]
  }
];

describe("collectRelationshipRefs", () => {
  it("收集顶层、has-many 和嵌套 array relationship", () => {
    expect(collectRelationshipRefs({
      seller: 1,
      createdBy: { id: "operator-1" },
      mealSlots: [2, { id: 3 }, null],
      menuItems: [{ offering: 4 }, { offering: { id: 5 } }]
    }, fields)).toEqual([
      { relationTo: "kiv1_sellers", id: 1 },
      { relationTo: "kiv1_operators", id: "operator-1" },
      { relationTo: "kiv1_meal_slots", id: 2 },
      { relationTo: "kiv1_meal_slots", id: 3 },
      { relationTo: "kiv1_offerings", id: 4 },
      { relationTo: "kiv1_offerings", id: 5 }
    ]);
  });

  it("忽略缺失数据、非 relationship 字段和无效引用", () => {
    expect(collectRelationshipRefs(undefined, fields)).toEqual([]);
    expect(collectRelationshipRefs({}, undefined)).toEqual([]);
    expect(collectRelationshipRefs({ menuItems: null }, fields)).toEqual([]);
    expect(collectRelationshipRefs({
      createdBy: { id: true },
      menuItems: [null, "invalid-row"]
    }, [{ type: "row", fields: [] }, ...fields])).toEqual([]);
  });
});

describe("assertSameSellerRefs", () => {
  it("create 使用 data.seller 并允许同 seller 的全部引用", async () => {
    const findByID = vi.fn(async ({ collection, id }: { collection: string; id: string | number }) =>
      collection === "kiv1_sellers" ? { id } : { id, seller: 1 });
    const data = {
      seller: 1,
      createdBy: 10,
      mealSlots: [20, 21],
      menuItems: [{ offering: 30 }]
    };

    await expect(assertSameSellerRefs({
      data,
      collection: { slug: "kiv1_booking_batches", fields },
      req: { payload: { findByID } }
    })).resolves.toBe(data);
    expect(findByID).toHaveBeenCalledTimes(5);
  });

  it("update 从 originalDoc 取 seller，并校验未随 patch 重传的原关系", async () => {
    const findByID = vi.fn(async ({ id }: { id: string | number }) => ({ id, seller: { id: "seller-1" } }));
    const data = { title: "更新标题" };

    await expect(assertSameSellerRefs({
      data,
      originalDoc: { seller: "seller-1", createdBy: 10 },
      collection: { slug: "kiv1_booking_batches", fields },
      req: { payload: { findByID } }
    })).resolves.toBe(data);
    expect(findByID).toHaveBeenCalledWith({
      collection: "kiv1_operators",
      id: 10,
      overrideAccess: true
    });
  });

  it("任一跨 seller 引用使整个写入失败", async () => {
    const findByID = vi.fn(async ({ collection, id }: { collection: string; id: string | number }) =>
      collection === "kiv1_sellers" ? { id } : { id, seller: 2 });

    await expect(assertSameSellerRefs({
      data: { seller: 1, createdBy: 10 },
      collection: { slug: "kiv1_booking_batches", fields },
      req: { payload: { findByID } }
    })).rejects.toThrow("跨 seller relationship 被拒绝");
  });

  it("跳过不存在或没有 seller 的目标记录", async () => {
    const findByID = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 20 });
    const data = { seller: 1, createdBy: 10, mealSlots: [20] };

    await expect(assertSameSellerRefs({
      data,
      collection: { slug: "kiv1_booking_batches", fields },
      req: { payload: { findByID } }
    })).resolves.toBe(data);
  });

  it("没有有效 seller 时把必填校验留给 collection 字段", async () => {
    const findByID = vi.fn();
    const data = { createdBy: 10 };
    await expect(assertSameSellerRefs({
      data,
      collection: { slug: "kiv1_booking_batches", fields },
      req: { payload: { findByID } }
    })).resolves.toBe(data);
    expect(findByID).not.toHaveBeenCalled();
  });

  it("没有 data 时返回空写入对象", async () => {
    await expect(assertSameSellerRefs({
      data: undefined,
      collection: { slug: "kiv1_booking_batches", fields },
      req: { payload: { findByID: vi.fn() } }
    })).resolves.toEqual({});
  });
});
