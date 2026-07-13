# Tasks：kith-inn 缺地址确认守卫

**Input**: `specs/013-kith-inn-address-confirmation/` 下的设计文档

**Tests**: 规格要求确认零副作用、双实体原子写、租户隔离、并发和 FE/BE/data boundary 测试，因此测试任务为必需，且先写失败测试再实现。

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 包含任务 | 独立验证 | 依赖 |
|----|-------------------|----------|----------|------|
| PR0 | 固定完整规格与小 PR 边界，不改运行时 | T001–T002 | checklist、speckit analyze、diff check | 无 |
| PR1 | 缺地址确认在所有入口失败且经营数据零变化 | T003–T009 | CMS 真实 PG、BE service/route/Agent、`pnpm verify` | PR0 |
| PR2 | CMS 原子补地址同时更新目标订单和顾客默认地址 | T010–T014 | CMS domain/route、成功/回滚/租户/并发、`pnpm verify` | PR1 |
| PR3 | BE 按既定契约暴露补地址 API，不承载第二套写逻辑 | T015–T019 | CMS client、order service/route 契约、`pnpm verify` | PR2 |
| PR4 | 订单页在原订单上下文补齐地址，完成 P1 用户闭环 | T020–T025 | FE logic/API、保存/刷新/再确认文案、`pnpm verify` | PR3 |
| PR5 | 订单录入确认卡准确标记缺地址候选并最终验收 | T026–T033 | shared/BE preview/FE 卡片、完整 quickstart、`pnpm verify` | PR4 |

每个 PR 都从已合并的 `main` 建新 `codex/*` 分支，ready for review 后逐条处理并 resolve Codex comments；无新 comments 且 checks 全绿后才 rebase merge 并开始下一片。

## Phase 1：Setup（PR0）

**Purpose**: 先让 #156 的需求、契约、数据语义和六个 PR 边界成为可审查事实。

- [x] T001 核对 `specs/013-kith-inn-address-confirmation/spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/address-confirmation.md`、`quickstart.md` 与 `checklists/requirements.md` 无占位符或矛盾
- [x] T002 对 `specs/013-kith-inn-address-confirmation/` 运行 speckit analyze 与 `git diff --check`，修正发现后提交 PR0

**Checkpoint（PR0）**: 设计 review 通过后再进入任何生产代码；若规划 PR 人工 diff 超过 400 行，PR 说明写明全套 spec 交叉引用不可再拆，且保持低于 800 行。

---

## Phase 2：Foundational

**Purpose**: 本功能复用现有 Payload transaction、`lockOrderReconciliationWrites`、operator JWT 与订单路由，无需新基础设施、依赖、字段或 migration。

**Checkpoint**: PR0 合并即具备实现基础；禁止提前新增通用地址服务、地址表或 v1 适配。

---

## Phase 3：User Story 1 - 缺地址订单不能进入经营口径（P1，PR1）🎯 MVP

**Goal**: 所有确认入口都由 CMS 同一守卫拒绝空地址，并返回可操作提示且不改变订单、餐次或 fulfillment。

**Independent Test**: 对 null/空串/纯空白 draft 分别走 CMS、BE route 与 Agent 口头确认，均得到 missing-address/先补地址且零写入；有效地址仍正常确认。

### Tests for User Story 1

- [ ] T003 [P] [US1] 在 `apps/cms/tests/order-atomicity.test.ts` 增加 null/空串/纯空白拒绝、customer 默认地址非空但 order 快照为空仍拒绝、已有 open slot 时零副作用及有效地址正常确认的真实 PostgreSQL 测试
- [ ] T004 [P] [US1] 在 `apps/kith-inn-be/src/domain/orders/service.test.ts` 与 `apps/kith-inn-be/src/routes/orders.test.ts` 增加 `missing-address` 稳定映射和可操作 `message` 测试
- [ ] T005 [P] [US1] 在 `apps/kith-inn-be/src/agent/services.test.ts` 与 `apps/kith-inn-be/src/routes/chat.test.ts` 增加口头确认返回“请先补地址”的测试

### Implementation for User Story 1

- [ ] T006 [US1] 在 `apps/cms/src/lib/orderLifecycle.ts` 把 trim 后非空订单快照设为 `confirmOrderAtomic` 在任何经营写入前的统一前置条件，并新增 `missing-address` 生命周期错误
- [ ] T007 [US1] 在 `apps/kith-inn-be/src/domain/orders/service.ts` 与 `apps/kith-inn-be/src/routes/orders.ts` 映射 `missing-address` 为 `409` 和“请先补地址再确认订单”
- [ ] T008 [US1] 在 `apps/kith-inn-be/src/agent/services.ts` 让 Agent 口头确认复用同一错误并返回同义提示，不增加旁路检查
- [ ] T009 [US1] 在 `docs/kith-inn/PRD.md`、`docs/kith-inn/USER-STORIES.md`、`docs/kith-inn/TECH-SPEC.md` 同步确认守卫，按 `specs/013-kith-inn-address-confirmation/quickstart.md` 跑 PR1 检查并记录任务完成

**Checkpoint（PR1）**: 安全边界可独立上线；此时缺地址草稿仍需后续 API/UI 补齐，但已不可能静默进入经营口径。

---

## Phase 4：User Story 2 - 从待补状态快速补齐地址（P1，PR2–PR4）

**Goal**: CMS 原子补齐目标 draft 快照和顾客默认地址，BE 只暴露受租户保护的薄契约，订单页在同一行完成一次输入、一次保存并继续确认。

**Independent Test**: 从缺地址订单行保存有效地址，真实 PostgreSQL 中 target order/customer 同值、其他订单不变，刷新后可确认；故障、跨租户、非法状态和并发均失败关闭或得到合法顺序结果。

### PR2 Tests：CMS 原子补地址

- [ ] T010 [P] [US2] 在 `apps/cms/tests/order-atomicity.test.ts` 增加双实体成功且 status 不变、另一历史订单不变、customer/order 故障回滚、空白/租户/状态/同值与异值重试、受控 completion/confirm 并发测试
- [ ] T011 [P] [US2] 在 `apps/cms/src/app/api/internal/orders/[id]/address/route.test.ts` 增加 body 校验、operator seller 隔离、成功响应和四类稳定错误映射的 route 边界测试

### PR2 Implementation：CMS 原子补地址

- [ ] T012 [US2] 在 `apps/cms/src/lib/orderLifecycle.ts` 实现 `completeOrderAddressAtomic`：复用现有写锁和事务，只把缺失 draft 快照补为非空并同步关联 customer，支持同值幂等
- [ ] T013 [US2] 在 `apps/cms/src/app/api/internal/orders/[id]/address/route.ts` 暴露 seller-scoped PATCH 契约并映射 `invalid-address`、`not-found`、`not-draft`、`address-present`
- [ ] T014 [US2] 在 `packages/kith-inn-payload/src/payload/collections/Orders.ts`、`docs/kith-inn/DATA-MODEL.md` 与 `docs/kith-inn/TECH-SPEC.md` 收窄快照注释并记录 CMS 原子补全事实，按 `quickstart.md` 跑 PR2 检查

**Checkpoint（PR2）**: CMS 内部数据边界完整可用；尚未暴露 BE/FE 入口。

### PR3 Tests：BE 补地址契约

- [ ] T015 [P] [US2] 在 `apps/kith-inn-be/src/lib/cms/orders.test.ts` 增加 `PATCH /api/internal/orders/:id/address` 的 JWT/body/响应与稳定错误码契约测试
- [ ] T016 [P] [US2] 在 `apps/kith-inn-be/src/domain/orders/service.test.ts` 与 `apps/kith-inn-be/src/routes/orders.test.ts` 增加 trim、参数校验、成功及 `not-draft`/`address-present`/未知失败映射测试

### PR3 Implementation：BE 补地址契约

- [ ] T017 [US2] 在 `apps/kith-inn-be/src/lib/cms/orders.ts` 增加 address completion 请求/响应类型与薄 CMS client
- [ ] T018 [US2] 在 `apps/kith-inn-be/src/domain/orders/service.ts` 与 `apps/kith-inn-be/src/routes/orders.ts` 增加薄 service/route，不扩张通用订单 PATCH 或重做 CMS 生命周期判断
- [ ] T019 [US2] 在 `docs/kith-inn/TECH-SPEC.md` 同步 BE→CMS 契约，按 `specs/013-kith-inn-address-confirmation/quickstart.md` 运行 BE 与全仓检查

**Checkpoint（PR3）**: seller-authenticated 补地址 API 可独立调用，所有一致性仍由 PR2 CMS 事务保证。

### PR4 Tests：订单页补全闭环

- [ ] T020 [P] [US2] 在 `apps/kith-inn-fe/src/logic/ordersLifecycle.test.ts` 增加 trim 缺地址判定、draft 补全可见性与 confirmed/canceled 不显示补全入口测试
- [ ] T021 [P] [US2] 在 `apps/kith-inn-fe/src/services/api.test.ts` 增加 `orderAddressUrl`，并为订单写错误文案纯函数覆盖 `message` 与通用 fallback

### PR4 Implementation：订单页补全闭环

- [ ] T022 [US2] 在 `apps/kith-inn-fe/src/logic/ordersLifecycle.ts` 与 `apps/kith-inn-fe/src/services/api.ts` 增加最小缺地址/错误显示 helper 和 address endpoint builder
- [ ] T023 [US2] 在 `apps/kith-inn-fe/src/pages/orders/index.tsx` 为缺地址 draft 行内加入“待补地址”、Input/保存地址，成功刷新后才恢复既有确认按钮，并直接显示 BE message
- [ ] T024 [US2] 在 `docs/kith-inn/PRD.md`、`docs/kith-inn/USER-STORIES.md`、`docs/kith-inn/DATA-MODEL.md` 与 `docs/kith-inn/TECH-SPEC.md` 同步订单页补全、快照和错误语义
- [ ] T025 [US2] 按 `specs/013-kith-inn-address-confirmation/quickstart.md` 运行 FE 与全仓检查，并在 `tasks.md` 记录 PR4 完成

**Checkpoint（PR4）**: P1 的守卫、repair API 和订单页 repair→confirm 用户闭环均可独立验收。

---

## Phase 5：User Story 3 - 所有相关界面明确展示待补状态（P2，PR5）

**Goal**: 在已完成订单页状态的基础上，完整接龙和单笔补单确认卡对所有将形成缺地址草稿的候选显示“待补地址”，仍允许先保存 draft。

**Independent Test**: 新客无输入、既有顾客无默认地址、customer 有默认地址但 existing order 快照为空都标记；有有效来源地址不误报，新客输入地址后提示消失。

### Tests for User Story 3

- [ ] T026 [P] [US3] 在 `packages/kith-inn-shared/src/schemas.test.ts` 增加 `addressMissing?: boolean` preview row 的新值与旧卡兼容测试
- [ ] T027 [P] [US3] 在 `apps/kith-inn-be/src/domain/orders/reconciliation.test.ts` 与 `apps/kith-inn-be/src/agent/services.test.ts` 增加三类互斥判定测试：active order 只看订单快照、无 active order 的 existing customer 看默认地址、new customer 看输入
- [ ] T028 [P] [US3] 在 `apps/kith-inn-fe/src/logic/orderConfirmView.test.ts` 增加 row 标记、新客当前输入覆盖初始缺失状态和有效地址不误报测试

### Implementation for User Story 3

- [ ] T029 [US3] 在 `packages/kith-inn-shared/src/schemas.ts` 与 `packages/kith-inn-shared/src/types.ts` 为 reconciliation row 增加向后兼容的展示字段，不把它加入 request base
- [ ] T030 [US3] 在 `apps/kith-inn-be/src/domain/orders/reconciliation.ts` 与 `apps/kith-inn-be/src/agent/services.ts` 按 T027 的互斥分支生成 candidate row 的 `addressMissing`，禁止 active order 回退 customer 默认地址
- [ ] T031 [US3] 在 `apps/kith-inn-fe/src/logic/orderConfirmView.ts` 与 `apps/kith-inn-fe/src/components/ChatCard.tsx` 显示动态“待补地址”，保留缺地址 draft 的确认按钮
- [ ] T032 [US3] 在 `docs/kith-inn/PRD.md` 与 `docs/kith-inn/USER-STORIES.md` 同步订单录入确认卡的提前提示事实
- [ ] T033 [US3] 执行 `specs/013-kith-inn-address-confirmation/quickstart.md` 全部场景、`pnpm verify`、diff/v1 检查，逐项核对 SC-001–SC-006 并完成 #156

**Checkpoint（PR5）**: US1–US3 全部闭环；PR review 无新 comments、checks 全绿并 rebase merge 后关闭 #156，开始 #164。

---

## Dependencies & Execution Order

- PR0 → PR1 → PR2 → PR3 → PR4 → PR5，严格从合并后的 main 依次推进，不堆叠未审 PR。
- US1 守卫先上线，阻止数据损坏；US2 按 CMS data boundary→BE adapter→订单页完成 P1 闭环；最后交付 US3/P2 的确认卡提前提示。
- 每片内部先写失败测试，再写最小实现，最后更新该片改变的长期事实与运行门禁。

## Parallel Opportunities

- PR1 的 CMS、BE route/service、Agent 测试 T003–T005 修改不同文件组，可并行准备。
- PR2 的 CMS domain 与 route 测试 T010–T011 可并行准备。
- PR3 的 BE client 与 service/route 测试 T015–T016 可并行准备。
- PR4 的 FE domain 与 endpoint/error helper 测试 T020–T021 可并行准备。
- PR5 的 shared、BE、FE 测试 T026–T028 可并行准备。
- 不并行实现不同 PR；小 PR 的 review 闭环优先于吞吐量。

## Implementation Strategy

### MVP First

1. PR0 review 固定设计。
2. PR1 完成 US1 的 CMS 权威确认守卫并独立验证；这是最小安全 MVP。
3. PR1 合并后才开始补全能力，避免把安全修复和新写端点混在一次 review。

### Incremental Delivery

1. PR2 在 CMS 内实现原子 repair。
2. PR3 只暴露 BE adapter，不复制一致性逻辑。
3. PR4 让订单页完成 P1 repair→confirm 用户闭环。
4. PR5 在记单确认卡提前暴露缺口并做全功能验收。
5. 每片 ready PR 均重复“Codex review → 判断/修复/回复 → resolve → `@codex review`”直到没有新 comments。

## Format Validation

- 共 33 项任务，ID 连续为 T001–T033。
- US1 7 项、US2 16 项、US3 8 项；Setup 2 项。
- 所有任务均含 checkbox、ID、必要的 `[P]`/`[USn]` 标签和精确文件路径。
