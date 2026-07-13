# 实施计划：kith-inn 配送地址选填与自动带出

**分支**: 多个 `codex/*` 最小切片（见“PR 拆分计划”） | **日期**: 2026-07-13 | **规格**: [spec.md](./spec.md)

**输入**: `/specs/013-kith-inn-address-confirmation/spec.md`

## Summary

配送地址保持选填：新顾客可以不填地址，缺地址订单仍能确认并进入送餐清单；一旦为顾客保存地址，后续匹配到该顾客的新订单会在创建时复制默认地址为订单快照。Brownfield 主链路已经实现这些行为，但通用订单 PATCH 仍可改写快照，Agent prompt 也仍暗示新客应先填地址。实现分为两个小 PR：先用 BE/CMS 白名单封住快照旁路，再纠正 prompt、补跨两次下单和缺地址确认的回归测试及长期文档；不新增确认守卫、补地址 API、字段或 UI。

## Technical Context

**语言/版本**: TypeScript 5.9，Node.js 20+

**主要依赖**: Hono 4、Payload 3.85.1、Next.js 16.2.9、Taro 4.2、React 18、Vitest 4

**存储**: PostgreSQL（`cms` schema）；沿用可空的 `customers.address` 与 `orders.address`，无 migration

**测试**: Vitest、真实 PostgreSQL 事务测试、仓库 `pnpm verify`

**目标平台**: Linux 容器内的 kith-inn-be/CMS 与 Taro 小程序/H5

**项目类型**: pnpm/Turborepo monorepo 中的 Hono 服务、Next/Payload CMS 和 Taro 前端

**性能目标**: 不增加请求、写入或 LLM 调用；沿用现有记单与确认链路

**约束**: 地址选填；缺地址不得阻断确认；订单地址为创建时快照；100% 覆盖门禁；不触碰 kith-inn-v1

**规模/范围**: 修改 BE/CMS 通用订单 PATCH、Agent prompt、对应测试与 `docs/kith-inn`；不改 schema 或新增 API

## Constitution Check

- **I 功能规格**：通过。#156 曾错误规划为跨层生命周期功能，现用原目录完整纠正，避免仓库保留可执行的错误规格。
- **II Monorepo 作用域**：通过。只触碰 `specs/013-kith-inn-address-confirmation`、`apps/cms/src/app/api/internal/orders/[id]`、`apps/cms/tests/order-*.test.ts`、`apps/kith-inn-be/src/routes/{orders,chat}*`、`apps/kith-inn-be/src/agent/run*` 与 `docs/kith-inn`；`kith-inn-v1` 明确排除。
- **III Brownfield 事实**：通过。现有确认卡地址输入可空，CMS 在创建新订单时复制顾客默认地址，确认不校验地址，送餐分组保留“（无地址）”；同时记录通用 PATCH 透传和 Agent prompt 仍要求填地址的缺口。详见 [research.md](./research.md)。
- **IV 最小切片**：通过。PR0R 只纠正错误设计；PR1 只封住订单快照通用 PATCH 旁路；PR2 只让交互和回归证据符合地址选填事实。
- **V 验证与审查**：通过。两片都运行定向检查、`pnpm verify`/文档检查和 v1 路径守卫，并完成 Codex review。
- **VI 中文文档**：通过。规格和长期文档叙述主体均为中文。

**设计后复核**：通过。没有新增依赖、字段、collection、端点、状态或迁移。PR0R 必须一次同步全套已合并规格，否则 `spec.md`、契约与可执行 `tasks.md` 会互相矛盾；预计人工 diff 超过 400 但低于 800 行，在 PR 说明记录这一不可拆原因。PR1/PR2 各自预计低于 400 行。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 主要路径 | 独立验证 | 依赖 |
|----|----------------------|----------|----------|------|
| PR0R | 用桃子的真实操作纠正 #156 全套规格，确保没有人执行“缺地址禁止确认” | `specs/013-kith-inn-address-confirmation/**` | requirements checklist、speckit analyze、`git diff --check` | 已合并 #174 |
| PR1 | 通用订单 PATCH 只能修改普通字段，不能改地址快照或归属/生命周期 | CMS/BE order PATCH route 与测试 | address/status/customer/seller/未知字段旁路测试、`pnpm verify` | PR0R |
| PR2 | 交互与回归证据锁定“地址选填、保存一次后续带出、历史快照不变” | CMS 真实 PG 测试、BE chat/Agent prompt 与测试、`docs/kith-inn/**` | 真实 PG 定向测试、BE test、`pnpm verify`、v1 guard | PR1 |

## Project Structure

### Documentation (this feature)

```text
specs/013-kith-inn-address-confirmation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/address-confirmation.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/cms/src/app/api/internal/orders/[id]/
├── route.ts
└── route.test.ts
apps/cms/tests/
├── order-atomicity.test.ts
└── order-reconciliation.test.ts

apps/kith-inn-be/src/
├── agent/run.ts
├── agent/run.test.ts
└── routes/
    ├── chat.test.ts
    ├── orders.ts
    └── orders.test.ts

docs/kith-inn/
├── PRD.md
├── USER-STORIES.md
├── DATA-MODEL.md
├── TECH-SPEC.md
└── prototype/index.html
```

**结构决策**: 不重写正确的记单/确认实现；只在现有 BE/CMS route 用显式白名单封住快照旁路，并把现有 Agent 提示从“填好地址”改为“地址选填”。其余工作只补真实 PG 证据和长期文档。

## Complexity Tracking

无宪法例外或新增复杂度。两个生产改动都位于现有边界，不新增 helper 层、端点或依赖；删除其余错误方案仍比实现补地址状态和多层适配更小。
