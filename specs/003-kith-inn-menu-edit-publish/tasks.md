---
description: "kith-inn 菜单编辑 + 接龙发布 实现任务"
---

# Tasks：kith-inn 菜单编辑 + 接龙发布

**输入**: `specs/003-kith-inn-menu-edit-publish/` 下 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**测试策略**: 跨 shared（契约）/ be（纯函数 + cms 客户端 + 路由）/ cms（menu-plans internal route，glue 无单测）/ fe（logic + 菜单页双视图）。每用户故事配最小自动化测试，**先红再绿**。cms route handler 契约由 be mocked-fetch 客户端测覆盖。

**组织**: 按 phase。Phase 6+7 合起来是 MVP 切片（编辑 + 接龙发布 端到端）。

## Format：`[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、不依赖未完成）。
- **[Story]**: `[US1]`/`[US2]`/`[US3]`。
- 每任务写明精确文件路径 + FR/contract。

## Phase 1：基线测试（先红）

- [ ] T001 [P] `packages/kith-inn-shared/src/schemas.test.ts` 加 `menuPlanViewSchema`（planId/date/occasion/status/dishes/publishText?）、`swapRequestSchema`（dishId 必填、replacementId?/force? 可选、多余 strip）用例。覆盖 FR-001/FR-003。
- [ ] T002 [P] `apps/kith-inn-be/src/domain/menu/jielongText.test.ts`（新）：`buildJielongMenuText(plan, seller)` 产接龙文案——含【街坊味】+ 日期(M月D日 周X)+餐次、菜名顿号分隔、`{price}元/份`、截止/送餐说明、`接龙：\n1.`；多道菜、缺 publishText 字段。覆盖 FR-005。
- [ ] T003 [P] `apps/kith-inn-be/src/domain/menu/core.test.ts` 加 `swapDishSpecified`：成功 replacement、replacement-not-in-pool、replacement-same-as-target、slot-not-found、dish-not-in-slot、避重冲突返 warning（复用 `swapDish` 同 lookback）。覆盖 FR-003。
- [ ] T004 [P] `apps/kith-inn-be/src/lib/cms/menuPlans.test.ts`（新）：mocked-fetch 用例——`listMenuPlans(jwt,{from,to})`→`GET .../menu-plans?from=&to=`、`getMenuPlan(jwt,id)`→`GET .../menu-plans/:id`、`upsertMenuPlans(jwt,items)`→`POST .../menu-plans/upsert`、`patchMenuPlan(jwt,id,patch)`→`PATCH .../menu-plans/:id`；非 2xx 抛 `CmsHttpError`。
- [ ] T005 `apps/kith-inn-be/src/routes/menu.test.ts` 加：`GET /plans`（空/非空）、`POST /generate`（写 draft；published 无 force→409；pool-too-small→{ok:false}）、`POST /plans/:id/swap`（auto/指定+warning；published 无 force→409；清 publishText；404）、`POST /plans/:id/publish`（draft→published+接龙文案；published 缓存不重生成；404）；全 401。覆盖 contracts/be-menu-api。
- [ ] T006 [P] `apps/kith-inn-fe/src/logic/menuEdit.test.ts`（新）：`menuViewMode(plans)`（按 date 分午餐/晚餐、缺则空）、`swapRequest(dishId, replacementId?)` 构造、`isPublished(plan)` 判定。

## Phase 2：shared 契约

- [ ] T007 `packages/kith-inn-shared/src/schemas.ts` 加 `menuPlanViewSchema`（`{planId:id, date:string, occasion:menuMealOccasionSchema, status:z.enum(["draft","published"]), dishes:z.array(menuDishSchema), publishText:z.string().optional()}`）、`swapRequestSchema`（`{dishId:id, replacementId:id.optional(), force:z.boolean().optional()}`）。复用 `menuDishSchema`/`menuMealOccasionSchema`。
- [ ] T008 `types.ts` `z.infer` 推 `MenuPlanView`/`SwapRequest`，不手写。
- [ ] T009 确认从 `@cfp/kith-inn-shared/schemas` 可 import。

**Checkpoint**: 契约一处、三端共用。

## Phase 3：be 纯函数（接龙文案 + 指定换菜）

- [ ] T010 `apps/kith-inn-be/src/domain/menu/jielongText.ts`（新）实现 `buildJielongMenuText(plan: {date,occasion,dishNames[]}, seller: {name, priceCents}): string`。模板常量（标题前缀/分隔符/截止措辞/送餐说明/接龙起始）+ `// ponytail: 默认值，待桃子真实接龙样本校准`。date→`M月D日 周X`（Asia/Shanghai）。纯函数、不调 LLM。
- [ ] T011 `apps/kith-inn-be/src/domain/menu/core.ts` 加 `swapDishSpecified({menu, target:{day,occasion,dishId}, replacementId, pool, constraints?}): {ok:true,replacement,warning?}|{ok:false,reason}`。复用文件内 `lookbackFrom`/`collectFrom` 算避重 warning。不动 `swapDish`/`generateWeekMenu`。

**Checkpoint**: 两纯函数 100% 单测。

## Phase 4：cms menu-plans internal route（glue）

- [ ] T012 `apps/cms/src/app/api/internal/menu-plans/route.ts`（新）`GET`：`operatorScope`；`from/to` 必填；seller-scoped + `slot.date` 范围、`depth:1`、`limit:0`、`overrideAccess:true` → `{docs}`。
- [ ] T013 `apps/cms/src/app/api/internal/menu-plans/[id]/route.ts`（新）`GET`（depth，跨租户 404）+ `PATCH`（白名单 `{status?,publishText?,offerings?}`，find-then-update 跨租户 404）。
- [ ] T014 `apps/cms/src/app/api/internal/menu-plans/upsert/route.ts`（新）`POST`：body `Array<{date,occasion,offerings[],status:"draft"}>`；每条 **ensure slot**（命中不动 status / 缺则 create draft）+ **upsert plan** by (seller,slot) + `ownedBy` 验 offerings 归属（403）→ `{docs}`。

**Checkpoint**: cms 4 端点（GET list / GET id / upsert / PATCH）就位。

## Phase 5：be cms 客户端

- [ ] T015 `apps/kith-inn-be/src/lib/cms/menuPlans.ts`（新）实现 `listMenuPlans(jwt,{from,to})`、`getMenuPlan(jwt,id)`、`upsertMenuPlans(jwt,items[])`、`patchMenuPlan(jwt,id,patch)`。复用 `client.ts` 的 `cmsBase`/`OPERATOR_JWT_HEADER`/`CmsDeps` + `orders.ts` 的 `CmsHttpError`/`parseOk` 模式。

## Phase 6：be 路由（4 端点）— MVP 核心

### Tests
- [ ] T016 跑 T001-T006 中 be 路由相关用例确认实现前失败。

### Implementation
- [ ] T017 `apps/kith-inn-be/src/routes/menu.ts` 加 `GET /plans`：`sellerAuth`；`?date=`（单日）或 `?from=&to=`；`deps.listMenuPlans(token, {from,to})` → 映射成 `menuPlanView[]`（date=slot.date、occasion=slot.occasion、dishes=offerings→MenuDish、status、publishText）→ `{plans}`。
- [ ] T018 [US1] 加 `POST /generate`：`sellerAuth`；body `{targets:[{date,occasion}], force?}`；对每 target：取池子（`deps.findOfferings`）+ 历史 lookback（当范围已存 plan 的菜）→ `generateWeekMenu` → 池太小返 `{ok:false,reason,missing}`；否则 target 已 published 且无 force→409；`deps.upsertMenuPlans(token, items draft)` → `{plans}`。扩 `MenuDeps`。
- [ ] T019 [US2] 加 `POST /plans/:id/swap`：`sellerAuth`；`swapRequestSchema.safeParse`；`deps.getMenuPlan(token,id)`（404）；published 且无 force→409；auto=`swapDish`/指定=`swapDishSpecified`（取池子+menu 上下文）；失败 `{ok:false,reason}`；成功 → `deps.patchMenuPlan(token, id, {offerings:新ids})` +（published 时）`patchMenuPlan(token,id,{publishText:null})` 清空 → `{plan, warning?}`。
- [ ] T020 [US3] 加 `POST /plans/:id/publish`：`sellerAuth`；`deps.getMenuPlan`（404）；draft→`patchMenuPlan(token,id,{status:"published"})`；publishText 缺→`buildJielongMenuText(plan, seller)`（seller 经 `deps.getSeller`）→ `patchMenuPlan(token,id,{publishText})`；已存→缓存返回 → `{publishText}`。
- [ ] T021 接进 `menuRoutes` 默认 `MenuDeps`（从 `lib/cms/*` import 实际函数）；`app.ts` 挂 `/menu` 不变。

**Checkpoint**: be 4 端点通；`pnpm --filter @cfp/kith-inn-be test` 绿。

## Phase 7：fe（api + logic + 菜单页双视图）— MVP UI

- [ ] T022 `apps/kith-inn-fe/src/services/api.ts` 加 `menuPlansUrl(date?)`（`.../menu/plans[?date=]`）、`menuGenerateUrl()`、`menuPlanUrl(id)`（swap/publish 用：`.../menu/plans/${id}/swap`、`/publish`）；`services/api.test.ts` 加用例。
- [ ] T023 `apps/kith-inn-fe/src/logic/menuEdit.ts`（新）纯函数：`menuViewMode(plans)`、`swapRequest(...)`、`isPublished(plan)`、`dayOccasions`（午/晚分区）。可注入 `req` 的 `loadPlans(date)`、`generate(targets,force?)`、`swapDish(planId,...,force?)`、`publish(planId)` 包装。
- [ ] T024 [US1][US2][US3] 重写 `apps/kith-inn-fe/src/pages/menu/index.tsx`：
  - 顶部 `[ 日 | 周 ]` segmented toggle（默认日）。
  - **日视图**：当前 date（默认 today）+「跳回今天」+ 左右滑（Taro `Swiper`，退化用前/后按钮）；每餐（午/晚）一卡：无 plan→「生成」；draft→dishes+「换一道」「选别的」「重新生成」「一键发布」；published→dishes（已发出色）+「复制文案」「换一道(二次确认)」「重新生成(二次确认)」。
  - **周视图**：N 天网格（默认本周/接下来 7 天，可翻周）+「生成这周」；每格显示当天各餐 dishes/空；点格→切日视图该天。
  - 「一键发布/复制文案」→`publish(planId)`→`Taro.setClipboardData(publishText)`+toast"去群粘贴"。
  - 「选别的」→弹菜品选择器（池子按荤素分组，tap 选）→`swapDish` 指定；冲突→`Taro.showModal` 确认。
  - published 编辑→`Taro.showModal` 二次确认→带 force。
  - 401→重定向 login；失败 toast。UI 交 e2e、逻辑走 menuEdit.ts。
- [ ] T025 菜品选择器：NutUI `Popup`（weapp 未验证则退化 `Taro.showActionSheet` 或新页，加 `// ponytail:` 注明）。

**Checkpoint**: fe 双视图 + 编辑 + 接龙发布 + 复制通；`pnpm --filter @cfp/kith-inn-fe test` 绿（logic 100%）。

## Phase 8：docs + 门禁 + PR

- [ ] T026 [P] `docs/kith-inn/DATA-MODEL.md` §4 menu_plans 补：status draft/published 用法（generate 写 draft、一键发布转 published、改 published 需 force）、publishText=接龙模板（不调 LLM）、ensure-slot-draft（菜单不开餐）。
- [ ] T027 按 `quickstart.md` 跑窄检查：`@cfp/kith-inn-shared`/`-be`/`-fe`/`-payload` test。
- [ ] T028 `pnpm verify`，PR 描述记录；遵守 `AGENTS.md`（base=main 自动审、rebase merge、逐条 resolve Codex）。

## Dependencies & Execution Order

- **Phase 1**: 无依赖，先红。
- **Phase 2**: 依赖 1。
- **Phase 3+4+5**: 依赖 2；三组可并行（纯函数 / cms route / be 客户端，不同包/文件）。
- **Phase 6**: 依赖 2/3/5；MVP 后端。
- **Phase 7**: 依赖 2+6；MVP 前端。
- **Phase 8**: 全 US 完成后。

### Parallel
T001/T002/T003/T004/T006 可并行；T010/T011 可并行；T012/T013/T014 可并行；T026 任意。

## Out of Scope（deferred）

接龙文案真实样本校准、plan 删除、真发微信群、整周一键发出、菜单 tab 翻周到任意历史、agent 菜单工具（US-M06=feature 004）、LLM 语气润色。见 `spec.md` §假设。
