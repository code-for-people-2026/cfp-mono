import { randomUUID } from "node:crypto";
import {
  WEEKLY_MENU_CONTRACT_VERSION,
  assertPlanCanDelete,
  bootstrapDtoSchema,
  confirmDraftPlan,
  copyConfirmedPlan,
  createDishChecklist,
  draftPlanDtoSchema,
  generateDraftPlan,
  generatePlanInputSchema,
  planListDtoSchema,
  planListQuerySchema,
  replaceDishInputSchema,
  replaceDraftPlanDish,
  type BootstrapDto,
  type DishChecklistDto,
  type DishPools,
  type DraftPlanDto,
  type GeneratePlanInput,
  type PlanListDto,
  type PlanListQuery,
  type ReplaceDishInput,
  type WeeklyMenuPlanDto
} from "@cfp/weekly-menu-shared";
import type { PlanPage } from "./store";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

export type WeeklyMenuPlanStore = Readonly<{
  createDraftPlan(ownerId: string, input: DraftPlanDto): Promise<void>;
  findLatestDraft(ownerId: string): Promise<DraftPlanDto | null>;
  findPlan(ownerId: string, planId: string): Promise<WeeklyMenuPlanDto | null>;
  listPlans(ownerId: string, input: PlanListQuery): Promise<PlanPage>;
  replaceDraftPlan(ownerId: string, input: DraftPlanDto): Promise<boolean>;
  confirmDraftPlan(ownerId: string, planId: string, confirmedAt: string): Promise<boolean>;
  deleteDraftPlan(ownerId: string, planId: string): Promise<boolean>;
}>;

export type WeeklyMenuApiErrorCode =
  | "DEPENDENCY_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "PLAN_ID_CONFLICT"
  | "PLAN_NOT_FOUND"
  | "RATE_LIMITED";

export class WeeklyMenuApiError extends Error {
  constructor(readonly code: WeeklyMenuApiErrorCode) {
    super(code);
    this.name = "WeeklyMenuApiError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export class WeeklyMenuService {
  private readonly attempts = new Map<string, { count: number; startedAt: number }>();

  constructor(
    private readonly store: WeeklyMenuPlanStore,
    private readonly fetchDishPools: () => Promise<DishPools>,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  private assertRateLimit(ownerId: string, action: "copy" | "generate"): void {
    const now = this.clock().getTime();
    for (const [key, attempt] of this.attempts) {
      if (now - attempt.startedAt >= RATE_LIMIT_WINDOW_MS) this.attempts.delete(key);
    }
    const key = `${ownerId}:${action}`;
    const current = this.attempts.get(key);
    if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
      this.attempts.set(key, { count: 1, startedAt: now });
      return;
    }
    if (current.count >= RATE_LIMIT_MAX) {
      throw new WeeklyMenuApiError("RATE_LIMITED");
    }
    current.count += 1;
  }

  private async findOwnedPlan(ownerId: string, planId: string): Promise<WeeklyMenuPlanDto> {
    const plan = await this.store.findPlan(ownerId, planId);
    if (!plan) throw new WeeklyMenuApiError("PLAN_NOT_FOUND");
    return plan;
  }

  private async loadDishPools(): Promise<DishPools> {
    try {
      return await this.fetchDishPools();
    } catch {
      throw new WeeklyMenuApiError("DEPENDENCY_UNAVAILABLE");
    }
  }

  async bootstrap(ownerId: string): Promise<BootstrapDto> {
    return bootstrapDtoSchema.parse({
      contractVersion: WEEKLY_MENU_CONTRACT_VERSION,
      latestDraft: await this.store.findLatestDraft(ownerId)
    });
  }

  async generate(ownerId: string, input: GeneratePlanInput): Promise<DraftPlanDto> {
    this.assertRateLimit(ownerId, "generate");
    const parsed = generatePlanInputSchema.parse(input);
    // ponytail: Persist immediately instead of signing ephemeral plan state; save remains an owner-scoped update.
    const plan = generateDraftPlan({
      id: this.createId(),
      weekStart: parsed.weekStart,
      dishPools: await this.loadDishPools()
    });
    await this.store.createDraftPlan(ownerId, plan);
    return plan;
  }

  async save(ownerId: string, planId: string, input: DraftPlanDto): Promise<DraftPlanDto> {
    const plan = draftPlanDtoSchema.parse(input);
    if (plan.id !== planId) throw new WeeklyMenuApiError("INVALID_REQUEST");
    const current = await this.findOwnedPlan(ownerId, planId);
    assertPlanCanDelete(current, { actorId: ownerId, ownerId });
    if (
      current.contractVersion !== plan.contractVersion ||
      current.weekStart !== plan.weekStart ||
      current.sourcePlanId !== plan.sourcePlanId
    ) {
      throw new WeeklyMenuApiError("INVALID_REQUEST");
    }
    const saved = await this.store.replaceDraftPlan(ownerId, plan);
    if (!saved) throw new WeeklyMenuApiError("PLAN_NOT_FOUND");
    return plan;
  }

  detail(ownerId: string, planId: string): Promise<WeeklyMenuPlanDto> {
    return this.findOwnedPlan(ownerId, planId);
  }

  async replace(
    ownerId: string,
    planId: string,
    input: ReplaceDishInput
  ): Promise<DraftPlanDto> {
    const current = await this.findOwnedPlan(ownerId, planId);
    assertPlanCanDelete(current, { actorId: ownerId, ownerId });
    const dishPools = await this.loadDishPools();
    const replaced = replaceDraftPlanDish(
      current,
      { actorId: ownerId, ownerId },
      replaceDishInputSchema.parse(input),
      dishPools
    );
    if (!(await this.store.replaceDraftPlan(ownerId, replaced))) {
      throw new WeeklyMenuApiError("PLAN_NOT_FOUND");
    }
    return replaced;
  }

  async confirm(ownerId: string, planId: string): Promise<WeeklyMenuPlanDto> {
    const current = await this.findOwnedPlan(ownerId, planId);
    const confirmed = confirmDraftPlan(
      current,
      { actorId: ownerId, ownerId },
      this.clock().toISOString()
    );
    if (!(await this.store.confirmDraftPlan(ownerId, planId, confirmed.confirmedAt))) {
      throw new WeeklyMenuApiError("PLAN_NOT_FOUND");
    }
    return confirmed;
  }

  async delete(ownerId: string, planId: string): Promise<void> {
    const current = await this.findOwnedPlan(ownerId, planId);
    assertPlanCanDelete(current, { actorId: ownerId, ownerId });
    if (!(await this.store.deleteDraftPlan(ownerId, planId))) {
      throw new WeeklyMenuApiError("PLAN_NOT_FOUND");
    }
  }

  async list(ownerId: string, input: PlanListQuery): Promise<PlanListDto> {
    const query = planListQuerySchema.parse(input);
    const result = await this.store.listPlans(ownerId, query);
    return planListDtoSchema.parse({
      contractVersion: WEEKLY_MENU_CONTRACT_VERSION,
      items: result.items,
      page: { ...query, hasMore: result.hasMore }
    });
  }

  async copy(
    ownerId: string,
    sourcePlanId: string
  ): Promise<DraftPlanDto> {
    this.assertRateLimit(ownerId, "copy");
    const source = await this.findOwnedPlan(ownerId, sourcePlanId);
    const copy = copyConfirmedPlan(
      source,
      { actorId: ownerId, ownerId },
      {
        id: this.createId(),
        weekStart: addDays(source.weekStart, 7)
      }
    );
    try {
      await this.store.createDraftPlan(ownerId, copy);
    } catch (error) {
      if (isUniqueViolation(error)) throw new WeeklyMenuApiError("PLAN_ID_CONFLICT");
      throw error;
    }
    return copy;
  }

  async dishChecklist(ownerId: string, planId: string): Promise<DishChecklistDto> {
    const plan = await this.findOwnedPlan(ownerId, planId);
    return createDishChecklist(plan, { actorId: ownerId, ownerId });
  }
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
