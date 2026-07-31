import {
  confirmDraftPlan,
  type DishPools,
  type DraftPlanDto,
  type PlanListQuery,
  type WeeklyMenuPlanDto
} from "@cfp/weekly-menu-shared";
import { describe, expect, it, vi } from "vitest";
import {
  WeeklyMenuApiError,
  WeeklyMenuService,
  type WeeklyMenuPlanStore
} from "./weekly-menu-service";

const pools: DishPools = {
  bigMeat: ["红烧肉", "糖醋排骨"],
  smallMeat: ["番茄炒蛋", "青椒肉丝"],
  vegetable: ["清炒时蔬", "蒜蓉西兰花"]
};

class FakePlanStore implements WeeklyMenuPlanStore {
  readonly plans = new Map<string, { ownerId: string; plan: WeeklyMenuPlanDto }>();

  async createDraftPlan(ownerId: string, input: DraftPlanDto): Promise<void> {
    if (this.plans.has(input.id)) throw Object.assign(new Error("duplicate"), { code: "23505" });
    this.plans.set(input.id, { ownerId, plan: structuredClone(input) });
  }

  async findLatestDraft(ownerId: string): Promise<DraftPlanDto | null> {
    const plan = [...this.plans.values()]
      .filter((item) => item.ownerId === ownerId && item.plan.status === "draft")
      .at(-1)?.plan;
    return plan?.status === "draft" ? structuredClone(plan) : null;
  }

  async findPlan(ownerId: string, planId: string): Promise<WeeklyMenuPlanDto | null> {
    const record = this.plans.get(planId);
    return record?.ownerId === ownerId ? structuredClone(record.plan) : null;
  }

  async listPlans(ownerId: string, input: PlanListQuery) {
    const owned = [...this.plans.values()]
      .filter((item) => item.ownerId === ownerId)
      .map((item) => structuredClone(item.plan));
    return {
      items: owned.slice(input.offset, input.offset + input.limit),
      hasMore: owned.length > input.offset + input.limit
    };
  }

  async replaceDraftPlan(ownerId: string, input: DraftPlanDto): Promise<boolean> {
    const current = this.plans.get(input.id);
    if (current?.ownerId !== ownerId || current.plan.status !== "draft") return false;
    this.plans.set(input.id, { ownerId, plan: structuredClone(input) });
    return true;
  }

  async confirmDraftPlan(
    ownerId: string,
    planId: string,
    confirmedAt: string
  ): Promise<boolean> {
    const current = this.plans.get(planId);
    if (current?.ownerId !== ownerId || current.plan.status !== "draft") return false;
    this.plans.set(planId, {
      ownerId,
      plan: confirmDraftPlan(current.plan, { actorId: ownerId, ownerId }, confirmedAt)
    });
    return true;
  }

  async deleteDraftPlan(ownerId: string, planId: string): Promise<boolean> {
    const current = this.plans.get(planId);
    if (current?.ownerId !== ownerId || current.plan.status !== "draft") return false;
    return this.plans.delete(planId);
  }
}

function makeService(store = new FakePlanStore(), clock = () => new Date("2026-08-01T08:00:00Z")) {
  let sequence = 0;
  return {
    store,
    service: new WeeklyMenuService(
      store,
      vi.fn().mockResolvedValue(pools),
      clock,
      () => `generated-${(sequence += 1)}`
    )
  };
}

describe("Weekly Menu application service", () => {
  it("generates and immediately persists a draft, then exposes it through bootstrap", async () => {
    const { service, store } = makeService();
    const generated = await service.generate("owner-1", { weekStart: "2026-08-03" });
    expect(generated).toMatchObject({ id: "generated-1", status: "draft" });
    expect(store.plans.get(generated.id)).toMatchObject({ ownerId: "owner-1" });
    await expect(service.bootstrap("owner-1")).resolves.toMatchObject({
      contractVersion: 1,
      latestDraft: { id: generated.id }
    });
    await expect(service.bootstrap("owner-2")).resolves.toMatchObject({ latestDraft: null });
  });

  it("saves, replaces, confirms and protects a plan from later writes", async () => {
    const { service } = makeService();
    const draft = await service.generate("owner-1", { weekStart: "2026-08-03" });
    const changed = structuredClone(draft);
    changed.days[0]!.meals[0]!.vegetable = "手工修改";
    await expect(service.save("owner-1", draft.id, changed)).resolves.toEqual(changed);

    const replaced = await service.replace("owner-1", draft.id, {
      dayIndex: 0,
      mealIndex: 0,
      slot: "vegetable"
    });
    expect(replaced.days[0]!.meals[0]!.vegetable).not.toBe("手工修改");

    const confirmed = await service.confirm("owner-1", draft.id);
    expect(confirmed).toMatchObject({ status: "confirmed", confirmedAt: "2026-08-01T08:00:00.000Z" });
    await expect(service.save("owner-1", draft.id, draft)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    });
    await expect(service.delete("owner-1", draft.id)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    });
    await expect(
      service.replace("owner-1", draft.id, {
        dayIndex: 0,
        mealIndex: 0,
        slot: "vegetable"
      })
    ).rejects.toMatchObject({ code: "PLAN_IMMUTABLE" });
    await expect(service.confirm("owner-1", draft.id)).rejects.toMatchObject({
      code: "PLAN_IMMUTABLE"
    });
  });

  it("uses one not-found result for every missing and cross-owner plan operation", async () => {
    const { service } = makeService();
    const draft = await service.generate("owner-1", { weekStart: "2026-08-03" });
    const operations = [
      () => service.detail("owner-2", draft.id),
      () =>
        service.replace("owner-2", draft.id, {
          dayIndex: 0,
          mealIndex: 0,
          slot: "bigMeat"
        }),
      () => service.delete("owner-2", draft.id),
      () => service.save("owner-2", draft.id, draft),
      () => service.confirm("owner-2", draft.id),
      () => service.copy("owner-2", draft.id),
      () => service.dishChecklist("owner-2", draft.id),
      () => service.detail("owner-2", "missing-plan")
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toEqual(
        new WeeklyMenuApiError("PLAN_NOT_FOUND")
      );
    }
    await expect(service.save("owner-1", "different-id", draft)).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      service.save("owner-1", draft.id, { ...draft, weekStart: "2026-08-10" })
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("lists only owner plans with bounded pagination", async () => {
    const { service } = makeService();
    await service.generate("owner-1", { weekStart: "2026-08-03" });
    await service.generate("owner-1", { weekStart: "2026-08-10" });
    await service.generate("owner-2", { weekStart: "2026-08-03" });
    await expect(service.list("owner-1", { limit: 1, offset: 0 })).resolves.toMatchObject({
      contractVersion: 1,
      items: [{ id: "generated-1" }],
      page: { limit: 1, offset: 0, hasMore: true }
    });
  });

  it("copies confirmed plans and derives a name-only checklist", async () => {
    const { service, store } = makeService();
    const draft = await service.generate("owner-1", { weekStart: "2026-08-03" });
    await service.confirm("owner-1", draft.id);
    const copy = await service.copy("owner-1", draft.id);
    expect(copy).toMatchObject({
      id: "generated-2",
      sourcePlanId: draft.id,
      status: "draft",
      weekStart: "2026-08-10"
    });

    const checklist = await service.dishChecklist("owner-1", draft.id);
    expect(checklist.planId).toBe(draft.id);
    expect(checklist.items.length).toBeGreaterThan(0);
    expect(checklist.items[0]).toEqual({ name: expect.any(String) });
    expect(checklist.items[0]).not.toHaveProperty("checked");
    await expect(service.dishChecklist("owner-1", copy.id)).rejects.toMatchObject({
      code: "PLAN_NOT_CONFIRMED"
    });
    const collidingService = new WeeklyMenuService(
      store,
      vi.fn().mockResolvedValue(pools),
      () => new Date("2026-08-01T08:00:00Z"),
      () => copy.id
    );
    await expect(collidingService.copy("owner-1", draft.id)).rejects.toMatchObject({
      code: "PLAN_ID_CONFLICT"
    });
  });

  it("rate-limits expensive generation per identity and redacts recipe failures", async () => {
    const { service } = makeService();
    for (let index = 0; index < 10; index += 1) {
      await service.generate("owner-1", { weekStart: "2026-08-03" });
    }
    await expect(service.generate("owner-1", { weekStart: "2026-08-03" })).rejects.toMatchObject({
      code: "RATE_LIMITED"
    });
    await expect(service.generate("owner-2", { weekStart: "2026-08-03" })).resolves.toBeDefined();

    const unavailable = new WeeklyMenuService(
      new FakePlanStore(),
      vi.fn().mockRejectedValue(new Error("https://secret.example/recipes"))
    );
    await expect(unavailable.generate("owner-1", { weekStart: "2026-08-03" })).rejects.toEqual(
      new WeeklyMenuApiError("DEPENDENCY_UNAVAILABLE")
    );
  });

  it("lazily removes expired rate-limit entries when a new window starts", async () => {
    let now = new Date("2026-08-01T08:00:00Z");
    const { service } = makeService(new FakePlanStore(), () => now);
    await service.generate("owner-1", { weekStart: "2026-08-03" });
    await service.generate("owner-2", { weekStart: "2026-08-03" });
    expect(Reflect.get(service, "attempts")).toHaveProperty("size", 2);

    now = new Date("2026-08-01T08:01:00Z");
    await service.generate("owner-3", { weekStart: "2026-08-03" });
    expect(Reflect.get(service, "attempts")).toHaveProperty("size", 1);
  });
});
