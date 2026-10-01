import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import * as contracts from "./index";
import examples from "../../../specs/022-kith-inn-menu-mvp/contracts/examples.json";
import openapi from "../../../specs/022-kith-inn-menu-mvp/contracts/openapi.json";

const schemas = contracts as unknown as Record<string, ZodType>;
const id = "11111111-1111-4111-8111-000000000001";
const other = "11111111-1111-4111-8111-000000000002";
const date = "2026-09-21";
const time = "2026-09-20T10:00:00+08:00";
function write(weekStart = date): contracts.WeekWriteInput {
  return {
    baseVersion: 0, rebuild: true, confirm: false, structure: { meat: 1, vegetable: 0, soup: 0 },
    meals: Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.parse(`${weekStart}T00:00:00Z`) + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10),
      mealType: i % 2 === 0 ? "lunch" : "dinner", enabled: true, soupOmitted: false, meat: [id], vegetable: [], soup: [],
    })),
  };
}
function preview(): contracts.MenuPreview {
  const value = write();
  return { weekStart: date, structure: value.structure, meals: value.meals.map((m) => ({
    ...m, meat: [{ dishId: id, name: "红烧肉" }], vegetable: [], soup: [],
  })) };
}

describe("OpenAPI fixture parity", () => {
  it("provides a schema for every named OpenAPI component", () => {
    for (const name of Object.keys(openapi.components.schemas)) expect(schemas[`${name}Schema`]).toBeDefined();
  });
  for (const group of ["valid", "invalid"] as const) {
    it.each<{ name: string; schema: string; value: unknown }>(examples[group])(`${group}: $name`, ({ schema, value }) => {
      expect(schemas[`${schema}Schema`]!.safeParse(value).success).toBe(group === "valid");
    });
  }
});

it("rejects unknown fields on every DTO, including nested trust boundaries", () => {
  const dish = { id, name: "红烧肉", category: "meat", active: false, version: 1, createdAt: time, updatedAt: time };
  const fixtures: Record<string, unknown> = {
    Structure: write().structure, DishInput: { name: "汤", category: "soup" }, Dish: dish,
    DishList: { items: [dish] }, DishBatchInput: { items: [{ name: "汤", category: "soup" }] },
    DishBatchResult: { items: [dish] }, DishUpdateInput: { baseVersion: 1, name: "汤", category: "soup", active: true },
    DishDeleteInput: { baseVersion: 1 }, DishDeleteResult: { id },
    SnapshotItem: { dishId: id, name: "汤" }, MealSnapshot: preview().meals[0], MealInput: write().meals[0],
    MealSelection: { date, mealType: "lunch", enabled: true },
    GenerateInput: { structure: write().structure, meals: write().meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) },
    MenuPreview: preview(), WeekPlan: { ...preview(), id, version: 1, confirmedAt: null, createdAt: time, updatedAt: time },
    WeekWriteInput: write(), WeekSummary: { weekStart: date, version: 1, confirmedAt: time, updatedAt: time },
    WeekList: { items: [], nextBefore: null }, LoginInput: { code: "wx-code" }, Session: { token: "a".repeat(43), expiresAt: time },
    ErrorDetails: {}, ErrorResponse: { error: { code: "UNAUTHORIZED", message: "请登录", requestId: id } }, Health: { status: "ready" },
  };
  expect(Object.keys(fixtures).sort()).toEqual(Object.keys(openapi.components.schemas).sort());
  for (const [name, value] of Object.entries(fixtures)) {
    const schema = schemas[`${name}Schema`]!;
    expect(schema.safeParse(value).success, name).toBe(true);
    expect(schema.safeParse({ ...(value as object), ownerId: id }).success, name).toBe(false);
  }
  expect(contracts.DishBatchInputSchema.safeParse({ items: [{ name: "汤", category: "soup", ownerId: id }] }).success).toBe(false);
  expect(contracts.ErrorResponseSchema.safeParse({ error: { code: "UNAUTHORIZED", message: "请登录", requestId: id, token: "secret" } }).success).toBe(false);
});

it("counts Unicode code points and rejects non-normalized names without transforming input", () => {
  for (const name of [" 红烧肉", "汤 ", "", "e\u0301", "汤\n菜", "汤\u0085菜", "汤\u2028菜", "汤\u2029菜", "😀".repeat(61)]) {
    expect(contracts.DishNameSchema.safeParse(name).success).toBe(false);
  }
  for (const name of ["😀".repeat(60), "é", "A  B", "红烧肉"]) expect(contracts.DishNameSchema.parse(name)).toBe(name);
});

it("validates calendar dates, Monday boundaries, leap days and year transitions", () => {
  for (const day of ["2026-02-29", "2026-13-01", "2026-9-21", "2026-09-22"]) {
    expect(contracts.WeekStartSchema.safeParse(day).success).toBe(false);
  }
  for (const monday of ["2024-02-26", "2025-12-29"]) expect(contracts.WeekWriteInputSchema.safeParse(write(monday)).success).toBe(true);
});

it("rejects missing, duplicate, unordered and out-of-week meal positions", () => {
  const mutations = [
    (v: contracts.WeekWriteInput) => { v.meals.pop(); },
    (v: contracts.WeekWriteInput) => { v.meals[1] = v.meals[0]!; },
    (v: contracts.WeekWriteInput) => { v.meals.reverse(); },
    (v: contracts.WeekWriteInput) => { v.meals[13]!.date = "2026-09-28"; },
  ];
  for (const mutate of mutations) { const value = write(); mutate(value); expect(contracts.WeekWriteInputSchema.safeParse(value).success).toBe(false); }
  expect(contracts.MenuPreviewSchema.safeParse({ ...preview(), weekStart: "2026-09-28" }).success).toBe(false);
});

it("requires complete meals for both ordinary saves and confirmation, preserving hidden soup", () => {
  for (const confirm of [false, true]) {
    const value = write(); value.confirm = confirm; value.meals[0]!.meat = [];
    expect(contracts.WeekWriteInputSchema.safeParse(value).success).toBe(false);
  }
  const value = write(); value.meals[0]!.soupOmitted = true;
  expect(contracts.WeekWriteInputSchema.safeParse(value).success).toBe(false);
  value.structure.soup = 1;
  for (const meal of value.meals) meal.soup = [other];
  expect(contracts.WeekWriteInputSchema.safeParse(value).success).toBe(true);
  value.meals[0]!.soup = [];
  expect(contracts.WeekWriteInputSchema.safeParse(value).success).toBe(false);
  const skipped = write(); skipped.meals[0]!.enabled = false;
  expect(contracts.WeekWriteInputSchema.safeParse(skipped).success).toBe(false);
  skipped.meals[0]!.meat = [];
  expect(contracts.WeekWriteInputSchema.safeParse(skipped).success).toBe(true);
  skipped.meals[0]!.soupOmitted = true;
  expect(contracts.WeekWriteInputSchema.safeParse(skipped).success).toBe(false);
});

it("allows cross-meal reuse, rejects same-meal duplicate IDs, and validates response snapshots", () => {
  expect(contracts.WeekWriteInputSchema.safeParse(write()).success).toBe(true);
  const value = write(); value.structure.vegetable = 1;
  for (const meal of value.meals) meal.vegetable = [id];
  expect(contracts.WeekWriteInputSchema.safeParse(value).success).toBe(false);
  const response = preview(); response.structure.meat = 2;
  expect(contracts.MenuPreviewSchema.safeParse(response).success).toBe(false);
});

it("checks bounded structures, batch limits, versions and initial rebuild intent", () => {
  for (const structure of [{ meat: 0, vegetable: 0, soup: 0 }, { meat: 10, vegetable: 10, soup: 1 }, { meat: 11, vegetable: 0, soup: 0 }, { meat: 0.5, vegetable: 1, soup: 0 }]) {
    expect(contracts.StructureSchema.safeParse(structure).success).toBe(false);
  }
  expect(contracts.StructureSchema.safeParse({ meat: 10, vegetable: 10, soup: 0 }).success).toBe(true);
  for (const length of [0, 201]) expect(contracts.DishBatchInputSchema.safeParse({ items: Array.from({ length }, () => ({ name: "汤", category: "soup" })) }).success).toBe(false);
  for (const baseVersion of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(contracts.WeekWriteInputSchema.safeParse({ ...write(), baseVersion }).success).toBe(false);
  expect(contracts.WeekWriteInputSchema.safeParse({ ...write(), rebuild: false }).success).toBe(false);
  expect(contracts.WeekWriteInputSchema.safeParse({ ...write(), baseVersion: 1, rebuild: false }).success).toBe(true);
});

it("validates shortages, safe errors, session shape and parsed pagination", () => {
  const error = { code: "INSUFFICIENT_DISHES", message: "请补菜", requestId: id };
  expect(contracts.ErrorResponseSchema.safeParse({ error }).success).toBe(false);
  const item = { category: "meat", required: 2, available: 1 };
  for (const shortages of [[], [item, item], [{ ...item, available: 2 }]]) expect(contracts.ErrorDetailsSchema.safeParse({ shortages }).success).toBe(false);
  expect(contracts.ErrorResponseSchema.safeParse({ error: { ...error, details: { shortages: [item] } } }).success).toBe(true);
  expect(contracts.SessionSchema.safeParse({ token: "secret", expiresAt: time }).success).toBe(false);
  expect(contracts.SessionSchema.safeParse({ token: "a".repeat(43), expiresAt: "2026-09-20T10:00:00" }).success).toBe(false);
  expect(contracts.WeekListQuerySchema.parse({})).toEqual({ limit: 12 });
  for (const value of [{ limit: 0 }, { limit: 53 }, { limit: "12" }, { before: "2026-09-22" }, { ownerId: id }]) expect(contracts.WeekListQuerySchema.safeParse(value).success).toBe(false);
});

it("compares UUID identity case-insensitively for writes and snapshots", () => {
  const dishId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const value = write(); value.structure.meat = 2;
  for (const meal of value.meals) meal.meat = [dishId, dishId.toUpperCase()];
  expect(contracts.WeekWriteInputSchema.safeParse(value).success).toBe(false);
  const response = preview(); response.structure.meat = 2;
  for (const meal of response.meals) meal.meat = value.meals[0]!.meat.map((dishId) => ({ dishId, name: "红烧肉" }));
  expect(contracts.MenuPreviewSchema.safeParse(response).success).toBe(false);
});
it.each([
  ["DUPLICATE_DISH_NAME", { names: ["红烧肉"] }, { names: [] }],
  ["VERSION_CONFLICT", { currentVersion: 0 }, { field: "version" }],
  ["LIMIT_EXCEEDED", { field: "items" }, { field: "" }],
])("requires actionable details for %s", (code, valid, invalid) => {
  const error = { code, message: "请检查", requestId: id };
  for (const details of [undefined, {}, invalid]) expect(contracts.ErrorResponseSchema.safeParse({ error: { ...error, details } }).success).toBe(false);
  expect(contracts.ErrorResponseSchema.safeParse({ error: { ...error, details: valid } }).success).toBe(true);
});
