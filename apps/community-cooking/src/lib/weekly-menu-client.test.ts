import { describe, expect, it } from "vitest";
import {
  WEEK_DAYS,
  WeeklyMenuDomainError,
  type DraftPlanDto
} from "@cfp/weekly-menu-shared";
import {
  MockClientError,
  createMockWeeklyMenuClient
} from "./weekly-menu-client";

const fixedNow = () => new Date("2026-07-31T08:00:00Z");
const fixedRandom = () => 0;

describe("Mock Weekly Menu adapter", () => {
  it("覆盖登录、生成、换菜、保存、确认、历史、清单、复制与删除", async () => {
    let sequence = 0;
    const client = createMockWeeklyMenuClient({
      now: fixedNow,
      random: fixedRandom,
      nextId: () => `plan-${(sequence += 1)}`
    });

    expect(await client.restoreSession()).toBeNull();
    await expect(client.generateDraft()).rejects.toMatchObject({
      code: "LOGIN_REQUIRED"
    } satisfies Partial<MockClientError>);

    const session = await client.login();
    expect(session).toEqual({ userId: "mock-user", displayName: "学习用户" });
    expect(await client.restoreSession()).toEqual(session);

    const draft = await client.generateDraft();
    expect(draft).toMatchObject({
      id: "plan-1",
      weekStart: "2026-07-27",
      status: "draft"
    });
    expect(draft.days).toHaveLength(WEEK_DAYS.length);
    expect(draft.days.every((day) => day.meals.length === 2)).toBe(true);

    const previousDish = draft.days[0]!.meals[0]!.bigMeat;
    const replaced = await client.replaceDraftDish(draft, {
      dayIndex: 0,
      mealIndex: 0,
      slot: "bigMeat"
    });
    expect(replaced.days[0]!.meals[0]!.bigMeat).not.toBe(previousDish);

    expect(await client.saveDraft(replaced)).toEqual(replaced);
    expect(await client.getPlan(draft.id)).toEqual(replaced);
    expect(await client.listPlans()).toEqual([replaced]);

    const confirmed = await client.confirmDraft(replaced);
    expect(confirmed).toMatchObject({
      id: "plan-1",
      status: "confirmed",
      confirmedAt: "2026-07-31T08:00:00.000Z"
    });
    await expect(client.saveDraft(replaced)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    } satisfies Partial<WeeklyMenuDomainError>);
    await expect(client.confirmDraft(replaced)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    } satisfies Partial<WeeklyMenuDomainError>);
    expect(await client.getPlan(confirmed.id)).toEqual(confirmed);
    const checklist = await client.getDishChecklist(confirmed.id);
    expect(checklist.planId).toBe(confirmed.id);
    expect(checklist.items.length).toBeGreaterThan(0);
    expect(checklist.items[0]).toEqual({ name: expect.any(String) });
    expect(checklist.items[0]).not.toHaveProperty("checked");

    const copied = await client.copyConfirmed(confirmed.id);
    expect(copied).toMatchObject({
      id: "plan-2",
      weekStart: "2026-08-03",
      sourcePlanId: confirmed.id,
      status: "draft"
    });
    expect((await client.listPlans()).map(({ id }) => id)).toEqual([
      "plan-2",
      "plan-1"
    ]);

    await client.deleteDraft(copied.id);
    expect((await client.listPlans()).map(({ id }) => id)).toEqual(["plan-1"]);
    await expect(client.deleteDraft(confirmed.id)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    } satisfies Partial<WeeklyMenuDomainError>);
  });

  it("拒绝未知计划和伪装成 draft 的 confirmed DTO", async () => {
    const client = createMockWeeklyMenuClient({
      now: fixedNow,
      random: fixedRandom,
      nextId: () => "plan-1"
    });
    await client.login();

    await expect(client.getPlan("missing")).rejects.toMatchObject({
      code: "PLAN_NOT_FOUND"
    } satisfies Partial<MockClientError>);

    const draft = await client.generateDraft();
    const confirmed = await client.confirmDraft(draft);
    await expect(
      client.replaceDraftDish(confirmed as unknown as DraftPlanDto, {
        dayIndex: 0,
        mealIndex: 0,
        slot: "vegetable"
      })
    ).rejects.toThrow();
    await expect(
      client.saveDraft(confirmed as unknown as DraftPlanDto)
    ).rejects.toThrow();
  });

  it("默认依赖也能生成唯一的 Mock 草稿", async () => {
    const client = createMockWeeklyMenuClient();
    await client.login();
    const first = await client.generateDraft();
    const second = await client.generateDraft();
    expect(first.id).not.toBe(second.id);
    await client.saveDraft(first);
    await client.saveDraft(second);
    expect(await client.listPlans()).toHaveLength(2);
  });
});
