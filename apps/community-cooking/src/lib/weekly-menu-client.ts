import {
  assertPlanCanDelete,
  confirmDraftPlan,
  copyConfirmedPlan,
  createDishChecklist,
  draftPlanDtoSchema,
  generateDraftPlan,
  replaceDraftPlanDish,
  WeeklyMenuDomainError,
  weeklyMenuPlanDtoSchema,
  type ConfirmedPlanDto,
  type DishChecklistDto,
  type DishPools,
  type DraftPlanDto,
  type ReplaceDishInput,
  type WeeklyMenuPlanDto
} from "@cfp/weekly-menu-shared";

export type WeeklyMenuSession = Readonly<{
  userId: string;
  displayName: string;
}>;

// 页面只依赖能力，不依赖 Mock 的存储方式，也不提前猜测真实 HTTP 路由细节。
export interface WeeklyMenuClient {
  restoreSession(): Promise<WeeklyMenuSession | null>;
  login(): Promise<WeeklyMenuSession>;
  generateDraft(): Promise<DraftPlanDto>;
  replaceDraftDish(
    plan: DraftPlanDto,
    input: ReplaceDishInput
  ): Promise<DraftPlanDto>;
  saveDraft(plan: DraftPlanDto): Promise<DraftPlanDto>;
  confirmDraft(plan: DraftPlanDto): Promise<ConfirmedPlanDto>;
  listPlans(): Promise<WeeklyMenuPlanDto[]>;
  getPlan(id: string): Promise<WeeklyMenuPlanDto>;
  copyConfirmed(id: string): Promise<DraftPlanDto>;
  deleteDraft(id: string): Promise<void>;
  getDishChecklist(id: string): Promise<DishChecklistDto>;
}

export type MockClientErrorCode = "LOGIN_REQUIRED" | "PLAN_NOT_FOUND";

export class MockClientError extends Error {
  readonly code: MockClientErrorCode;

  constructor(code: MockClientErrorCode) {
    super(code);
    this.name = "MockClientError";
    this.code = code;
  }
}

const MOCK_USER: WeeklyMenuSession = {
  userId: "mock-user",
  displayName: "学习用户"
};

const MOCK_DISH_POOLS: DishPools = {
  bigMeat: ["红烧肉", "可乐鸡翅", "糖醋排骨", "土豆炖牛肉", "清蒸鲈鱼"],
  smallMeat: ["番茄炒蛋", "青椒肉丝", "肉末豆腐", "虾仁蒸蛋", "木须肉"],
  vegetable: ["蒜蓉西兰花", "清炒时蔬", "醋溜白菜", "蚝油生菜", "香菇菜心"]
};

type MockClientOptions = Readonly<{
  now?: () => Date;
  random?: () => number;
  nextId?: () => string;
}>;

function mondayOf(date: Date): string {
  const monday = new Date(date);
  const day = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createMockWeeklyMenuClient(
  options: MockClientOptions = {}
): WeeklyMenuClient {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  let sequence = 0;
  const nextId =
    options.nextId ?? (() => `mock-plan-${now().getTime()}-${(sequence += 1)}`);
  // 单用户 Mock 只保存当前登录用户的数据；真实所有权由后端 Issue 验证。
  const plans = new Map<string, WeeklyMenuPlanDto>();
  let session: WeeklyMenuSession | null = null;

  function requireSession(): WeeklyMenuSession {
    if (!session) {
      throw new MockClientError("LOGIN_REQUIRED");
    }
    return session;
  }

  function findOwnedPlan(id: string): WeeklyMenuPlanDto {
    requireSession();
    const plan = plans.get(id);
    if (!plan) {
      throw new MockClientError("PLAN_NOT_FOUND");
    }
    return plan;
  }

  function storePlan(plan: WeeklyMenuPlanDto): WeeklyMenuPlanDto {
    requireSession();
    const parsed = weeklyMenuPlanDtoSchema.parse(plan);
    plans.set(parsed.id, parsed);
    return parsed;
  }

  function assertStoredPlanMutable(id: string): void {
    if (plans.get(id)?.status === "confirmed") {
      throw new WeeklyMenuDomainError("PLAN_IMMUTABLE");
    }
  }

  return {
    async restoreSession() {
      return session;
    },

    async login() {
      session = MOCK_USER;
      return session;
    },

    async generateDraft() {
      requireSession();
      return generateDraftPlan(
        {
          id: nextId(),
          weekStart: mondayOf(now()),
          dishPools: MOCK_DISH_POOLS
        },
        random
      );
    },

    async replaceDraftDish(plan, input) {
      const current = requireSession();
      return replaceDraftPlanDish(
        draftPlanDtoSchema.parse(plan),
        { actorId: current.userId, ownerId: current.userId },
        input,
        MOCK_DISH_POOLS,
        undefined,
        random
      );
    },

    async saveDraft(plan) {
      const current = requireSession();
      const draft = draftPlanDtoSchema.parse(plan);
      assertStoredPlanMutable(draft.id);
      assertPlanCanDelete(draft, {
        actorId: current.userId,
        ownerId: current.userId
      });
      return storePlan(draft) as DraftPlanDto;
    },

    async confirmDraft(plan) {
      const current = requireSession();
      const draft = draftPlanDtoSchema.parse(plan);
      assertStoredPlanMutable(draft.id);
      const confirmed = confirmDraftPlan(
        draft,
        { actorId: current.userId, ownerId: current.userId },
        now().toISOString()
      );
      return storePlan(confirmed) as ConfirmedPlanDto;
    },

    async listPlans() {
      requireSession();
      return [...plans.values()]
        .map((plan) => weeklyMenuPlanDtoSchema.parse(plan))
        .sort((left, right) =>
          right.weekStart.localeCompare(left.weekStart) ||
          right.id.localeCompare(left.id)
        );
    },

    async getPlan(id) {
      return weeklyMenuPlanDtoSchema.parse(findOwnedPlan(id));
    },

    async copyConfirmed(id) {
      const current = requireSession();
      const source = findOwnedPlan(id);
      const copy = copyConfirmedPlan(
        source,
        { actorId: current.userId, ownerId: current.userId },
        { id: nextId(), weekStart: addDays(source.weekStart, 7) }
      );
      return storePlan(copy) as DraftPlanDto;
    },

    async deleteDraft(id) {
      const current = requireSession();
      const plan = findOwnedPlan(id);
      assertPlanCanDelete(plan, {
        actorId: current.userId,
        ownerId: current.userId
      });
      plans.delete(id);
    },

    async getDishChecklist(id) {
      const current = requireSession();
      const plan = findOwnedPlan(id);
      return createDishChecklist(plan, {
        actorId: current.userId,
        ownerId: current.userId
      });
    }
  };
}

export const weeklyMenuClient: WeeklyMenuClient =
  createMockWeeklyMenuClient();
