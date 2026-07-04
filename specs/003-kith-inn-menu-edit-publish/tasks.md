---
description: "kith-inn 菜单换菜 + 发群文案（持久化）实现任务"
---

# Tasks：kith-inn 菜单换菜 + 发群文案（持久化）

**输入**: `specs/003-kith-inn-menu-edit-publish/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**测试策略**: 跨 shared（契约 schema）、be（纯函数 + cms 客户端 + 路由）、cms（menu-plans internal route，glue 无单测）、fe（logic + 菜单页重写）。每个用户故事的逻辑配最小自动化测试，**先红再绿**。cms 路由 handler 契约由 be 侧 mocked-fetch 客户端测覆盖（仓库既定分层）。

**组织方式**: 按 phase 分组。Phase 6（be 路由）+ Phase 7（fe 页）合起来是 MVP 切片（换菜 + 发布 + 复制文案可端到端演示）。

## Format：`[ID] [P?] [Story] Description`

- **[P]**: 可并行（文件不同、不依赖未完成任务）。
- **[Story]**: `[US1]`/`[US2]`/`[US3]`。
- 每个任务写明精确文件路径与关联 FR/contract。

## Phase 1：基线测试（先红）

**目的**: 固定各层缺口，避免只改一端。

- [ ] T001 [P] 在 `packages/kith-inn-shared/src/schemas.test.ts` 增加 `swapMenuRequestSchema`（menu/target 必填、target.day 限 mon-fri、occasion 限 lunch/dinner、replacementId 可选、多余字段 strip）、`swapMenuResponseSchema`（成功 {replacement,warning?} / 失败 {ok:false,reason} 判别）、`publishedMenuSchema`、`publishTextResponseSchema` 用例。覆盖 FR-001/FR-007/FR-008。
- [ ] T002 [P] 在 `apps/kith-inn-be/src/domain/menu/weekDates.test.ts`（新文件）增加 `resolveWeekDates(today, days)` 用例：给定 today（ISO date）算当周 mon-fri 日期；覆盖周一/周三/周日落在哪周、跨月边界（如 2026-08-31 当周）、Asia/Shanghai 基准。
- [ ] T003 [P] 在 `apps/kith-inn-be/src/domain/menu/core.test.ts` 增加 `swapDishSpecified` 用例：成功返回 replacement、replacement-not-in-pool、replacement-same-as-target、slot-not-found、dish-not-in-slot、主料避重冲突返回 warning（同 pool/lookback 与 `swapDish` 一致）。
- [ ] T004 [P] 在 `apps/kith-inn-be/src/lib/cms/menuPlans.test.ts`（新文件）增加 mocked-fetch 用例：`listMenuPlans(jwt,{from,to})`→`GET /api/internal/menu-plans?from=&to=` 解 `{docs}`；`upsertMenuPlan(jwt, items[])`→`POST /api/internal/menu-plans/upsert`；`updateMenuPlanPublishText(jwt,id,text)`→`PATCH /api/internal/menu-plans/:id`；非 2xx 抛 `CmsHttpError`。
- [ ] T005 在 `apps/kith-inn-be/src/routes/menu.test.ts` 增加：`POST /menu/swap`（auto→replacement；指定→replacement+warning；失败 `{ok:false,reason}`；401）；`POST /menu/publish`（成功→plans；archived slot→409；401）；`GET /menu/published`（空 `[]` / 非空；401）；`POST /menu/plans/:id/publish-text`（首次→publishText；命中缓存不调 LLM；跨租户 404；LLM 失败 502；401）。覆盖 contracts/be-menu-api、FR-001/FR-004/FR-005/FR-007/FR-008。
- [ ] T006 [P] 在 `apps/kith-inn-fe/src/logic/menuEdit.test.ts`（新文件）增加 `applySwap(menu, target, replacement)`（替换目标 dish、不动其它餐次/菜、不可变）、`menuViewMode(published)`（空→"suggest"、非空→"published"）用例。

## Phase 2：shared 契约 schema（基础）

**目的**: 三端共享契约；完成前不开路由集成。

- [ ] T007 在 `packages/kith-inn-shared/src/schemas.ts` 新增 `swapMenuRequestSchema`（`{ menu: z.array(menuSlotSchema), target: z.object({day: z.enum(["mon".."fri"]), occasion: menuMealOccasionSchema, dishId: id}), replacementId: id.optional() })`）、`swapMenuResponseSchema`（`z.discriminatedUnion("ok", [成功 {ok:true,replacement:menuDishSchema,warning?:string}, 失败 {ok:false, reason: z.enum([...])}])`）、`publishedSlotSchema`（`{date, occasion, planId:id, dishes:menuDishSchema[], publishText?:string}`）、`publishedMenuSchema`（`{published: z.array(publishedSlotSchema)}`）、`publishTextResponseSchema`（`{publishText: string}`）。day 枚举与 core `DEFAULT_CONSTRAINTS.days` 对齐（可从 enums 导出 `MENU_DAYS`）。覆盖 data-model 契约。
- [ ] T008 在 `packages/kith-inn-shared/src/types.ts` 用 `z.infer` 推导 `SwapMenuRequest`/`SwapMenuResponse`/`PublishedSlot`/`PublishedMenu`/`PublishTextResponse`，不手写平行类型。
- [ ] T009 确认从 `@cfp/kith-inn-shared/schemas` 可 import（schemas 不走 root barrel，FE/BE/cms 从子路径 `schemas` 取）。

**Checkpoint**: 契约一处定义、三端共用；多余字段被挡。

## Phase 3：be 纯函数（周日期解析 + 指定换菜）

**目的**: 把 publish 的日期解析与指定换菜的 warning 计算落成可单测纯函数。

- [ ] T010 在 `apps/kith-inn-be/src/domain/menu/weekDates.ts`（新文件）实现 `resolveWeekDates(today: string, days: string[] = ["mon","tue","wed","thu","fri"]): Record<string,string>`：以 Asia/Shanghai 解析 today → 当周周一日期（`Intl en-CA` + Asia/Shanghai，参照既有 `todayShanghai` 模式）→ 按 days 顺序映射成 `{mon: "YYYY-MM-DD", ...}`。纯函数。
- [ ] T011 在 `apps/kith-inn-be/src/domain/menu/core.ts` 新增 `swapDishSpecified(input: {menu: Slot[]; target: {day; occasion; dishId}; replacementId: string|number; pool: MenuDish[]; constraints?: Partial<MenuConstraints>}): {ok:true; replacement: MenuDish; warning?: string} | {ok:false; reason: "slot-not-found"|"dish-not-in-slot"|"replacement-not-in-pool"|"replacement-same-as-target"}`。复用文件内 `lookbackFrom`/`collectFrom` 算主料避重：若 replacement.mainIngredient ∈ target 邻槽 lookback → `warning: "会和近期主料重复，仍要换吗？"`。不动 `swapDish`/`generateWeekMenu`。

**Checkpoint**: 两纯函数 100% 单测；publish 的日期与指定换的 warning 都可单测。

## Phase 4：cms menu-plans internal route（glue）

**目的**: menu_plans 读写 internal route（无单测，契约由 be mocked-fetch 覆盖）。

- [ ] T012 在 `apps/cms/src/app/api/internal/menu-plans/route.ts`（新文件）加 `GET`：`operatorScope` → sellerId；query `from`/`to` 必填；按 `slot.date` 范围 + seller 过滤、`depth:1`（populate slot；offerings 自动 populated）、`limit:0`、`overrideAccess:true` → `{docs}`。
- [ ] T013 在 `apps/cms/src/app/api/internal/menu-plans/upsert/route.ts`（新文件）加 `POST`：body `Array<{slot; offerings[]; status}>`；每条 find-then-upsert 按 `(slot, seller)`（命中→update offerings/status；缺→create + seller 钉死）；`slot` 与每个 `offering` 经 `ownedBy` 验归属（不属→403）；`overrideAccess:true`。
- [ ] T014 在 `apps/cms/src/app/api/internal/menu-plans/[id]/route.ts`（新文件）加 `PATCH`：body 白名单 `{publishText}`；find-then-update 按 `(id, seller)`（跨租户→404）；`payload.update({id, data:{publishText}, overrideAccess:true})` → `{doc}`。

**Checkpoint**: cms 三个 menu-plans 端点就位（与 orders/service-slans 同 operatorScope 模式）。

## Phase 5：be cms 客户端（menuPlans.ts）

- [ ] T015 在 `apps/kith-inn-be/src/lib/cms/menuPlans.ts`（新文件）实现：`listMenuPlans(jwt, {from, to}, deps={})` → `GET {cmsBase()}/api/internal/menu-plans?from=&to=`，解 `{docs}`；`upsertMenuPlan(jwt, items[], deps={})` → `POST .../menu-plans/upsert`，解 `{docs}`；`updateMenuPlanPublishText(jwt, id, text, deps={})` → `PATCH .../menu-plans/${id}` body `{publishText}`。复用 `client.ts` 的 `cmsBase`/`OPERATOR_JWT_HEADER`/`CmsDeps` 与 `orders.ts` 的 `CmsHttpError`/`parseOk` 模式。

## Phase 6：be 路由（swap / publish / published / publish-text）— MVP 核心

**目标**: 4 个新端点，全部 sellerAuth；POST /swap 无状态，其余落库。

### Tests

- [ ] T016 跑 T001–T006 中与 be 路由相关用例确认实现前失败。

### Implementation

- [ ] T017 [US1] 在 `apps/kith-inn-be/src/routes/menu.ts` 加 `POST /swap`：`sellerAuth`；`swapMenuRequestSchema.safeParse(body)`（失败 400）；取池子 `deps.findOfferings(token)` 过滤 `active && component` → `pool`；`replacementId` 缺 → `swapDish({menu, target, dishId, pool})`；`replacementId` 给 → `swapDishSpecified({menu, target, replacementId, pool})`；返回 `swapMenuResponseSchema` 形（成功 200，失败也 200 `{ok:false,reason}`）。扩 `MenuDeps` 加 `findOfferings`。覆盖 FR-001。
- [ ] T018 [US2] 在 `routes/menu.ts` 加 `POST /publish`：`sellerAuth`；body `{menu: MenuSlot[]}`；`resolveWeekDates(todayShanghai())` → day→date；对每餐次：`deps.upsertSlots(token, [{date, occasion, granularity:"occasion"}])`（archived→`CmsHttpError(409)` → 透传 409 `{error:"slot-archived",date,occasion}`）；拿 slotId → 收集到 `upsertMenuPlan` 入参 `{slot:slotId, offerings: dishIds, status:"published"}`；全部 `deps.upsertMenuPlan(token, items)` → 返回 `{plans}`。扩 `MenuDeps`（upsertSlots、upsertMenuPlan）。覆盖 FR-004/FR-005/FR-006。
- [ ] T019 [US2] 在 `routes/menu.ts` 加 `GET /published`：`sellerAuth`；query `date` 缺省 `todayShanghai()`；`resolveWeekDates(date)` → from/to（mon/fri）；`deps.listMenuPlans(token, {from, to})` → 映射成 `publishedSlotSchema[]`（date=slot.date、occasion=slot.occasion、planId、dishes=offerings→MenuDish、publishText）→ `{published}`。扩 `MenuDeps`（listMenuPlans）。覆盖 FR-007。
- [ ] T020 [US3] 在 `routes/menu.ts` 加 `POST /plans/:id/publish-text`：`sellerAuth`；先用 `listMenuPlans`/直接 cms 找 plan（或新增 `getMenuPlan`）→ 若已有 publishText 直接返回缓存；否则构建 `MenuSlotText{day(由 slot.date→星期几), occasion, dishes: offerings.map(name)}` → `deps.getSeller(token)` 拿 sellerName + defaultPriceCents → `publishMenuText(text, {sellerName, priceCents})` → `deps.updateMenuPlanPublishText(token, id, text)` → `{publishText}`。LLM 失败→502；跨租户 id→404（cms find-then-update）。扩 `MenuDeps`（getSeller、updateMenuPlanPublishText；`publishMenuText` 直接 import）。覆盖 FR-008/FR-013。
- [ ] T021 把新依赖（findOfferings、upsertSlots、upsertMenuPlan、listMenuPlans、getSeller、updateMenuPlanPublishText）接进 `menuRoutes` 默认 `MenuDeps`（从 `lib/cms/*` import 实际函数）；保持 `app.ts` 挂载 `/menu` 不变。

**Checkpoint**: be 4 端点通；`pnpm --filter @cfp/kith-inn-be test` 绿。

## Phase 7：fe（api url + menuEdit 逻辑 + 菜单页重写）— MVP UI

**目标**: 菜单 tab 二分视图（建议 / 已发布），换菜、发布、复制文案全通。

- [ ] T022 在 `apps/kith-inn-fe/src/services/api.ts` 加 `menuSwapUrl()`=`${beBaseUrl()}/menu/swap`、`menuPublishUrl()`=`.../menu/publish`、`menuPublishedUrl(date?)=`.../menu/published[?date=]`、`menuPlanPublishTextUrl(id)=`.../menu/plans/${id}/publish-text`；并在 `services/api.test.ts` 加 URL 用例。
- [ ] T023 在 `apps/kith-inn-fe/src/logic/menuEdit.ts`（新文件）实现纯函数：`applySwap(menu: MenuSlot[], target: {day,occasion,dishId}, replacement: MenuDish): MenuSlot[]`（不可变替换目标 dish）、`menuViewMode(published: PublishedSlot[]): "suggest"|"published"`、`swapRequest(menu, target, replacementId?)`（构造 POST /swap body）。可注入 `req`（同 offeringsCrud 模式）的 `swapOffering`/`publishMenu`/`loadPublished`/`generatePublishText` 包装。
- [ ] T024 [US1][US2][US3] 在 `apps/kith-inn-fe/src/pages/menu/index.tsx` 重写菜单页：
  - 加载：先 `loadPublished()`（GET /menu/published?date=today）→ `menuViewMode` 判定；`published` 非空→已发布视图；空→`GET /menu/week` 建议视图。
  - 建议视图：每道菜 [换一道]（调 `swapOffering` auto → `applySwap` 更新本地 menu）、[选别的]（开菜品选择器：拉池子 `GET /menu/week` 已有 / 或新拉 offerings 列表，按 category 分组，tap 一道→`swapOffering` 指定；返回 warning→`Taro.showModal` 确认→`applySwap`）；底部 [发布本周菜单]（调 `publishMenu`→成功后 `loadPublished` 切已发布视图）。
  - 已发布视图：每餐次只读 dishes + [复制文案]（plan 已有 publishText→直接复制剪贴板；否则 `generatePublishText(planId)`→`Taro.setClipboardData`）。
  - 错误 toast；401→重定向 login。
  - UI 交 e2e，逻辑走 menuEdit.ts。
- [ ] T025 菜品选择器组件：用 NutUI `Popup`（如已验证可用）或纯 Taro 浮层，列池子里 component 菜（按荤/素/汤分组），tap 返回选中 offering。若 NutUI Popup 在 weapp 不可用，退化为新页面 / `Taro.showActionSheet`（ponytail：先用最简可用形态，加 `// ponytail:` 注明上限）。

**Checkpoint**: fe 菜单 tab 可换菜（auto/指定）、可发布、可复制文案、可回看；`pnpm --filter @cfp/kith-inn-fe test` 绿（logic 100%）。

## Phase 8：docs + 门禁 + PR

- [ ] T026 [P] 在 `docs/kith-inn/DATA-MODEL.md` §4 menu_plans 补 M1 写路径说明：发布 = upsert（每餐次一条 published）+ upsert service_slots→open（archived→409）；publishText 按需 PATCH；M1 不做 draft / 不做发布后换菜（constitution 治理铁律）。
- [ ] T027 按 `quickstart.md` 跑窄检查：`pnpm --filter @cfp/kith-inn-shared test`、`@cfp/kith-inn-be test`、`@cfp/kith-inn-fe test`、`@cfp/kith-inn-payload test`（应仍绿）。
- [ ] T028 跑 `pnpm verify`，PR 描述记录结果；遵守 `AGENTS.md` PR/Codex review 流程（base=main 自动审；只 rebase merge；逐条 resolve Codex comment）。

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 基线测试**: 无依赖，先红。
- **Phase 2 shared**: Phase 1 测试明确失败后。
- **Phase 3 be 纯函数**: 依赖 Phase 2（response shape）；可与 Phase 4 并行（不同包）。
- **Phase 4 cms route**: 依赖 Phase 2 契约；glue 不阻塞 be 单测（be mock cms）。
- **Phase 5 be cms 客户端**: 依赖 Phase 4 端点形状（契约）。
- **Phase 6 be 路由**: 依赖 Phase 2/3/5；MVP 核心。
- **Phase 7 fe**: 依赖 Phase 2（类型）+ Phase 6 端点。
- **Phase 8 收尾**: 全 US 完成后。

### Parallel Opportunities

- T001/T002/T003/T004/T006 可并行（文件不同）。
- T010（weekDates）/T011（swapDishSpecified）可并行（同包不同文件）。
- T012/T013/T014（cms 三 route）可并行。
- T026（docs）任意时机。

### Implementation Strategy

1. Phase 1+2（契约）。
2. Phase 3+4+5（纯函数 + cms route + be cms 客户端，可并行三组）。
3. Phase 6（be 路由，MVP 后端完成）→ be 单测全绿。
4. Phase 7（fe 菜单页重写）→ 端到端通。
5. Phase 8（docs + verify + PR）。

## Parallel Example：be 纯函数

```text
Task: "T010 weekDates.ts resolveWeekDates"
Task: "T011 core.ts swapDishSpecified"
Task: "T015 lib/cms/menuPlans.ts"
```
（三者文件不同，可并行准备；T017-T020 路由集成依赖前三者 + Phase 4。）

## Out of Scope（deferred，不在此 tasks 内）

发布后换菜、menu_plan draft 持久化、整周 publishText、菜单 tab 日期切换/翻周、agent 口头改菜单（US-M06，本 feature be 端点已备）、menu_plan 物理删除、force reopen archived slot。见 `spec.md` §假设。
