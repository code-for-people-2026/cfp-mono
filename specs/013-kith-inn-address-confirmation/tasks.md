# Tasks：kith-inn 配送地址选填与自动带出

**Input**: `specs/013-kith-inn-address-confirmation/` 下的设计文档

**Tests**: 用户明确要求地址选填且保存后自动带出；真实 PostgreSQL 回归测试是防止未来再次误改为必填的完成条件。

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 包含任务 | 独立验证 | 依赖 |
|----|-------------------|----------|----------|------|
| PR0R | 全面纠正已合并的错误规格，不改运行时 | T001–T003 | checklist、speckit analyze、diff/v1 check | 已合并 #174 |
| PR1 | 通用订单 PATCH 不能改写地址快照或归属/生命周期 | T004–T007 | CMS/BE route 旁路测试、`pnpm verify` | PR0R |
| PR2 | 交互、回归测试和长期文档锁定地址选填与自动带出 | T008–T014 | CMS 真实 PG、BE chat/agent、`pnpm verify` | PR1 |

每个 PR 都从已合并的 `main` 建新 `codex/*` 分支，ready for review 后逐条处理并 resolve Codex comments；无新 comments且 checks 全绿后才 rebase merge并开始下一片。

## Phase 1：规格纠正（PR0R）

**Purpose**: 用桃子实际操作替换“缺地址禁止确认”的错误前提，并阻止原 PR1–PR5 被继续执行。

- [x] T001 把 GitHub #156 与 `specs/013-kith-inn-address-confirmation/spec.md`、`checklists/requirements.md` 纠正为地址选填
- [x] T002 在 `specs/013-kith-inn-address-confirmation/plan.md`、`research.md`、`data-model.md`、`contracts/address-confirmation.md`、`quickstart.md` 和 `tasks.md` 删除确认守卫/补地址 API 路线，改为两片计划
- [x] T003 对 `specs/013-kith-inn-address-confirmation/` 运行 speckit analyze、`git diff --check` 与 v1 路径检查，修正发现并提交 PR0R

**Checkpoint（PR0R）**: 全套规格只表达“地址选填、默认地址供未来订单带出、订单快照不追溯”，没有可执行的必填守卫任务。

---

## Phase 2：订单快照写边界（PR1）

**Purpose**: 关闭通用 PATCH 改写地址、归属和生命周期的既有旁路，同时保留普通付款/日期/餐次/备注更新。

- [x] T004 [P] 在 `apps/cms/src/app/api/internal/orders/[id]/route.test.ts` 增加普通字段通过、address/status/customer/seller/未知字段拒绝或剥离、仅禁用字段 400 与快照不变测试
- [x] T005 在 `apps/cms/src/app/api/internal/orders/[id]/route.ts` 用显式普通字段白名单构造 Payload update data
- [x] T006 [P] 在 `apps/kith-inn-be/src/routes/orders.test.ts` 增加相同白名单、混合 body 不透传禁用字段与仅禁用字段 400 测试
- [x] T007 在 `apps/kith-inn-be/src/routes/orders.ts` 用显式普通字段白名单替代只删除 status 的黑名单

**Checkpoint（PR1）**: 任意通用订单 PATCH 都不能破坏地址快照或租户/生命周期，但既有普通更新保持兼容。

---

## Phase 3：User Story 1 - 地址留空也能完成经营操作（P1，PR2）🎯 MVP

**Goal**: 缺地址顾客可创建订单，缺地址 draft 可确认并产生送餐任务，输入层不要求补录。

**Independent Test**: 真实 PG 中以无地址顾客创建 draft 并确认，得到 confirmed order 与唯一 fulfillment；BE 接龙确认接受空白/缺省地址。

- [ ] T008 [P] [US1] 在 `apps/cms/tests/order-atomicity.test.ts` 增加无地址 customer→draft→confirmed+fulfillment 的真实 PostgreSQL 回归测试
- [ ] T009 [P] [US1] 在 `apps/kith-inn-be/src/routes/chat.test.ts` 扩充新顾客地址缺省与纯空白场景，证明 reconciliation 正常执行且不产生必填错误
- [ ] T010 [P] [US1] 在 `apps/kith-inn-be/src/agent/run.ts` 与 `run.test.ts` 把新顾客提示改为地址选填并继续引导点击确认卡

**Checkpoint（US1）**: 地址缺失不会阻断从接龙确认到送餐任务的主链路。

---

## Phase 4：User Story 2 - 保存一次后续订单自动带地址（P1，PR2）

**Goal**: 首次保存地址后，下一次独立下单无需重复输入即可获得新订单快照。

**Independent Test**: 第一次 reconciliation 创建带地址顾客和订单；第二次用同一顾客 id、新日期且不传地址，新订单仍复制默认地址。

- [ ] T011 [US2] 在 `apps/cms/tests/order-reconciliation.test.ts` 增加跨两次 reconciliation 的默认地址自动带出测试，并覆盖始终无默认地址时后续订单仍可为空

**Checkpoint（US2）**: “填一次、以后自动带出”和“永远不填也能继续”都有真实数据库证据。

---

## Phase 5：User Story 3 - 订单地址保持历史快照（P2，PR2）

**Goal**: 顾客默认地址只服务新订单，不改写旧订单。

**Independent Test**: 已有订单创建后更新 customer 默认地址，再创建新订单；前者保持原值，后者使用新值。

- [ ] T012 [US3] 在 `apps/cms/tests/order-reconciliation.test.ts` 增加 customer 地址变化后旧快照不变、后续新订单使用新值的测试

**Checkpoint（US3）**: 默认资料与订单历史的时间语义由测试锁定。

---

## Phase 6：长期事实与最终验收（PR2）

- [ ] T013 在 `docs/kith-inn/PRD.md`、`USER-STORIES.md`、`DATA-MODEL.md`、`TECH-SPEC.md` 与 `prototype/index.html` 删除地址必填/待补阻断描述，写明选填、未来订单自动带出和无地址兜底
- [ ] T014 执行 `specs/013-kith-inn-address-confirmation/quickstart.md`、`pnpm verify`、diff/v1 检查，核对 SC-001–SC-005 并完成 #156

**Checkpoint（PR2）**: review 无新 comments、checks 全绿并 rebase merge 后关闭 #156，开始 #164。

## Dependencies & Execution Order

- PR0R → PR1 → PR2，严格从合并后的 main 依次推进，不堆叠未审 PR。
- PR1 先封住快照旁路；PR2 再补 US1 主链路、US2/US3 跨订单时间语义和长期文档。
- T004 与 T006 修改不同层的测试，可并行准备；T008–T010 修改不同测试/提示文件，可并行准备；T011 与 T012 修改同一文件，必须顺序执行。

## Implementation Strategy

1. 先合并 PR0R，确保错误方案不再是仓库事实。
2. PR1 只修通用 PATCH 白名单；PR2 只修 Agent 提示并增加最小回归测试和长期文档。
3. 每片 ready PR 均重复“Codex review → 判断/修复/回复 → resolve → `@codex review`”直到没有新 comments。

## Format Validation

- 共 14 项任务，ID 连续为 T001–T014。
- US1 3 项、US2 1 项、US3 1 项；规格纠正 3 项、快照边界 4 项、长期事实与验收 2 项。
- 所有任务均含 checkbox、ID、必要的 `[P]`/`[USn]` 标签和精确文件路径。
