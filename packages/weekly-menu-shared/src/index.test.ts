import { describe, expect, it } from "vitest";
import {
  WEEK_DAYS,
  WEEKLY_MENU_CONTRACT_VERSION,
  WeeklyMenuDomainError,
  assertPlanCanDelete,
  confirmDraftPlan,
  copyConfirmedPlan,
  copyPlanInputSchema,
  bootstrapDtoSchema,
  createDishChecklist,
  dishChecklistDtoSchema,
  draftPlanDtoSchema,
  generateDraftPlan,
  generatePlanInputSchema,
  planListDtoSchema,
  planListQuerySchema,
  recipeCategorySchema,
  replaceDishInputSchema,
  replaceDraftPlanDish,
  weeklyMenuPlanDtoSchema,
  weeklyPlanSchema,
  type DishPools,
  type DraftPlanDto
} from "./index";

const ownership = { actorId: "user-1", ownerId: "user-1" } as const;
const pools: DishPools = {
  bigMeat: ["红烧肉", "糖醋排骨"],
  smallMeat: ["番茄炒蛋", "青椒肉丝"],
  vegetable: ["清炒时蔬", "蒜蓉西兰花"]
};

function fixedRandom(): number {
  return 0;
}

function makeDraft(): DraftPlanDto {
  return generateDraftPlan(
    {
      id: "plan-1",
      weekStart: "2026-08-03",
      dishPools: pools
    },
    fixedRandom
  );
}

describe("共享契约", () => {
  it("解析版本化计划、分类与边界坐标", () => {
    const draft = makeDraft();
    expect(weeklyMenuPlanDtoSchema.parse(draft)).toEqual(draft);
    expect(draftPlanDtoSchema.parse(draft).contractVersion).toBe(
      WEEKLY_MENU_CONTRACT_VERSION
    );
    expect(recipeCategorySchema.parse("big-meat")).toBe("big-meat");
    expect(
      replaceDishInputSchema.parse({
        dayIndex: WEEK_DAYS.length - 1,
        mealIndex: 1,
        slot: "vegetable"
      })
    ).toEqual({
      dayIndex: WEEK_DAYS.length - 1,
      mealIndex: 1,
      slot: "vegetable"
    });
  });

  it("固定生成、bootstrap 与分页的最小传输契约", () => {
    const draft = makeDraft();
    expect(generatePlanInputSchema.parse({ weekStart: draft.weekStart })).toEqual({
      weekStart: draft.weekStart
    });
    expect(planListQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(
      planListDtoSchema.parse({
        contractVersion: WEEKLY_MENU_CONTRACT_VERSION,
        items: [draft],
        page: { limit: 20, offset: 0, hasMore: false }
      })
    ).toMatchObject({ items: [draft] });
    expect(
      bootstrapDtoSchema.parse({
        contractVersion: WEEKLY_MENU_CONTRACT_VERSION,
        latestDraft: draft
      })
    ).toMatchObject({ latestDraft: draft });

    expect(() => planListQuerySchema.parse({ limit: 51, offset: 0 })).toThrow();
    expect(() => generatePlanInputSchema.parse({ weekStart: "2026/08/03" })).toThrow();
    expect(() => generatePlanInputSchema.parse({ weekStart: "2026-08-04" })).toThrow(
      "weekStart 必须是周一"
    );
    expect(() =>
      draftPlanDtoSchema.parse({ ...draft, weekStart: "2026-08-04" })
    ).toThrow("weekStart 必须是周一");
    expect(() =>
      copyPlanInputSchema.parse({ id: "copy-1", weekStart: "2026-08-04" })
    ).toThrow("weekStart 必须是周一");
  });

  it("拒绝数据库字段、越界或混用的坐标和错误的星期/餐次顺序", () => {
    const draft = makeDraft();
    expect(() =>
      weeklyMenuPlanDtoSchema.parse({ ...draft, owner_identity_id: "db-id" })
    ).toThrow();
    expect(() =>
      replaceDishInputSchema.parse({
        dayIndex: WEEK_DAYS.length,
        mealIndex: 0,
        slot: "bigMeat"
      })
    ).toThrow();
    expect(() =>
      replaceDishInputSchema.parse({
        dayIndex: 0,
        mealIndex: 0,
        slot: "big-meat"
      })
    ).toThrow();

    const wrongDayOrder = structuredClone(draft.days);
    wrongDayOrder[0]!.day = "周二";
    expect(() => weeklyPlanSchema.parse(wrongDayOrder)).toThrow("菜单日期顺序无效");

    const wrongMealOrder = structuredClone(draft.days);
    wrongMealOrder[0]!.meals[0]!.label = "晚餐";
    expect(() => weeklyPlanSchema.parse(wrongMealOrder)).toThrow("餐次顺序无效");
  });
});

describe("纯领域规则", () => {
  it("通过 menu-core 生成草稿，并在不修改原值的情况下换菜", () => {
    const draft = makeDraft();
    const previousName = draft.days[0]!.meals[0]!.bigMeat;
    const replaced = replaceDraftPlanDish(
      draft,
      ownership,
      { dayIndex: 0, mealIndex: 0, slot: "bigMeat" },
      pools,
      undefined,
      fixedRandom
    );

    expect(draft.status).toBe("draft");
    expect(draft.days[0]!.meals[0]!.bigMeat).toBe(previousName);
    expect(replaced.days[0]!.meals[0]!.bigMeat).not.toBe(previousName);
  });

  it("所有计划操作都拒绝非所有者", () => {
    const draft = makeDraft();
    const confirmed = confirmDraftPlan(draft, ownership, "2026-08-01T08:00:00Z");
    const forbiddenOwnership = { actorId: "user-2", ownerId: "user-1" };
    const operations = [
      () =>
        replaceDraftPlanDish(
          draft,
          forbiddenOwnership,
          { dayIndex: 0, mealIndex: 0, slot: "bigMeat" },
          pools
        ),
      () =>
        confirmDraftPlan(draft, forbiddenOwnership, "2026-08-01T08:00:00Z"),
      () => assertPlanCanDelete(draft, forbiddenOwnership),
      () =>
        copyConfirmedPlan(confirmed, forbiddenOwnership, {
          id: "plan-2",
          weekStart: "2026-08-10"
        }),
      () => createDishChecklist(confirmed, forbiddenOwnership)
    ];

    for (const operation of operations) {
      expect(operation).toThrowError(
        expect.objectContaining<Partial<WeeklyMenuDomainError>>({
          code: "PLAN_FORBIDDEN",
          name: "WeeklyMenuDomainError"
        })
      );
    }

    for (const invalidOwnership of [
      { actorId: "", ownerId: "user-1" },
      { actorId: "   ", ownerId: "user-1" },
      { actorId: "user-1", ownerId: "" },
      { actorId: "user-1", ownerId: "   " }
    ]) {
      expect(() => assertPlanCanDelete(draft, invalidOwnership)).toThrowError(
        expect.objectContaining({ code: "PLAN_FORBIDDEN" })
      );
    }
  });

  it("仅允许 draft 确认和删除，并保持 confirmed 不可变", () => {
    const draft = makeDraft();
    expect(assertPlanCanDelete(draft, ownership)).toBeUndefined();

    const confirmed = confirmDraftPlan(draft, ownership, "2026-08-01T08:00:00Z");
    expect(confirmed.status).toBe("confirmed");
    expect(draft.status).toBe("draft");

    expect(() => assertPlanCanDelete(confirmed, ownership)).toThrowError(
      expect.objectContaining({ code: "PLAN_IMMUTABLE" })
    );
    expect(() =>
      replaceDraftPlanDish(
        confirmed,
        ownership,
        { dayIndex: 0, mealIndex: 0, slot: "bigMeat" },
        pools
      )
    ).toThrowError(expect.objectContaining({ code: "PLAN_IMMUTABLE" }));
    expect(() =>
      confirmDraftPlan(confirmed, ownership, "2026-08-02T08:00:00Z")
    ).toThrowError(expect.objectContaining({ code: "PLAN_IMMUTABLE" }));
  });

  it("仅从 confirmed 计划复制出独立 draft", () => {
    const draft = makeDraft();
    expect(() =>
      copyConfirmedPlan(draft, ownership, {
        id: "plan-2",
        weekStart: "2026-08-10"
      })
    ).toThrowError(expect.objectContaining({ code: "PLAN_NOT_CONFIRMED" }));

    const confirmed = confirmDraftPlan(draft, ownership, "2026-08-01T08:00:00Z");
    expect(() =>
      copyConfirmedPlan(confirmed, ownership, {
        id: confirmed.id,
        weekStart: "2026-08-10"
      })
    ).toThrowError(expect.objectContaining({ code: "PLAN_COPY_ID_CONFLICT" }));

    const copied = copyConfirmedPlan(confirmed, ownership, {
      id: "plan-2",
      weekStart: "2026-08-10"
    });

    expect(copied).toMatchObject({
      id: "plan-2",
      weekStart: "2026-08-10",
      sourcePlanId: "plan-1",
      status: "draft",
      confirmedAt: null
    });
    expect(copied.days).toEqual(confirmed.days);
    expect(copied.days).not.toBe(confirmed.days);
    expect(copied.days[0]!.meals).not.toBe(confirmed.days[0]!.meals);
    expect(copied.days[0]!.meals[0]).not.toBe(confirmed.days[0]!.meals[0]);
  });

  it("菜品勾选清单仅从 confirmed plan 菜名去重，不包含 checked 或食材", () => {
    const draft = makeDraft();
    expect(() => createDishChecklist(draft, ownership)).toThrowError(
      expect.objectContaining({ code: "PLAN_NOT_CONFIRMED" })
    );

    const confirmed = confirmDraftPlan(draft, ownership, "2026-08-01T08:00:00Z");
    const checklist = createDishChecklist(confirmed, ownership);
    const planDishNames = confirmed.days.flatMap((day) =>
      day.meals.flatMap((meal) => [meal.bigMeat, meal.smallMeat, meal.vegetable])
    );
    expect(dishChecklistDtoSchema.parse(checklist)).toEqual(checklist);
    expect(checklist.planId).toBe("plan-1");
    expect(checklist.items.map((item) => item.name)).toEqual(
      [...new Set(planDishNames)]
    );
    expect(checklist.items[0]).toEqual({ name: expect.any(String) });
    expect(checklist.items[0]).not.toHaveProperty("checked");
    expect(checklist.items[0]).not.toHaveProperty("ingredients");
    expect(checklist.items[0]).not.toHaveProperty("quantity");
    expect(() =>
      dishChecklistDtoSchema.parse({
        ...checklist,
        items: [
          {
            ...checklist.items[0],
            checked: false,
            ingredients: [],
            quantity: 1
          }
        ]
      })
    ).toThrow();
    expect(() =>
      dishChecklistDtoSchema.parse({
        ...checklist,
        items: [
          { name: checklist.items[0]!.name },
          { name: `  ${checklist.items[0]!.name}  ` }
        ]
      })
    ).toThrow("菜品清单不能包含重复菜名");
  });
});
