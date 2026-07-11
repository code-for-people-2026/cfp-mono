# Tasks：kith-inn 订单写入与生命周期原子性

**Input**: `specs/011-kith-inn-order-atomicity/` 下的设计文档

**Tests**: 规格 FR-012 明确要求故障注入、重试与真实数据层约束测试，测试任务为必需。

## Phase 1：Setup

**Purpose**: 确认当前 feature 目录、分支与测试入口，不新增依赖或脚手架。

- [x] T001 核对 `specs/011-kith-inn-order-atomicity/plan.md` 的源码范围与当前分支，并记录 `apps/cms/package.json`、`apps/kith-inn-be/package.json` 现有测试命令

---

## Phase 2：Foundational

**Purpose**: 建立所有原子写入共用的 Payload 事务边界和数据库最终约束。

- [x] T002 在 `apps/cms/src/lib/internal.ts` 增加复用同一 Payload request 的 commit/rollback 事务 helper
- [x] T003 在 `apps/cms/src/db/ensureConstraints.ts` 增加 `fulfillments(seller_id,order_id)` 唯一索引
- [x] T004 在 `apps/cms/tests/spike-coexistence.test.ts` 增加真实 PostgreSQL fulfillment 唯一约束验证

**Checkpoint**: CMS 已有可复用事务边界，并能从数据库层阻止同订单重复 fulfillment。

---

## Phase 3：User Story 1 - 记单失败不留下半张订单（P1）🎯 MVP

**Goal**: order 与全部 order_items 成功时一起可见，任意写入失败时一起回滚。

**Independent Test**: 第二条 item create 注入异常后查不到 order/items；移除异常后相同业务坐标可成功创建完整草稿。

- [x] T005 [US1] 在 `apps/cms/tests/order-atomicity.test.ts` 编写草稿多明细故障注入与回滚测试
- [x] T006 [US1] 在 `apps/cms/src/app/api/internal/orders/route.ts` 用同一事务 request 包裹 order 与全部 order_items 写入

**Checkpoint**: 草稿创建是独立可验证的原子切片。

---

## Phase 4：User Story 2 - 确认订单只产生一套经营状态（P1）

**Goal**: slot、fulfillment 与 confirmed order 在一次事务中出现；重复、并发与未知结果重试不重复物化。

**Independent Test**: 对每个确认写入点故障注入并重试，最终只能得到完整 draft 零副作用或 confirmed + open slot + 恰好一条 fulfillment。

- [x] T007 [US2] 在 `apps/cms/tests/order-atomicity.test.ts` 编写确认成功、逐阶段回滚、归档拒绝、重复与并发确认测试
- [x] T008 [US2] 在 `apps/cms/src/lib/orderLifecycle.ts` 实现 seller-scoped 的原子确认与幂等读回
- [x] T009 [US2] 在 `apps/cms/src/app/api/internal/orders/[id]/confirm/route.ts` 暴露原子确认契约及稳定错误码
- [x] T010 [US2] 在 `apps/kith-inn-be/src/lib/cms/orders.ts`、`apps/kith-inn-be/src/domain/orders/service.ts`、`apps/kith-inn-be/src/routes/orders.ts` 把确认改成单次 CMS 调用并保持对外语义
- [x] T011 [US2] 在 `apps/kith-inn-be/src/lib/cms/orders.test.ts`、`apps/kith-inn-be/src/domain/orders/service.test.ts`、`apps/kith-inn-be/src/routes/orders.test.ts` 覆盖确认契约和错误映射

**Checkpoint**: 确认路径可单独验证，不再依赖细粒度 slot/fulfillment 写接口编排。

---

## Phase 5：User Story 3 - 取消订单不会留下经营缺口（P2）

**Goal**: order 与 fulfillment 一起取消；重复取消返回等价完成结果。

**Independent Test**: 在 fulfillment/order 更新处分别故障注入，失败后无半取消；重试后两者均 canceled，第二次取消仍成功。

- [x] T012 [US3] 在 `apps/cms/tests/order-atomicity.test.ts` 编写取消逐阶段回滚与幂等重试测试
- [x] T013 [US3] 在 `apps/cms/src/lib/orderLifecycle.ts` 与 `apps/cms/src/app/api/internal/orders/[id]/cancel/route.ts` 实现并暴露原子取消
- [x] T014 [US3] 在 `apps/kith-inn-be/src/lib/cms/orders.ts`、`apps/kith-inn-be/src/domain/orders/service.ts`、`apps/kith-inn-be/src/routes/orders.ts` 及对应测试中把取消改成单次 CMS 调用

**Checkpoint**: 取消路径可单独验证，经营口径不会观察到半取消。

---

## Phase 6：Polish & Cross-Cutting Concerns

**Purpose**: 同步长期架构事实并完成全仓质量门禁。

- [x] T015 在 `docs/kith-inn/TECH-SPEC.md` 更新事务边界、粗粒度内部端点与 fulfillment 唯一约束
- [x] T016 运行 `specs/011-kith-inn-order-atomicity/quickstart.md` 中的相关测试和 `pnpm verify`，修复所有回归
- [x] T017 检查 `git diff --check`、确认无 `kith-inn-v1` 文件变化，并在 `specs/011-kith-inn-order-atomicity/tasks.md` 勾选完成任务

---

## Dependencies & Execution Order

- Phase 1 → Phase 2，事务 helper 和唯一索引阻塞全部用户故事。
- US1 完成后再做 US2，先证明最小事务模式再扩展生命周期。
- US2 → US3，共用 `orderLifecycle.ts` 与 BE 粗粒度 client 契约。
- 长期文档与全仓验证在三个故事全部完成后执行。

## Parallel Opportunities

本功能由单 agent 顺序清理且多个任务修改相同文件，刻意不标记 `[P]`。真实 PostgreSQL 约束测试可在 BE 单元测试运行时并行，但不改变任务依赖顺序。

## Implementation Strategy

1. 先交付 US1，验证 Payload request 事务模式能可靠回滚。
2. 在同一模式上完成 US2，并用数据库唯一索引兜住并发确认。
3. 复用生命周期模块完成 US3，不引入通用状态机。
4. 三个故事作为 #154 的一个完整 PR：它们共同修复同一 P0 一致性边界，拆开会让中间版本仍保留半原子生命周期。

## Format Validation

共 17 项任务：Setup 1、Foundational 3、US1 2、US2 5、US3 3、Polish 3。所有任务均使用 checkbox、顺序 ID、必要的 `[USn]` 标签和精确文件路径。
