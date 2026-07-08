import type { Offering } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import {
  createOffering,
  deactivateOffering,
  parseOfferingImport,
  partitionByActive,
  restoreOffering,
  updateOffering,
  type Req,
} from "./offeringsCrud";

type ReqOptions = Parameters<Req>[0];

const offering = (over: Partial<Offering> = {}): Offering =>
  ({ id: 1, name: "X", kind: "component", seller: 7, ...over }) as Offering;

/** A fake Req that records the last call's options and returns `resp`. */
const recordingReq = (resp: { statusCode: number; data: unknown }): { req: Req; cap: { v?: ReqOptions } } => {
  const cap: { v?: ReqOptions } = {};
  const req = vi.fn(async (o: ReqOptions) => {
    cap.v = o;
    return resp;
  }) as unknown as Req;
  return { req, cap };
};

describe("createOffering", () => {
  it("POSTs to /offerings with name + mainIngredient + category + Bearer, returns offering", async () => {
    const created = offering({ id: 14, name: "蒜蓉空心菜", category: "veg" });
    const { req, cap } = recordingReq({ statusCode: 201, data: { offering: created } });
    await expect(createOffering({ token: "t", name: "蒜蓉空心菜", mainIngredient: "青菜", category: "veg" }, req)).resolves.toEqual(created);
    expect(cap.v?.url).toMatch(/\/offerings$/);
    expect(cap.v?.method).toBe("POST");
    expect(cap.v?.header).toMatchObject({ Authorization: "Bearer t", "content-type": "application/json" });
    expect(cap.v?.data).toEqual({ name: "蒜蓉空心菜", mainIngredient: "青菜", category: "veg" });
  });

  it("throws on non-2xx", async () => {
    const req = vi.fn(async () => ({ statusCode: 400, data: { error: "bad" } })) as unknown as Req;
    await expect(createOffering({ token: "t", name: "", category: "meat" }, req)).rejects.toThrow();
  });
});

describe("updateOffering", () => {
  it("PATCHes /offerings/:id with the patch subset, returns offering", async () => {
    const updated = offering({ id: 12, name: "西红柿炒蛋" });
    const cap: { v?: ReqOptions } = {};
    const req = vi.fn(async (o: ReqOptions) => {
      cap.v = o;
      return { statusCode: 200, data: { offering: updated } };
    }) as unknown as Req;
    await expect(updateOffering({ token: "t", id: 12, patch: { name: "西红柿炒蛋" } }, req)).resolves.toEqual(updated);
    expect(cap.v?.url).toMatch(/\/offerings\/12$/);
    expect(cap.v?.method).toBe("PATCH");
    expect(cap.v?.data).toEqual({ name: "西红柿炒蛋" });
  });
});

describe("deactivateOffering", () => {
  it("DELETEs /offerings/:id, resolves void on 200", async () => {
    const cap: { v?: ReqOptions } = {};
    const req = vi.fn(async (o: ReqOptions) => {
      cap.v = o;
      return { statusCode: 200, data: { ok: true } };
    }) as unknown as Req;
    await expect(deactivateOffering({ token: "t", id: 14 }, req)).resolves.toBeUndefined();
    expect(cap.v?.url).toMatch(/\/offerings\/14$/);
    expect(cap.v?.method).toBe("DELETE");
    expect(cap.v?.header).toMatchObject({ Authorization: "Bearer t" });
  });

  it("throws on non-2xx", async () => {
    const req = vi.fn(async () => ({ statusCode: 404, data: { error: "not found" } })) as unknown as Req;
    await expect(deactivateOffering({ token: "t", id: 99 }, req)).rejects.toThrow();
  });
});

describe("restoreOffering", () => {
  it("POSTs /offerings/:id/restore, resolves void on 200", async () => {
    const cap: { v?: ReqOptions } = {};
    const req = vi.fn(async (o: ReqOptions) => {
      cap.v = o;
      return { statusCode: 200, data: { ok: true } };
    }) as unknown as Req;
    await expect(restoreOffering({ token: "t", id: 14 }, req)).resolves.toBeUndefined();
    expect(cap.v?.url).toMatch(/\/offerings\/14\/restore$/);
    expect(cap.v?.method).toBe("POST");
  });

  it("throws on non-2xx", async () => {
    const req = vi.fn(async () => ({ statusCode: 404, data: { error: "not found" } })) as unknown as Req;
    await expect(restoreOffering({ token: "t", id: 99 }, req)).rejects.toThrow();
  });
});

describe("partitionByActive", () => {
  it("splits active (true/undefined) vs inactive (false)", () => {
    const { active, inactive } = partitionByActive([
      offering({ id: 1, active: true }),
      offering({ id: 2, active: false }),
      offering({ id: 3 }), // undefined → active
    ]);
    expect(active.map((o) => o.id)).toEqual([1, 3]);
    expect(inactive.map((o) => o.id)).toEqual([2]);
  });

  it("empty input → both empty", () => {
    expect(partitionByActive([])).toEqual({ active: [], inactive: [] });
  });
});

describe("parseOfferingImport", () => {
  it("parses one dish per line with name, optional ingredient, and category", () => {
    expect(
      parseOfferingImport(`
        番茄炒蛋 鸡蛋 素
        红烧牛肉 牛肉 荤
        冬瓜排骨汤 冬瓜 汤
        米饭 主食
      `),
    ).toEqual({
      items: [
        { name: "番茄炒蛋", mainIngredient: "鸡蛋", category: "veg" },
        { name: "红烧牛肉", mainIngredient: "牛肉", category: "meat" },
        { name: "冬瓜排骨汤", mainIngredient: "冬瓜", category: "soup" },
        { name: "米饭", mainIngredient: undefined, category: "staple" },
      ],
      errors: [],
    });
  });

  it("accepts bullets and reports invalid or duplicate lines", () => {
    const parsed = parseOfferingImport(
      `
        1. 番茄炒蛋 鸡蛋 素
        - 红烧牛肉 牛肉 荤
        凉拌黄瓜 黄瓜
        番茄炒蛋 鸡蛋 素
        米饭 主食
      `,
      new Set(["米饭"]),
    );

    expect(parsed.items).toEqual([
      { name: "番茄炒蛋", mainIngredient: "鸡蛋", category: "veg" },
      { name: "红烧牛肉", mainIngredient: "牛肉", category: "meat" },
    ]);
    expect(parsed.errors.map((e) => ({ line: e.line, reason: e.reason }))).toEqual([
      { line: 4, reason: "缺少分类（荤/素/汤/主食）" },
      { line: 5, reason: "菜名重复，已跳过" },
      { line: 6, reason: "菜名重复，已跳过" },
    ]);
  });

  it("rejects category-only lines", () => {
    expect(parseOfferingImport("荤")).toEqual({
      items: [],
      errors: [{ line: 1, text: "荤", reason: "缺少菜名" }],
    });
  });
});
