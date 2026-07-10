import type { CollectionConfig, Field } from "payload";
import { describe, expect, it } from "vitest";
import {
  trimText,
  validateCalendarDate,
  validateNonNegativeInteger,
  validatePositiveInteger
} from "./collections/shared";
import { assertSameSellerRefs } from "./hooks/assertSameSellerRefs";
import { collections } from "./index";

const expectedFields: Record<string, string[]> = {
  kiv1_sellers: ["name", "defaultPriceCents", "status"],
  kiv1_operators: ["seller", "wechatOpenid", "active"],
  kiv1_customer_profiles: ["seller", "openid", "displayName", "address", "lastUsedAt", "active"],
  kiv1_offerings: ["seller", "name", "mainIngredient", "category", "active"],
  kiv1_meal_slots: ["seller", "date", "occasion", "menuItems", "orderStatus", "orderDeadline", "priceCents", "generatedAt"],
  kiv1_booking_batches: ["seller", "publicId", "title", "status", "mealSlots", "createdBy"],
  kiv1_orders: [
    "seller", "mealSlot", "customerProfile", "customerOpenid", "status", "source",
    "displayName", "address", "quantity", "unitPriceCents", "paymentStatus", "paidAt",
    "deliveryStatus", "deliveredAt", "confirmedAt", "canceledAt", "note"
  ]
};

const expectedIndexes: Record<string, Array<{ fields: string[]; unique?: boolean }>> = {
  kiv1_operators: [{ fields: ["seller", "wechatOpenid"], unique: true }],
  kiv1_customer_profiles: [{ fields: ["seller", "openid", "active"] }],
  kiv1_offerings: [
    { fields: ["seller", "name"], unique: true },
    { fields: ["seller", "active", "category"] }
  ],
  kiv1_meal_slots: [
    { fields: ["seller", "date", "occasion"], unique: true },
    { fields: ["seller", "orderStatus"] }
  ],
  kiv1_booking_batches: [{ fields: ["seller", "status"] }],
  kiv1_orders: [
    { fields: ["seller", "mealSlot", "customerProfile"], unique: true },
    { fields: ["seller", "mealSlot", "status"] },
    { fields: ["seller", "customerOpenid"] }
  ]
};

function namedFields(fields: Field[]): string[] {
  return fields.flatMap((field) => "name" in field ? [field.name] : []);
}

function relationshipTargets(fields: Field[]): string[] {
  return fields.flatMap((field) => {
    if (field.type === "relationship") {
      return Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo];
    }
    if (field.type === "array") return relationshipTargets(field.fields);
    return [];
  });
}

function collection(slug: string): CollectionConfig {
  return collections.find((item) => item.slug === slug)!;
}

function field(slug: string, name: string): Field & { name: string } {
  return collection(slug).fields.find((item): item is Field & { name: string } =>
    "name" in item && item.name === name)!;
}

describe("kith-inn-v1 collections", () => {
  it("按稳定顺序只导出七个 kiv1_ collection/table", () => {
    expect(collections.map((item) => item.slug)).toEqual(Object.keys(expectedFields));
    for (const item of collections) {
      expect(item.slug).toMatch(/^kiv1_/);
      expect(String(item.dbName ?? item.slug)).toMatch(/^kiv1_/);
    }
  });

  it("所有 Admin group 都使用街坊味 v1 命名空间", () => {
    for (const item of collections) expect(String(item.admin?.group)).toMatch(/^街坊味 v1/);
  });

  it("字段集合与七实体数据模型一致", () => {
    for (const item of collections) expect(namedFields(item.fields)).toEqual(expectedFields[item.slug]);
  });

  it("所有 relationship 只指向 kiv1_ collection", () => {
    for (const item of collections) {
      for (const target of relationshipTargets(item.fields)) expect(target).toMatch(/^kiv1_/);
    }
  });

  it("声明全部普通复合索引", () => {
    for (const [slug, indexes] of Object.entries(expectedIndexes)) {
      expect(collection(slug).indexes).toEqual(indexes);
    }
  });

  it("声明 seller/status/openid/publicId 等单字段索引", () => {
    expect(field("kiv1_sellers", "status")).toMatchObject({ index: true });
    for (const item of collections.slice(1)) expect(field(item.slug, "seller")).toMatchObject({ required: true, index: true });
    expect(field("kiv1_customer_profiles", "openid")).toMatchObject({ index: true });
    expect(field("kiv1_booking_batches", "publicId")).toMatchObject({ unique: true });
    expect(field("kiv1_orders", "customerOpenid")).toMatchObject({ index: true });
  });

  it("固定关键 relationship、has-many 与菜单嵌套字段", () => {
    expect(field("kiv1_booking_batches", "mealSlots")).toMatchObject({
      type: "relationship",
      relationTo: "kiv1_meal_slots",
      hasMany: true,
      required: true,
      minRows: 1
    });
    expect(field("kiv1_booking_batches", "createdBy")).toMatchObject({ relationTo: "kiv1_operators", required: true });
    expect(field("kiv1_orders", "customerProfile")).toMatchObject({ relationTo: "kiv1_customer_profiles", required: false });

    const menuItems = field("kiv1_meal_slots", "menuItems");
    expect(menuItems).toMatchObject({ type: "array" });
    expect(relationshipTargets(menuItems.type === "array" ? menuItems.fields : [])).toEqual(["kiv1_offerings"]);
  });

  it("Payload 字段层复用日历日、整数和 trim 约束", () => {
    expect(trimText({ value: " 桃子 " })).toBe("桃子");
    expect(trimText({ value: null })).toBeNull();
    expect(validateCalendarDate("2026-07-10")).toBe(true);
    expect(validateCalendarDate("2026-02-30")).toBeTypeOf("string");
    expect(validateCalendarDate(undefined)).toBe(true);
    expect(validateNonNegativeInteger(0)).toBe(true);
    expect(validateNonNegativeInteger(-1)).toBeTypeOf("string");
    expect(validatePositiveInteger(1)).toBe(true);
    expect(validatePositiveInteger(0)).toBeTypeOf("string");
  });

  it("kiv1_operators 是普通业务 collection，不启用 Payload auth", () => {
    expect(collection("kiv1_operators").auth).not.toBe(true);
  });

  it("所有 collection 默认拒绝匿名请求并允许共享 CMS 已认证用户", () => {
    for (const item of collections) {
      const access = item.access as Record<string, (args: { req: { user?: unknown } }) => unknown>;
      for (const operation of ["read", "create", "update"] as const) {
        expect(access[operation]!({ req: {} }), `${item.slug}.${operation} anonymous`).toBe(false);
        expect(access[operation]!({ req: { user: { id: 1 } } }), `${item.slug}.${operation} admin`).toBe(true);
      }
      expect(access.delete!({ req: { user: { id: 1 } } }), `${item.slug}.delete admin`).toBe(
        item.slug === "kiv1_sellers" ? false : true
      );
    }
  });

  it("每个 seller-owned collection 都装配同 seller relationship guard", () => {
    for (const item of collections.slice(1)) {
      expect(item.hooks?.beforeChange).toContain(assertSameSellerRefs);
    }
  });
});
