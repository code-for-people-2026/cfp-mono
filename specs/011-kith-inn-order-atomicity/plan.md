# 实施计划：kith-inn 订单写入与生命周期原子性

**分支**: `codex/fix-kith-inn-order-atomicity` | **日期**: 2026-07-11 | **规格**: [spec.md](./spec.md)

**输入**: `/specs/011-kith-inn-order-atomicity/spec.md`

## Summary

把 kith-inn 的三段多写操作收进 CMS 数据库事务：现有草稿创建接口在同一 Payload request/transaction 中写 order 与全部 order_items；新增 CMS 订单 confirm/cancel 生命周期端点，在单事务内完成 slot、fulfillment 与 order 状态变化；BE 改为调用这两个粗粒度端点，不再跨 HTTP 请求拼接状态机。Postgres 增加每订单最多一条 fulfillment 的唯一索引，作为并发确认的最终约束；不新增依赖、不改变 FE 成功路径，也不触碰 kith-inn-v1。

## Technical Context

**语言/版本**: TypeScript 5.9，Node.js 20+

**主要依赖**: Payload 3.85.1、Next.js 16.2.9、Hono 4、Vitest 4

**存储**: PostgreSQL（`cms` schema）；本地无 `DATABASE_URL` 时 Payload SQLite fallback

**测试**: Vitest 单元/契约测试、真实 PostgreSQL 集成约束测试、仓库 `pnpm verify`

**目标平台**: Linux 容器内的 CMS 与 kith-inn-be 服务

**项目类型**: pnpm/Turborepo monorepo 中的多服务 Web API

**性能目标**: 不增加 FE 用户步骤；每个生命周期动作保持一次 BE→CMS 请求，单订单事务内为常数次数据库操作

**约束**: 100% 覆盖门禁；seller JWT 租户隔离；归档 slot 不自动重开；客户端未知结果可安全重试；不引入新依赖或平行状态机

**规模/范围**: 单卖家 MVP，修改 `apps/cms`、`apps/kith-inn-be`、kith-inn 长期文档及本规格；预计单 PR

## Constitution Check

- **I 功能规格**：通过。#154 涉及 API、索引和生命周期，使用全套 spec。
- **II Monorepo 作用域**：通过。只允许触碰 `apps/cms`、`apps/kith-inn-be`、`docs/kith-inn` 与本规格；不触碰任何 kith-inn-v1 路径。
- **III Brownfield 事实**：通过。现有 BE 跨多个 CMS HTTP 调用编排，CMS 各端点直接使用 Payload Local API，约束由 `ensureConstraints` 补建，事实记录见 [research.md](./research.md)。
- **IV 最小切片**：通过。扩展现有订单端点与 CMS client，不建通用事务 DSL、工作流引擎或第二状态机。
- **V 验证与审查**：通过。单元/契约测试、真实 PostgreSQL 约束与故障注入、`pnpm verify`；PR 按 AGENTS.md 逐条处理 Codex review。
- **VI 中文文档**：通过。规格与长期文档叙述主体使用中文。

**设计后复核**：通过。Phase 1 没有扩大源码路径或引入新依赖；新增的粗粒度 CMS 生命周期端点替换原跨请求编排，不形成平行流程。

## Project Structure

### Documentation (this feature)

```text
specs/011-kith-inn-order-atomicity/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── order-lifecycle.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/cms/
├── src/app/api/internal/orders/
│   ├── route.ts
│   └── [id]/
│       ├── confirm/route.ts
│       └── cancel/route.ts
├── src/lib/
│   ├── internal.ts
│   └── orderLifecycle.ts
├── src/db/ensureConstraints.ts
└── tests/spike-coexistence.test.ts

apps/kith-inn-be/src/
├── domain/orders/
│   ├── service.ts
│   └── service.test.ts
├── lib/cms/
│   ├── orders.ts
│   └── orders.test.ts
└── routes/
    ├── orders.ts
    └── orders.test.ts

docs/kith-inn/TECH-SPEC.md
```

**结构决策**: 数据事务必须落在持有 Payload/Postgres 连接的 `apps/cms`；`apps/kith-inn-be` 保留价格计算和用户侧错误映射，但确认/取消只调用一个 CMS 生命周期端点。CMS 事务编排抽到一个现有项目内的小模块，便于路由复用与故障注入测试，不下沉到 shared/payload 包。

## Complexity Tracking

无宪法例外。
