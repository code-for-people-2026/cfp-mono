# 实施计划：kith-inn 生产接龙解析与订单对账

**分支**: `codex/fix-kith-inn-production-parsing` | **日期**: 2026-07-11 | **规格**: [spec.md](./spec.md)

**输入**: `/specs/012-kith-inn-production-order-parsing/spec.md`

## Summary

把生产 `record_orders` 从“让主 agent 直接猜结构化 items”改为“主 agent 原样转交用户文本，再调用唯一、可评测的订单解析器”：解析器区分完整接龙快照与自然语言单笔增量，输出带原文日期证据的日期、餐次、顾客和份数，确定性校验日期、周几、范围和关键字段，任何风险项都不生成可执行卡。第二个 PR 在现有确认卡与 CMS 事务基础上增加订单对账：完整接龙覆盖目标范围全部订单且不区分此前录入方式，自然语言只修改单一坐标；预览展示新增、更新、退出和未变化，确认时用 operation key 保证同次请求只生效一次、用预览指纹拒绝陈旧数据，并在一个 CMS 事务中应用全部变化。不新增 collection、依赖、平行 agent 或通用导入系统。

## Technical Context

**语言/版本**: TypeScript 5.9，Node.js 20+

**主要依赖**: Hono 4、Zod 4、Payload 3.85.1、Next.js 16.2.9、Taro/NutUI、Vitest 4；DeepSeek chat completion 沿用现有 client

**存储**: PostgreSQL（`cms` schema）；本功能不新增 collection 或字段，沿用 orders/order_items/fulfillments 与 Payload timestamps

**测试**: Vitest 单元与契约测试、真实 PostgreSQL 事务/并发测试、真实 DeepSeek 手动 eval、仓库 `pnpm verify`

**目标平台**: Linux 容器内的 kith-inn-be/CMS 与 Taro 小程序/H5

**项目类型**: pnpm/Turborepo monorepo 中的聊天服务、内部 CMS API 与前端确认卡

**性能目标**: 每次解析只增加一次现有 DeepSeek 普通调用；确认保持一次 BE→CMS 写请求；单次接龙按桃子真实规模（通常几十行、至多低百行）在线完成

**约束**: Asia/Shanghai 日期口径；四字段 fail closed；100% 覆盖门禁；seller JWT 租户隔离；确认前零写入；confirmed 变更同步履约/汇总；不触碰 kith-inn-v1

**规模/范围**: 单卖家 MVP，修改 `apps/kith-inn-be`、`packages/kith-inn-shared`、`apps/cms`、必要 `apps/kith-inn-fe` 与长期文档；预计两个 PR

## Constitution Check

- **I 功能规格**：通过。#155 跨 BE/shared/CMS/必要 FE，修改内部 API 契约并预计两个 PR，使用全套 spec。
- **II Monorepo 作用域**：通过。允许路径已写入 spec；任何 `kith-inn-v1`、菜单内容校验和通用导入能力明确排除。
- **III Brownfield 事实**：通过。生产 agent 直接构造可缺日期的 items，`parseJielong` 仅供 eval 且不含日期；CMS 仅支持原子创建/确认/取消、不支持对账；确认卡用 per-operator pending op 防旧卡。事实见 [research.md](./research.md)。
- **IV 最小切片**：通过。PR 1 只收敛唯一解析链路，PR 2 只增加订单快照/增量对账；复用现有 DeepSeek client、operation-confirm、Payload transaction 和订单状态机。
- **V 验证与审查**：通过。解析/日期纯函数单测、agent 编排测试、CMS 故障注入与并发测试、≥10 段真实模型 eval、`pnpm verify`；每个 PR 按 AGENTS.md 处理 Codex review。
- **VI 中文文档**：通过。规格、计划、契约和长期文档叙述主体使用中文。

**设计后复核**：通过。Phase 1 没有新增依赖、collection、状态或越界项目；两个 PR 都能独立 review，第二个建立在第一个的解析契约上。

## Project Structure

### Documentation (this feature)

```text
specs/012-kith-inn-production-order-parsing/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── production-order-input.md
│   └── order-reconciliation.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/kith-inn-be/
├── eval/
│   ├── jielong/samples.ts
│   └── run-parse.ts
└── src/
    ├── agent/
    │   ├── run.ts
    │   ├── services.ts
    │   └── tools.ts
    ├── domain/orders/
    │   ├── parse.ts
    │   ├── evalAccuracy.ts
    │   └── reconciliation.ts
    ├── lib/cms/orders.ts
    └── routes/chat.ts

packages/kith-inn-shared/src/
├── schemas.ts
└── types.ts

apps/cms/
├── src/app/api/internal/orders/reconcile/route.ts
├── src/lib/orderLifecycle.ts
└── tests/order-reconciliation.test.ts

apps/kith-inn-fe/src/components/ChatCard.tsx

docs/kith-inn/
├── PRD.md
├── USER-STORIES.md
├── DATA-MODEL.md
└── TECH-SPEC.md
```

**结构决策**: LLM 语义抽取与确定性日期校验留在 `apps/kith-inn-be/src/domain/orders`，生产 agent 与 eval 调同一入口；差异计算先作为 BE 纯函数生成确认卡，最终新鲜度校验和多订单写入放在唯一持有数据库事务的 CMS；共享包只承载 BE/FE 都要消费的严格卡片契约。

## PR 切分

### PR 1：生产解析与四字段评测

- 生产 `record_orders` 只接收原始用户文本，由唯一解析器输出模式、范围和四字段候选。
- 严格校验日期证据、周几、餐次和未知片段；缺失或冲突时不生成确认卡。
- 确认卡强制展示完整日期；真实样本补日期 ground truth，eval 覆盖生产入口并记录真实模型结果。
- 不改变现有“确认后逐条创建草稿”的写入语义，因此能独立合并；重复快照更新在 PR 2 完成。

### PR 2：快照对账与自然语言补单

- BE 预览当前订单差异，确认卡展示新增、更新、退出、未变化及增量计算。
- CMS 增加 seller-scoped 原子 reconcile 契约，用预览指纹拒绝陈旧确认，事务内创建/更新/取消订单与履约。
- FE 展示差异与 confirmed 影响；长期文档同步最终快照与增量语义。

## Complexity Tracking

无宪法例外。完整快照需要跨多张订单的 CMS 事务，是满足“最后一次为准且确认后一次生效”的必要复杂度；未引入持久化快照表或来源分账。
