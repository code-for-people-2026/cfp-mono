# 实施计划：kith-inn 菜单换菜 + 发群文案（持久化）

**分支**: `003-kith-inn-menu-edit-publish` | **日期**: 2026-07-04 | **规格**: [spec.md](./spec.md)

**输入**: `specs/003-kith-inn-menu-edit-publish/spec.md`

## 摘要

菜单 tab 从只读变为可换菜 + 可发布 + 可复制发群文案，发布落 `menu_plans`（每餐次一条，published）+ upsert `service_slots`→open，发布后可回看。换菜在发布前是 in-session（纯 `POST /menu/swap`，auto + 指定两模式）；publishText 每餐次按需 LLM 生成、存进 plan。不改 collection schema、不改 `generateWeekMenu`/`swapDish` 内核。

## 技术上下文

**语言 / 版本**: TypeScript 5.9，Node.js 20 types，React 18 / Taro 4.2

**主要依赖**: Hono、Payload 3.85、Zod 4.4、Taro、NutUI React、DeepSeek（仅 publish-text）

**存储**: 现有 `menu_plans` / `service_slots` / `offerings` collection（已就绪，不改 schema）

**测试**: Vitest；apps/cms 的 vitest 仅 `tests/**`（cms 路由 handler 是 glue，不进 line-coverage，契约由 be 侧 mocked-fetch 客户端测覆盖）。

**约束**: 保持 seller/operator 隔离；写经 cms internal；M1 不做发布后换菜 / draft / 整周文案；Asia/Shanghai 时区。

**规模 / 作用域**: 跨 shared + be + cms + fe；新增 cms menu-plans internal route（GET/upsert/PATCH）、be 纯函数（周日期解析、swapDishSpecified）、be cms 客户端、4 个 be 路由、fe 菜单页重写 + 选择器。≥2 PR。

## 当前实现事实（Brownfield）

- **`packages/kith-inn-shared/src/schemas.ts`**：已有 `menuDishSchema`/`menuSlotSchema`/`weekMenuSchema`（GET /menu/week 契约）。**没有** swap / published / publishText 契约。
- **`apps/kith-inn-be/src/domain/menu/core.ts`**：`generateWeekMenu`（确定性生成）+ `swapDish({menu, target, dishId, pool, constraints})`（确定性选替代，已含主料避重 + 费工 + 邻槽 lookback）+ `toMenuDish(Offering)`。**无**指定换菜、**无**周日期解析。
- **`apps/kith-inn-be/src/domain/menu/polish.ts`**：`publishMenuText(menu: MenuSlotText[], {sellerName, priceCents, generate?})` → LLM 群文案；`MenuSlotText = {day, occasion, dishes: string[]}`。**未被任何路由调用**。
- **`apps/kith-inn-be/src/routes/menu.ts`**：**只有 `GET /week`**（生成建议，无状态，过滤 `active && kind=component` → `generateWeekMenu`）。无 swap / publish / published / publish-text。
- **`apps/kith-inn-be/src/lib/cms/orders.ts`**：已有 `upsertSlots(jwt, slots)` → cms `POST /api/internal/service-slots/upsert`；`getSeller(jwt)` → seller 配置（sellerName/priceCents）；`findOfferings` 在 `client.ts`。menu_plans 的 cms 客户端**没有**。
- **`apps/cms/src/app/api/internal/service-slots/upsert/route.ts`**：upsert slot→open，`archived`→409，`draft`→open，缺→create open（可被 publish 直接复用）。
- **cms internal 目录**：`customers/fulfillments/offerings/operator-by-openid/chat_messages/orders/seller/service-slots`。**无 menu-plans**——需新增。
- **`apps/kith-inn-fe/src/pages/menu/index.tsx`**：**只读**。`GET /menu/week` → 按餐次渲染 dishes + chips；每餐次有「发群文案」按钮但只 `Taro.showToast({title:"群文案待生成"})` 占位。无换菜 / 发布 / 选择器。
- **`apps/kith-inn-fe/src/services/api.ts`**：有 `menuWeekUrl()`；无 swap/publish/published/publish-text URL。
- **`packages/kith-inn-payload/.../MenuPlans.ts`**：collection 字段 `slot`(→service_slots,required) + `offerings[]`(→offerings) + `publishText?` + `status`(draft/published) + seller；`tenantAccess`/`tenantHooks`。
- **`apps/kith-inn-be/src/domain/orders/service.ts`**：`upsertSlots` + `CmsHttpError` 409→`OrderStateError("slot-archived")` 模式可参照。

## 宪法检查

- **I. 功能规格承载功能工作**: 通过。独立 `specs/003-kith-inn-menu-edit-publish/` 目录。
- **II. Monorepo 作用域必须明确**: 通过。scope paths 写在 spec.md。
- **III. 先承认 Brownfield 事实**: 通过。上方已记录。
- **IV. 最小可交付切片**: 通过。M1 收为 auto+指定换菜 / publish（upsert）/ published 回看 / publish-text 按需；发布后换菜 / draft / 整周文案 / agent 工具 defer。
- **V. 验证和 Review 属于 Done**: 通过。检查项见 quickstart.md。
- **VI. 文档默认中文**: 通过。
- **「何时开 spec 目录」三档**: 本 feature 触发「必须开」（跨切面 shared+be+cms+fe + 动 menu_plans 写路径 + 预计 ≥2 PR）→ 全套 spec。

## 项目结构

### 文档（本功能）

```text
specs/003-kith-inn-menu-edit-publish/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── be-menu-api.md
│   └── cms-internal-menu-plans.md
└── checklists/
    └── requirements.md
```

### 源代码

```text
packages/kith-inn-shared/src/
├── schemas.ts          # + swap/published/publishText 契约 schema
├── schemas.test.ts     # + 契约用例
└── types.ts            # + SwapMenuRequest/Response, PublishedMenu 等

apps/kith-inn-be/src/
├── domain/menu/
│   ├── core.ts         # + swapDishSpecified（指定换 + 主料避重 warning），不动 generateWeekMenu/swapDish
│   ├── weekDates.ts    # 新文件：mon-fri → Asia/Shanghai 当周具体日期（纯函数）
│   └── *.test.ts       # + 用例
├── lib/cms/
│   ├── menuPlans.ts    # 新文件：listMenuPlans / upsertMenuPlan / updateMenuPlanPublishText
│   └── menuPlans.test.ts
└── routes/
    ├── menu.ts         # + POST /swap、POST /publish、GET /published、POST /plans/:id/publish-text
    └── menu.test.ts    # + 用例

apps/cms/src/app/api/internal/menu-plans/
├── route.ts            # 新文件：GET（?from=&to=，depth: slot+offerings）
├── upsert/route.ts     # 新文件：POST（按 (seller, slot) upsert menu_plan）
└── [id]/route.ts       # 新文件：PATCH（publishText，find-then-update 跨租户 404）

apps/kith-inn-fe/src/
├── services/api.ts             # + menuSwapUrl / menuPublishUrl / menuPublishedUrl / menuPlanPublishTextUrl
├── logic/
│   ├── menuEdit.ts             # 新文件：applySwap(menu,target,replacement) 纯函数 + 视图判定
│   └── menuEdit.test.ts
└── pages/menu/index.tsx        # 重写：建议页（换一道/选别的/发布）+ 已发布页（复制文案）+ 菜品选择器
```

**结构决策**: 沿用 feature 002 的分层——cms route handler 是 glue（无单测，契约由 be mocked-fetch 客户端覆盖）；be 周日期解析 + swapDishSpecified 是纯函数（单测 100%）；fe 网络与展示分离（`logic/menuEdit.ts` 测，菜单页交 e2e）。

## 复杂度跟踪

无 constitution violations。非平凡点：① `swapDishSpecified` 的主料避重 warning 计算（与 `swapDish` 共用 lookback，需把 lookback helper 暴露或复用）；② 周日期解析（Asia/Shanghai、跨周/月底）；③ publish 的 slot-upsert + menu_plan-upsert 两步（archived 409 透传）。均落纯函数 + 单测。
