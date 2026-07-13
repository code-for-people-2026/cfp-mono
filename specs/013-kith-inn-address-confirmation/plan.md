# 实施计划：kith-inn 缺地址确认守卫

**分支**: 多个 `codex/*` 最小切片（见“PR 拆分计划”） | **日期**: 2026-07-13 | **规格**: [spec.md](./spec.md)

**输入**: `/specs/013-kith-inn-address-confirmation/spec.md`

## Summary

允许接龙或自然语言先保存缺地址草稿，但把“订单地址快照非空”设为 CMS 原子确认事务的统一前置条件；缺地址时返回稳定错误，订单、餐次和履约零变化。新增一个 seller-scoped 原子补地址端点，只允许把 draft 的空地址快照补为非空值，并在同一事务更新该顾客默认地址；确认卡和订单页明确展示“待补地址”，订单页在原订单上下文完成补齐。复用现有 Payload 事务、写锁、Hono 路由和 Taro 输入组件，不新增字段、collection、依赖或 v1 逻辑。

## Technical Context

**语言/版本**: TypeScript 5.9，Node.js 20+

**主要依赖**: Hono 4、Payload 3.85.1、Next.js 16.2.9、Taro 4.2、React 18、Zod 4、Vitest 4

**存储**: PostgreSQL（`cms` schema）；沿用 `customers.address` 与 `orders.address`，无 migration

**测试**: Vitest 单元/契约测试、真实 PostgreSQL 事务与并发测试、仓库 `pnpm verify`

**目标平台**: Linux 容器内的 kith-inn-be/CMS 与 Taro 小程序/H5

**项目类型**: pnpm/Turborepo monorepo 中的 Hono 服务、Next/Payload CMS 和 Taro 前端

**性能目标**: 确认仍为一次 BE→CMS 请求；补地址为一次 BE→CMS 请求和一个短事务；不增加 LLM 调用

**约束**: 缺地址 fail closed；地址补全与确认并发后不得出现 confirmed+空地址；seller JWT 隔离；100% 覆盖门禁；不触碰 kith-inn-v1

**规模/范围**: 单卖家 MVP；允许修改 `apps/cms`、`apps/kith-inn-be`、`apps/kith-inn-fe`、`packages/kith-inn-shared`、`packages/kith-inn-payload` 与 `docs/kith-inn`

## Constitution Check

- **I 功能规格**：通过。#156 跨 CMS/BE/FE/shared、修改内部 API 与生命周期，使用全套 spec。
- **II Monorepo 作用域**：通过。仅触碰上列 kith-inn 路径；`kith-inn-v1` 明确排除。
- **III Brownfield 事实**：通过。当前草稿会快照可空的顾客地址，CMS 确认未校验地址；通用订单 PATCH 不能原子更新顾客和订单；确认卡仅让新客填地址，订单页没有补全入口。详见 [research.md](./research.md)。
- **IV 最小切片**：通过。规格、确认守卫、CMS 原子补全、BE 适配、订单页补全、确认卡提示各为独立 PR；先完成 P1 补全闭环，再交付 P2 的提前提示。
- **V 验证与审查**：通过。每片均有定向测试、`pnpm verify`、v1 路径检查，并按 AGENTS.md 完成 Codex review。
- **VI 中文文档**：通过。功能与长期文档叙述主体均为中文。

**设计后复核**：通过。设计没有新增依赖、字段、collection、通用地址系统或迁移；六片各自只有一个可独立验证的目标。CMS 事务与 BE 适配分开后，运行时 PR 人工 diff 预计均低于 400 行；规划 PR 的全套规格文件若超过 400 行，在 PR 说明列明其交叉引用关系并保持低于 800 行。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 主要路径 | 独立验证 | 依赖 |
|----|----------------------|----------|----------|------|
| PR0 | 固定 #156 行为、契约与后续小切片，不改运行时 | `specs/013-kith-inn-address-confirmation/**` | requirements checklist、speckit analyze、`git diff --check` | 无 |
| PR1 | 任一确认入口都不能让空地址草稿进入经营口径 | `apps/cms/src/lib/orderLifecycle.ts`、CMS 原子测试、BE order service/route/agent、对应长期文档 | CMS 真实 PG 零副作用；BE route 与口头确认返回“先补地址”；`pnpm verify` | PR0 |
| PR2 | CMS 一次补地址原子更新目标订单快照和顾客默认地址，其他订单不变 | CMS lifecycle/internal route/真实 PG 测试、Payload 注释、数据/技术文档 | 成功、回滚、租户、并发、同值重试与 route 边界；`pnpm verify` | PR1 |
| PR3 | BE 只按既定契约暴露 seller-authenticated 补地址 API | BE CMS client/order service/order route 与测试 | JWT/body/响应/错误映射契约；`pnpm verify` | PR2 |
| PR4 | 订单页在原订单上下文完成 P1 补地址闭环，并展示可操作错误 | FE orders page/logic/service、产品文档 | 缺地址识别、端点、保存/刷新/再确认及错误文案测试；`pnpm verify` | PR3 |
| PR5 | 订单录入确认卡准确标出所有将形成缺地址草稿的候选，并完成最终验收 | shared reconciliation row、BE preview、FE `ChatCard`/纯函数、最终长期文档与 quickstart | 新客、既有顾客、既有订单地址三类 preview 与 FE 展示测试；完整 quickstart、`pnpm verify` | PR4 |

## Project Structure

### Documentation (this feature)

```text
specs/013-kith-inn-address-confirmation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── address-confirmation.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/cms/
├── src/lib/orderLifecycle.ts
├── src/app/api/internal/orders/[id]/
│   ├── confirm/route.ts
│   └── address/route.ts
└── tests/order-atomicity.test.ts

apps/kith-inn-be/src/
├── domain/orders/service.ts
├── lib/cms/orders.ts
├── routes/orders.ts
└── agent/services.ts

apps/kith-inn-fe/src/
├── components/ChatCard.tsx
├── logic/orderConfirmView.ts
├── logic/ordersLifecycle.ts
├── pages/orders/index.tsx
└── services/api.ts

packages/kith-inn-shared/src/
├── schemas.ts
└── types.ts

packages/kith-inn-payload/src/payload/collections/Orders.ts

docs/kith-inn/
├── PRD.md
├── USER-STORIES.md
├── DATA-MODEL.md
└── TECH-SPEC.md
```

**结构决策**: 最终一致性守卫与双实体写入留在唯一持有 PostgreSQL 事务的 CMS；BE 只映射稳定错误、暴露 seller-authenticated 路由；shared 只增加确认卡需要的兼容展示字段；FE 用现有订单页和确认卡，不新增页面或状态框架。

## Complexity Tracking

无宪法例外。专用补地址端点是同时维护订单快照和顾客默认地址所需的最小事务边界；通用订单 PATCH 或前端连续调用两个端点都无法保证原子性。
