# 实施计划：kith-inn 菜单编辑 + 接龙发布

**分支**: `003-kith-inn-menu-edit-publish` | **日期**: 2026-07-04 | **规格**: [spec.md](./spec.md)

## 摘要

菜单 tab 从只读变为可编辑 + 接龙发布：日/周双视图；`generate` 写 draft（暂定）、`swap` 换菜、`publish`（一键发布）转 published + 生成**接龙格式**文案（确定性模板、不调 LLM）+ 复制；改 published 菜单二次确认（be force 守卫）。date-driven、按餐次；菜单流程不开餐（slot 开归订单确认）。不改 collection schema、不改 generateWeekMenu 算法、不依赖 DeepSeek。

## 技术上下文

TS 5.9 / Node 20 / React 18 / Taro 4.2；Hono、Payload 3.85、Zod 4.4、NutUI React。**无 DeepSeek**（接龙文案纯模板）。存储：现有 `menu_plans`/`service_slots`/`offerings`。测试：Vitest；cms route handler 是 glue（不进 line-coverage，契约由 be mocked-fetch 覆盖）。约束：seller/operator 隔离；写经 cms internal；Asia/Shanghai。

规模：跨 shared+be+cms+fe；新增 cms menu-plans internal route（GET list/GET id/upsert/PATCH）、be 接龙纯函数 + swapDishSpecified + cms 客户端 + 4 个 be 路由 + fe 菜单页双视图重写。≥2 PR。

## 当前实现事实（Brownfield）

- **shared `schemas.ts`**：有 `menuDishSchema`/`menuSlotSchema`/`weekMenuSchema`（生成契约，`MenuSlot.day` 抽象 mon-fri）。无 menu_plan / 接龙 / swap 契约。
- **be `domain/menu/core.ts`**：`generateWeekMenu({pool,constraints,history})`（按 `constraints.days`×`meals` 生成，lookback 避重）+ `swapDish({menu,target,dishId,pool,constraints})` + `toMenuDish`。**无** date-targets 包装、**无** swapDishSpecified。
- **be `domain/menu/polish.ts`**：`publishMenuText(menu,{sellerName,priceCents,generate?})` LLM 群文案——**本 feature 不用**（接龙改确定性模板，polish.ts 暂留 unused）。
- **be `routes/menu.ts`**：只有 `GET /week`（生成建议、无状态、过滤 active+component）。无 generate/swap/publish/plans。
- **be `lib/cms/orders.ts`**：`getSeller`(sellerName/priceCents)、`findOfferings`(client.ts)。无 menu_plans 客户端。
- **cms internal**：无 menu-plans → 需新增。
- **fe `pages/menu/index.tsx`**：只读，`GET /menu/week` 渲染，「发群文案」按钮 toast 占位。无编辑/发布/双视图。
- **`MenuPlans.ts` collection**：slot→service_slots(required)、offerings[]、publishText?、status(draft/published)、seller；tenantAccess/hooks。

## 宪法检查

I-VI 全通过。「何时开 spec 目录」：触发「必须开」（跨切面 + 动 menu_plans 写路径 + 状态机 + ≥2 PR）→ 全套。

## 项目结构

```text
packages/kith-inn-shared/src/
├── schemas.ts          # + menuPlanSchema/swapRequest/jielongText 契约
├── types.ts            # + MenuPlanView/SwapRequest/JielongText
└── schemas.test.ts

apps/kith-inn-be/src/
├── domain/menu/
│   ├── core.ts         # + swapDishSpecified（不动 generateWeekMenu/swapDish）
│   ├── jielongText.ts  # 新文件：buildJielongMenuText 纯函数
│   └── *.test.ts
├── lib/cms/
│   ├── menuPlans.ts    # 新：listMenuPlans/getMenuPlan/upsertMenuPlans/patchMenuPlan
│   └── menuPlans.test.ts
└── routes/
    ├── menu.ts         # + GET /plans、POST /generate、POST /plans/:id/swap、POST /plans/:id/publish
    └── menu.test.ts

apps/cms/src/app/api/internal/menu-plans/
├── route.ts            # 新：GET（?from=&to=，depth）
├── [id]/route.ts       # 新：GET（depth）+ PATCH（{status?,publishText?,offerings?}）
└── upsert/route.ts     # 新：POST（ensure slot draft-if-missing + upsert plan by seller+slot）

apps/kith-inn-fe/src/
├── services/api.ts             # + menuPlansUrl/menuGenerateUrl/menuPlanUrl(id)
├── logic/menuEdit.ts           # 新：view-mode/swap-request 构造（纯）
└── pages/menu/index.tsx        # 重写：日/周双视图 + 编辑 + 一键发布 + 接龙复制
```

**结构决策**：cms route handler 是 glue；be `buildJielongMenuText`/`swapDishSpecified` 纯函数单测；fe 网络/展示分离（logic 测、页交 e2e）。

## 复杂度跟踪

无 constitution violations。非平凡点：① `swapDishSpecified` 复用 core lookback 算避重 warning；② cms upsert 的 ensure-slot-draft-if-missing（不改既有 slot status）；③ published force 守卫（409 + force）；④ 日/周双视图 FE 状态。
