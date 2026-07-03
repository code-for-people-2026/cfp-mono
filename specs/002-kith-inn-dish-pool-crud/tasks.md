---
description: "kith-inn 菜品池 CRUD 实现任务"
---

# Tasks：kith-inn 菜品池 CRUD

**输入**: `specs/002-kith-inn-dish-pool-crud/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**测试策略**: 改动跨 shared schema、be（route + cms 客户端）、cms internal route（glue，无直接单测）、fe（logic + kitchen 页）。每个用户故事的逻辑都配最小自动化测试；**先写失败测试再实现**。cms 路由 handler 的契约由 be 侧 mocked-fetch 客户端测试覆盖（仓库既定分层：cms 不持有可执行逻辑）。

**组织方式**: 任务按 phase 分组；Phase 3（US1 新增）是 MVP 切片，完成后即可独立验证「新增菜进菜品池 + 按分类被菜单选到」。

## Format：`[ID] [P?] [Story] Description`

- **[P]**: 可并行，前提是文件不同且不依赖未完成任务。
- **[Story]**: 用户故事阶段，如 `[US1]`。
- 每个任务写明精确文件路径与关联 FR/contract。

## Phase 1：基线测试（先红）

**目的**: 先固定各层缺口，避免只改一端。

- [ ] T001 [P] 在 `packages/kith-inn-shared/src/schemas.test.ts` 增加 `offeringCreateSchema`（name 必填非空、mainIngredient 可选、**category 必填限 meat/veg/soup/staple**、`priceCents`/`kind`/`seller`/`tags`/`recipe` 等多余字段被 strip）与 `offeringUpdateSchema`（只接受 name/mainIngredient/category、空对象非法、name 给了须非空、category 给了须合法）的用例，覆盖 FR-001/FR-002/FR-003/FR-004/FR-012。
- [ ] T002 [P] 在 `apps/kith-inn-be/src/lib/cms/offerings.test.ts`（新文件）增加 mocked-fetch 用例：`createOffering(jwt,{name,mainIngredient?,category})` → `POST {CMS}/api/internal/offerings`，body 含 name/category、可选 mainIngredient，header 含 `x-kith-inn-operator`；`updateOffering(jwt,id,patch)` → `PATCH .../offerings/:id`；`deactivateOffering(jwt,id)` → `DELETE .../offerings/:id`；`restoreOffering(jwt,id)` → `POST .../offerings/:id/restore`；cms 非 2xx 抛 `CmsHttpError`（复用 `lib/cms/orders.ts` 的 `CmsHttpError`）。覆盖 contracts/cms-internal-offerings、FR-010。
- [ ] T003 在 `apps/kith-inn-be/src/routes/offerings.test.ts` 增加：`POST /offerings` name/category 缺失 → 400、合法 → 转发 cms 返回 201 `{offering}`；`PATCH /offerings/:id` 空体 → 400、合法 → 200；`DELETE /offerings/:id` → 200 `{ok:true}`；`POST /offerings/:id/restore` → 200 `{ok:true}`；四端点无 token → 401。覆盖 contracts/be-offerings-api、FR-001/FR-003/FR-005/FR-006/FR-012。
- [ ] T004 在 `apps/kith-inn-be/src/routes/offerings.test.ts` 增加 GET 过滤用例：cms 返回含 `kind=combo-meal`、`kind=component/active=true`、`kind=component/active=false` 三种 → `GET /offerings` 返回后两种（**保留 active=false**，只剔 combo），覆盖 FR-007。
- [ ] T005 [P] 在 `apps/kith-inn-fe/src/logic/offeringsCrud.test.ts`（新文件）增加注入式 request mock 用例：`createOffering({token,name,mainIngredient?,category},req)` → `POST {BE}/offerings`；`updateOffering({token,id,patch},req)` → `PATCH {BE}/offerings/:id`；`deactivateOffering({token,id},req)` → `DELETE {BE}/offerings/:id`；`restoreOffering({token,id},req)` → `POST {BE}/offerings/:id/restore`；并测 `partitionByActive(offerings)` 把 active 分进 `active` 列表、其余进 `inactive`。覆盖 contracts/be-offerings-api、FR-001/FR-003/FR-005/FR-006。

## Phase 2：shared 写 schema（基础数据与契约）

**目的**: 三端共享写契约；完成前不要开始 route 集成。

- [ ] T006 在 `packages/kith-inn-shared/src/schemas.ts` 新增 `offeringCreateSchema = z.object({ name: z.string().min(1), mainIngredient: z.string().optional(), category: offeringCategorySchema })` 与 `offeringUpdateSchema = z.object({ name: z.string().min(1).optional(), mainIngredient: z.string().optional(), category: offeringCategorySchema.optional() }).refine((d) => Object.keys(d).length > 0, { message: "empty update" })`（默认非 passthrough → 多余字段被 strip = M1 白名单；refine 在 strip 后拒绝空 PATCH → 400，使 handler 靠 `safeParse` 即可挡空体，Codex P2）。`offeringCategorySchema` 已在本文件定义（`z.enum(OFFERING_CATEGORY_VALUES)`），改为 export 以供复用。覆盖 data-model 写输入契约、FR-012。
- [ ] T007 在 `packages/kith-inn-shared/src/types.ts` 用 `z.infer` 推导 `OfferingCreate` / `OfferingUpdate`，不手写平行类型。
- [ ] T008 确认 `offeringCreateSchema`/`offeringUpdateSchema` 从 `@cfp/kith-inn-shared/schemas` 可 import（schemas 不走 root barrel，与现有约定一致——FE/BE/cms 都从子路径 `schemas` 取）。

**Checkpoint**: 写 schema 定义一处、三端共用；多余字段被挡；category 必填限枚举。

## Phase 3：User Story 1 — 新增菜（P1，MVP 切片）

**目标**: 菜品池页能新增一道 component 菜（带 category），新增后进列表 + 按分类进菜单候选池对应位。

**独立测试**: 菜品池新增「蒜蓉空心菜」/ 主料「青菜」/ 分类「素」→ 列表新增并归「青菜」分组；`GET /menu/week` 候选池含新菜且 category=veg。

### Tests for User Story 1

- [ ] T009 [US1] 跑 T001–T005 中与 create 相关的用例，确认实现前失败（目标覆盖 FR-001/FR-002/FR-010/FR-011）。

### Implementation for User Story 1

- [ ] T010 [US1] 在 `apps/cms/src/app/api/internal/offerings/route.ts` 加 `POST`：`operatorScope(req)` → `offeringCreateSchema.safeParse(body)`（失败 400）→ `payload.create({ collection:"offerings", data:{ name, mainIngredient, category, kind:"component", active:true, seller: sellerId }, overrideAccess:true })` → 201 `{doc}`。覆盖 contracts/cms-internal-offerings POST、FR-002/FR-010/FR-011。
- [ ] T011 [US1] 在 `apps/kith-inn-be/src/lib/cms/offerings.ts`（新文件）实现 `createOffering(operatorJwt, input: OfferingCreate, deps: CmsDeps={})`：`POST {cmsBase()}/api/internal/offerings`，header `x-kith-inn-operator` + `content-type`，body=JSON.stringify(input)，`parseOk` 复用 `lib/cms/orders.ts` 模式（非 2xx 抛 `CmsHttpError`），返回 `{doc}`→`Offering`。
- [ ] T012 [US1] 在 `apps/kith-inn-be/src/routes/offerings.ts` 加 `POST "/"`：`sellerAuth`；`offeringCreateSchema.safeParse(body)`（失败 400）；调 `deps.createOffering(token, parsed.data)` → 201 `{offering: doc}`。扩展 `OfferingsDeps = { findOfferings; createOffering }`，默认值用 T011 的实现。
- [ ] T013 [US1] 在 `apps/kith-inn-fe/src/services/api.ts` 确认 `offeringsUrl()` 复用为 create 端点（POST 同 URL），无需新增。
- [ ] T014 [US1] 在 `apps/kith-inn-fe/src/logic/offeringsCrud.ts`（新文件）实现 `createOffering(args:{token; name; mainIngredient?; category}, req=Taro.request)`：调 `req({url: offeringsUrl(), method:"POST", data:{name,mainIngredient,category}, header:{Authorization:`Bearer ${token}`}})`，返回 `res.data.offering`。纯逻辑、可注入 req。
- [ ] T015 [US1] 在 `apps/kith-inn-fe/src/pages/kitchen/index.tsx` 加「新增」入口（NutUI Button → 弹出 Form/Sheet，含菜名 Input + 主料 Input + 分类 Select[荤/素/汤/主食]）→ 调 `logic/offeringsCrud.createOffering` → 成功后 refetch 重建列表；失败 toast。UI 交 e2e，逻辑走 offeringsCrud。

**Checkpoint**: US1 可独立演示：菜品池新增一道带分类的 component 菜，菜单生成按分类选到。

## Phase 4：User Story 2 — 编辑菜名/主料/分类（P1）

**目标**: 原地改 name/mainIngredient/category，id 不变，引用不破坏。

**独立测试**: 改「番茄炒蛋」→「西红柿炒蛋」、主料「鸡蛋」→「番茄」、分类「素」→「荤」，列表对应行更新、分组迁移、id 不变。

### Tests for User Story 2

- [ ] T016 [US2] 跑 T002/T003/T005 中 update 相关用例确认实现前失败（覆盖 FR-003/FR-004/FR-011）。

### Implementation for User Story 2

- [ ] T017 [US2] 在 `apps/cms/src/app/api/internal/offerings/[id]/route.ts`（新文件，参考 `apps/cms/src/app/api/internal/orders/[id]/route.ts`）加 `PATCH`：`operatorScope` → `offeringUpdateSchema.safeParse(body)`（空对象由 T006 的 refine 挡 → 400、name 给了须非空、category 给了须合法）→ find-then-update（`payload.find({ where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] } })` 无命中 404，与 orders/[id] 同形、Codex P2）→ `payload.update({id, data:<白名单 patch>, overrideAccess:true})` → 200 `{doc}`。覆盖 contracts/cms-internal-offerings PATCH、FR-003/FR-004/FR-011/FR-012。
- [ ] T018 [US2] 在 `apps/kith-inn-be/src/lib/cms/offerings.ts` 加 `updateOffering(operatorJwt, id, patch: OfferingUpdate, deps={})` → `PATCH {cmsBase()}/api/internal/offerings/${id}`，返回 doc。
- [ ] T019 [US2] 在 `apps/kith-inn-be/src/routes/offerings.ts` 加 `PATCH "/:id"`：`sellerAuth`；`offeringUpdateSchema.safeParse(body)`（空 400）；调 `deps.updateOffering(token, id, parsed.data)` → 200 `{offering}`。扩 `OfferingsDeps`。
- [ ] T020 [US2] 在 `apps/kith-inn-fe/src/services/api.ts` 加 `offeringDetailUrl(id) = `${beBaseUrl()}/offerings/${id}``（PATCH/DELETE/restore 共用）。
- [ ] T021 [US2] 在 `apps/kith-inn-fe/src/logic/offeringsCrud.ts` 加 `updateOffering(args:{token; id; patch: OfferingUpdate}, req=Taro.request)` → `PATCH offeringDetailUrl(id)`，body=patch。
- [ ] T022 [US2] 在 `apps/kith-inn-fe/src/pages/kitchen/index.tsx` 每行加「编辑」→ 复用新增的 Form（预填当前 name/mainIngredient/category）→ `updateOffering` → 成功 refetch；空菜名/未选分类前端禁用提交。

**Checkpoint**: US1+US2 可演示；编辑保留 id、分类可纠错，引用不破坏。

## Phase 5：User Story 3 — 删除（软停用）+ 恢复（P1）

**目标**: 删除 = `active=false`（移到「已停用」、不进菜单候选）；恢复 = `active=true`（回到「菜品池」、重新进候选）；引用方始终可读。

**独立测试**: 删「蒜蓉空心菜」→ 进「已停用」、`GET /menu/week` 不含它；在「已停用」点恢复 → 回「菜品池」、菜单重新可选；被 order_item 引用的菜删除/恢复后订单仍能展示。

### Tests for User Story 3

- [ ] T023 [US3] 跑 T002/T003/T005 中 deactivate/restore 相关用例确认实现前失败（覆盖 FR-005/FR-006/FR-008/FR-009/FR-011）。

### Implementation for User Story 3

- [ ] T024 [US3] 在 `apps/cms/src/app/api/internal/offerings/[id]/route.ts` 加 `DELETE`；**另**在 `apps/cms/src/app/api/internal/offerings/[id]/restore/route.ts`（新文件——Next.js App Router 下 `/restore` 是独立路径段，不能塞进 `[id]/route.ts`，否则 `POST /:id/restore` 命中不到会 404，Codex P1）加 `POST`（restore）。两处都 `operatorScope` → find-then-update 确认归属（`payload.find({ where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] } })` 无命中 404）→ DELETE: `payload.update({id, data:{active:false}, overrideAccess:true})`；restore: `payload.update({id, data:{active:true}, overrideAccess:true})` → 各 200 `{ok:true}`（幂等）。覆盖 contracts/cms-internal-offerings DELETE/restore、FR-005/FR-006/FR-009/FR-011。
- [ ] T025 [US3] 在 `apps/kith-inn-be/src/lib/cms/offerings.ts` 加 `deactivateOffering(operatorJwt, id, deps={})` → `DELETE .../offerings/${id}`、`restoreOffering(operatorJwt, id, deps={})` → `POST .../offerings/${id}/restore`，均返回 `{ok:true}`（非 2xx 抛 `CmsHttpError`）。
- [ ] T026 [US3] 在 `apps/kith-inn-be/src/routes/offerings.ts` 加 `DELETE "/:id"` 与 `POST "/:id/restore"`：`sellerAuth`；调 `deps.deactivateOffering`/`deps.restoreOffering` → 200 `{ok:true}`。扩 `OfferingsDeps`。
- [ ] T027 [US3] 在 `apps/kith-inn-fe/src/logic/offeringsCrud.ts` 加 `deactivateOffering(args:{token;id}, req=Taro.request)` → `DELETE offeringDetailUrl(id)`；`restoreOffering(args:{token;id}, req=Taro.request)` → `POST offeringDetailUrl(id) + "/restore"`；加 `partitionByActive(offerings): { active: Offering[]; inactive: Offering[] }` 纯函数（FE 分区用）。
- [ ] T028 [US3] 在 `apps/kith-inn-fe/src/pages/kitchen/index.tsx` 每个活跃菜行加「删除」→ 二次确认 → `deactivateOffering` → refetch；新增「已停用」区（`partitionByActive` 的 inactive，按主料或平铺分组）每行加「恢复」→ `restoreOffering` → refetch；失败 toast。

**Checkpoint**: US1–US3 全可演示；删除/恢复不抛 FK 错、引用方始终可读、误删能找回。

## Phase 6：读侧过滤 + 收尾

**目的**: 让「菜品池页只看 component、按 active 分区」生效；文档同步；跑门禁。

- [ ] T029 在 `apps/kith-inn-be/src/routes/offerings.ts` 的 `GET "/"` 加过滤：`(await deps.findOfferings(token)).filter(o => o.kind === "component")`（**不过滤 active**——FE 用 `partitionByActive` 分区），返回给 FE。覆盖 FR-007/FR-008。加 `// ponytail: 仅过滤 kind；active 分区交给 FE partitionByActive，避免 be/cms 两处重复` 注释。
- [ ] T030 [P] 在 `docs/kith-inn/DATA-MODEL.md` §3 offerings 补说明：M1 CRUD 用户维护面 = name + mainIngredient + category；删除 = 软停用 active=false、恢复 = active=true；菜品池页数据源 = `kind=component`（含 active+inactive）FE 按 active 分区（constitution 治理铁律：改数据行为同 PR 更新 docs）。
- [ ] T031 按 `quickstart.md` 跑窄检查：`pnpm --filter @cfp/kith-inn-shared test`、`pnpm --filter @cfp/kith-inn-be test`、`pnpm --filter @cfp/kith-inn-fe test`、`pnpm --filter @cfp/kith-inn-payload test`（应仍绿）。
- [ ] T032 跑 `pnpm verify`，在 PR 描述记录结果；遵守 `AGENTS.md` PR/Codex review 流程（base=main 才自动审；只 rebase merge；逐条 resolve Codex comment）。

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 基线测试**: 无依赖，先红。
- **Phase 2 shared schema**: 依赖 Phase 1 测试明确失败；完成后才开 route 集成。
- **Phase 3 US1（新增）**: 依赖 Phase 2；MVP 切片。
- **Phase 4 US2（编辑）**: 依赖 Phase 2；建 `offerings/[id]/route.ts`（PATCH）。
- **Phase 5 US3（删除+恢复）**: 依赖 Phase 2；DELETE 复用 `[id]/route.ts`、restore 在独立 `[id]/restore/route.ts`（Next.js 路径段）。
- **Phase 6 读过滤 + 收尾**: T029 可与 US1 并行（GET 过滤不依赖写路径）；T030–T032 在所有 US 完成后。

### Parallel Opportunities

- T001、T002、T005 可并行（文件不同）。
- T006–T008（shared）顺序紧凑，但与 T002/T005 的测试设计可并行准备。
- T029（GET 过滤）与 Phase 3–5 写路径互不依赖，可并行。
- T030（docs）任意时机。

### Implementation Strategy

1. Phase 1 + Phase 2（shared 写 schema，含 category）。
2. Phase 3 US1：打通 create 全链路（cms → be → fe）。
3. Phase 4 + Phase 5：复用 `[id]/route.ts` 一次建好 PATCH + DELETE + restore。
4. Phase 6：GET 过滤（kind only）、docs、门禁、PR。

## Parallel Example：User Story 1

```text
Task: "T010 [US1] cms POST /api/internal/offerings"
Task: "T011 [US1] be lib/cms/offerings.ts createOffering"
Task: "T014 [US1] fe logic/offeringsCrud.ts createOffering"
```
（三者文件不同，可并行准备；T012/T015 集成依赖前三者。）

## Out of Scope（deferred，不在此 tasks 内）

combo/parentOfferings 管理、物理删除 + 批量清理、批量导入、采购 recipe、agent 口头改菜品池、并发冲突处理、category 后端推断（已放弃，改用户录入）。cms 写 route 真实 postgres 多租户隔离测试单列 issue 跟踪。见 `spec.md` §假设。
