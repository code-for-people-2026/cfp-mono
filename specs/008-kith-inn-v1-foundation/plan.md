# 实施计划：kith-inn-v1 共享 CMS 骨架与数据层

**分支**: `codex/kith-inn-v1-m0-plan` | **日期**: 2026-07-10 | **规格**: [spec.md](./spec.md)

**输入**: `specs/008-kith-inn-v1-foundation/spec.md`

## 摘要

M0 不新建 Payload app。新建 `packages/kith-inn-v1-shared` 和 `packages/kith-inn-v1-payload`，由现有 `apps/cms` 聚合七个 `kiv1_` collections 和 v1 seed；所有表继续落在 PostgreSQL `cms` schema。Payload Admin 仍使用旧 `operators`，`kiv1_operators` 只表示 v1 产品身份。M0 不建空的 FE/BE workspace，不实现业务 API 或 AI。

## 技术上下文

**语言 / 版本**: TypeScript 5.9，Node.js 20+

**主要依赖**: 现有 `apps/cms` 的 Next 16.2、Payload 3.85、React 19.2；新 shared package 使用已安装的 Zod 4.4

**存储**: 现有 PostgreSQL `cms` schema；本地无 PostgreSQL 时沿用 `apps/cms` 的 SQLite fallback

**测试**: Vitest 4；仓库质量门禁为 `pnpm verify`

**目标平台**: 现有 `apps/cms` Node/Next 服务与 Payload Admin

**项目类型**: pnpm + Turborepo monorepo 中的两个 v1 package，装配进一个共享 CMS app

**性能目标**: 不新增 Payload 常驻进程；七个 v1 collection 不改变旧 API 的查询路径

**约束**: 同一 Payload config、同一 `cms` schema；所有 v1 slug/table 使用 `kiv1_` 前缀；不 import 旧业务 package；Admin 身份与 v1 产品身份分离；遵守 100% coverage 与 knip 门禁

**规模 / 作用域**: 1 个 v1 seller、1 个 v1 operator、7 个 v1 collection；只交付模型、共享 host 装配、seed 和验证

## 当前实现事实（Brownfield）

- 当前不存在任何 `kith-inn-v1` app/package，只有 `docs/kith-inn-v1/` 三份草稿文档。
- `pnpm-workspace.yaml` 用 `apps/*`、`packages/*` 自动发现 workspace；新 package 无需改 workspace 清单。
- `apps/website` 是独立 Payload app，使用 PostgreSQL `website` schema；本功能不触碰它。
- `apps/cms` 是给 kith-inn 和后续小项目共用的 Payload host，端口 3304、PostgreSQL schema 固定为 `cms`、本地/未部署阶段使用 schema push。
- `apps/cms/payload.config.ts` 目前只从 `@cfp/kith-inn-payload` 导入旧 collections，`admin.user` 固定为旧 `operators`。
- `apps/cms/seed/run.ts` 目前只编排旧 kith-inn seed；普通 seed 幂等，显式 dev reset 有环境和本地数据库双重保护。
- 旧项目的 internal routes 会验证旧 operator JWT，再使用 Payload local API `overrideAccess`；v1 后续可参考这一信任边界，但必须拥有自己的 route、JWT 和 collection 名称。
- 旧 Payload package 已有 seller stamp、tenant access、关系守卫和 traversal 测试。v1 不 import 这些实现，只参考测试覆盖点。
- 现有长期 v1 data model 有 11 个 collection，其中 `menu_plans`/`meal_slots`、`fulfillments`/`orders` 是一对一，`booking_batch_slots` 只是连接表，`order_items` 在 MVP 明确不使用。
- `apps/cms/tests/spike-coexistence.test.ts` 已验证 `cms` 与 `website` schema 共存；M0 应扩展它验证旧表与 `kiv1_` 表在同一个 `cms` schema 共存。
- 根质量门禁依次运行 lint、typecheck、100% coverage、knip、build；新 package 必须提供对应脚本。

## Review 决策

1. 分享入口统一为 `/pages/booking/index?batchId=...`；`sharePath` 由公开 id 派生，不落库。
2. v1 复用 `apps/cms` 和 `cms` schema；所有 collection/table/API slug 使用 `kiv1_` 前缀隔离，不新增 Payload 实例。
3. `admin.user` 继续是旧 `operators`；`kiv1_operators` 是普通业务身份，后续 v1 API 自己签发和验证 JWT。
4. `customer_profile.openid` 可空，支持桃子为尚未进入小程序的私聊顾客建资料；未绑定资料不能自动暴露给顾客。
5. 数据模型由 11 个 collection 收敛为 7 个：合并 menu plan → meal slot、fulfillment → order，batch 直接 has-many meal slots，删除未使用的 order items。
6. 日历日字段固定存 `YYYY-MM-DD` 文本，避免 datetime 的 UTC 日偏移。

## 宪法检查

### 设计前检查

- **I. 功能规格承载功能工作**: 通过。M0 使用独立 `specs/008-kith-inn-v1-foundation/`。
- **II. Monorepo 作用域必须明确**: 通过。对 `apps/cms` 的允许改动细化到 config/package/seed/tests，旧 internal routes 明确排除。
- **III. 先承认 Brownfield 事实**: 通过。上节记录共享 CMS、Admin user、schema push、seed 和 internal route 事实。
- **IV. 最小可交付切片**: 通过。只建两个实际被共享 CMS 使用的 package；FE、BE 和业务 API 不建空壳。
- **V. 验证和审查属于完成定义**: 通过。自动化和手工验证见 [quickstart.md](./quickstart.md)。
- **VI. 文档默认中文**: 通过。

### 设计后复核

通过。共享 CMS 是明确资源约束，不是临时耦合；v1 业务代码仍归自己的 package，`apps/cms` 只承担聚合。没有未解释的宪法例外。

## 项目结构

### 文档（本功能）

```text
specs/008-kith-inn-v1-foundation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── payload-boundary.md
│   └── shared-cms-assembly.md
└── checklists/
    └── requirements.md
```

### 源代码

```text
packages/kith-inn-v1-shared/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
└── src/
    ├── enums.ts
    ├── schemas.ts
    ├── schemas.test.ts
    ├── types.ts
    └── index.ts

packages/kith-inn-v1-payload/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
└── src/
    ├── payload/
    │   ├── access/cmsAuthenticated.ts
    │   ├── access/cmsAuthenticated.test.ts
    │   ├── hooks/assertSameSellerRefs.ts
    │   ├── hooks/assertSameSellerRefs.test.ts
    │   ├── collections/
    │   │   ├── Sellers.ts
    │   │   ├── Operators.ts
    │   │   ├── CustomerProfiles.ts
    │   │   ├── Offerings.ts
    │   │   ├── MealSlots.ts
    │   │   ├── BookingBatches.ts
    │   │   └── Orders.ts
    │   ├── collections.assert.test.ts
    │   └── index.ts
    └── seed/
        ├── taozi.ts
        ├── taozi.test.ts
        └── index.ts

apps/cms/
├── package.json                         # + @cfp/kith-inn-v1-payload
├── payload.config.ts                    # 聚合 old + v1 collections
├── seed/run.ts                          # 编排 old + v1 seed/reset
└── tests/
    ├── seed-run.test.ts                 # + v1 编排回归
    └── spike-coexistence.test.ts        # + 同 schema 前缀/旧表回归
```

**结构决策**: `apps/cms` 不接收 v1 业务逻辑，只做数组聚合和 seed 编排。M0 不创建 `apps/kith-inn-v1-be`/`fe`；第一个业务切片开始时再创建。

## 实施顺序与 PR 切分

### M0-A：v1 领域契约与 Payload package

- 建立 `@cfp/kith-inn-v1-shared` 的枚举、日期/金额/实体 schema 和类型。
- 建立 `@cfp/kith-inn-v1-payload` 的七个带 `kiv1_` 前缀的 collection、CMS authenticated access、同 seller 关系守卫和 collection traversal 断言。
- 用普通复合唯一索引约束菜名、日期餐次和 profile + meal slot 订单坐标。
- 建立只创建 v1 seller/operator 的幂等 seed；不写共享 host 代码。

独立交付标准：两个 package 可被共享 Payload config 装配，测试通过，依赖图中没有旧 `@cfp/kith-inn-*`。

### M0-B：共享 CMS 装配与回归验证

- `apps/cms` 增加 v1 payload 依赖，并以 `[...kithInnCollections, ...kithInnV1Collections]` 聚合。
- 共享 seed 顺序执行旧 seed 和 v1 seed；reset 仍受现有本地安全守卫保护，并分别调用各项目 reset。
- 扩展 PostgreSQL 集成测试：旧表和七个 `kiv1_` 主表都在 `cms` schema；`website` schema 不变。
- 确认 Admin user、旧 internal routes、健康检查和端口均不变。
- 核对实现未偏离已同步的三份长期文档，并运行 `pnpm verify`；按仓库流程处理 Codex review。

独立交付标准：只启动 3304 的 `apps/cms` 即可装配两套项目 collection，seed 可重复，旧 kith-inn 验证全部通过。

## 风险与止损点

- **共享进程 blast radius**: v1 collection 配置错误会影响 `apps/cms` 启动，因此 M0-B 必须保留旧 collection 清单回归和完整 build。
- **同 schema 命名**: 前缀是硬约束；traversal 测试扫描所有 v1 slug，发现无前缀立即失败。
- **Admin 与产品权限**: 共享 CMS 登录是可信运维面，允许检查所有 v1 seller；商家/顾客隔离必须在未来 v1 internal route 中按自有 JWT 强制执行。
- **schema push**: 只适用于尚无生产数据阶段；首批需保留的真实订单进入前，整个 `apps/cms` 统一转 migration baseline，不能只迁移 v1 子集。
- **精简模型上限**: 当订单确实需要多个商品明细，或一次订单出现多个独立履约任务时，再拆 `order_items`/`fulfillments`。

## Agent 上下文

仓库没有 `update-agent-context` 脚本，也没有待更新的 agent 技术上下文文件；仓库级事实仍以 `AGENTS.md`、`PLAN.md` 和本 spec 为准。

## 复杂度跟踪

无宪法违规。M0-A / M0-B 拆成两个 PR，是为了先审数据契约，再审共享 host 的小范围装配；运行时仍只有一个 Payload 实例。
