# 任务：kith-inn-v1 共享 CMS 骨架与数据层

**输入**: `specs/008-kith-inn-v1-foundation/` 下的设计文档

**前置材料**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**测试要求**: 本功能涉及 schema、复合索引、租户关系守卫和 seed 幂等性，按规格要求先补失败测试，再写实现；每个 PR 都运行相关窄测试和 `pnpm verify`。

**组织方式**: 任务按用户故事和 `plan.md` 的 PR 切分组织。M0-A 只新增两个 v1 package；M0-B 必须等 M0-A 合并后，才装配 `apps/cms`。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**: 可与同阶段其他任务并行，修改不同文件且不依赖未完成任务
- **[Story]**: 对应 `spec.md` 的用户故事
- 每项任务都包含精确文件路径

## Phase 1：M0-A Workspace 初始化

**目的**: 建立两个会被后续代码实际使用的 package，不创建空的 v1 FE/BE workspace。

- [x] T001 [P] 创建 `@cfp/kith-inn-v1-shared` 的脚本、exports、TypeScript、ESLint 和 Vitest/100% coverage 配置：`packages/kith-inn-v1-shared/package.json`、`packages/kith-inn-v1-shared/tsconfig.json`、`packages/kith-inn-v1-shared/eslint.config.mjs`、`packages/kith-inn-v1-shared/vitest.config.ts`
- [x] T002 [P] 创建只依赖 `@cfp/kith-inn-v1-shared` 与 Payload 的 `@cfp/kith-inn-v1-payload` 配置：`packages/kith-inn-v1-payload/package.json`、`packages/kith-inn-v1-payload/tsconfig.json`、`packages/kith-inn-v1-payload/eslint.config.mjs`、`packages/kith-inn-v1-payload/vitest.config.ts`
- [x] T003 安装并锁定两个新 workspace 的既有依赖，不新增规格外依赖：`pnpm-lock.yaml`

---

## Phase 2：M0-A 共享基础

**目的**: 为七个 collection 提供独立的 v1 枚举/schema、CMS access 和同 seller 关系校验。

**⚠️ 关键依赖**: 本阶段完成前不得开始 collection 配置。

- [x] T004 [P] 为全部枚举、合法/非法 `YYYY-MM-DD`、非负整数金额、正整数份数及七个实体输入补失败测试：`packages/kith-inn-v1-shared/src/schemas.test.ts`
- [x] T005 实现 v1 枚举、Zod schema、导出类型和 package barrel，且不 import 旧 `@cfp/kith-inn-*`：`packages/kith-inn-v1-shared/src/enums.ts`、`packages/kith-inn-v1-shared/src/schemas.ts`、`packages/kith-inn-v1-shared/src/types.ts`、`packages/kith-inn-v1-shared/src/index.ts`
- [x] T006 [P] 为“未认证 deny、共享 CMS 已认证用户 allow”补 access 失败测试：`packages/kith-inn-v1-payload/src/payload/access/cmsAuthenticated.test.ts`
- [x] T007 实现共享 CMS authenticated access 函数：`packages/kith-inn-v1-payload/src/payload/access/cmsAuthenticated.ts`
- [x] T008 [P] 为 create/update seller 推导、顶层 relationship、has-many 和 `menuItems[].offering` 的同 seller/跨 seller分支补失败测试：`packages/kith-inn-v1-payload/src/payload/hooks/assertSameSellerRefs.test.ts`
- [x] T009 实现独立、原子失败且可遍历嵌套/has-many relationship 的同 seller 守卫：`packages/kith-inn-v1-payload/src/payload/hooks/assertSameSellerRefs.ts`

**Checkpoint**: shared 契约、access 和关系守卫可独立测试，依赖图中没有旧 kith-inn 业务 package。

---

## Phase 3：用户故事 2——同 schema 内无碰撞共存（P1，M0-A）🎯

**目标**: 提供恰好七个 `kiv1_` collection，完整表达字段、普通复合索引和 v1-only relationships，供后续共享 CMS 装配。

**独立测试**: 仅导入 `@cfp/kith-inn-v1-payload`，断言 collection 数量为 7、slug/table 均有 `kiv1_` 前缀、Admin group 以“街坊味 v1”开头、relationship 只指向 v1 slug，且所有约定普通复合索引存在。

### 测试

- [x] T010 [US2] 先为 collection 数量/顺序、前缀、Admin group、字段、v1-only relationships 和 `data-model.md` 最小索引清单（含单字段、查询复合与 unique 索引）补失败断言：`packages/kith-inn-v1-payload/src/payload/collections.assert.test.ts`

### 实现

- [x] T011 [P] [US2] 实现 v1 租户根与 `(seller, wechatOpenid)` 唯一 membership collection：`packages/kith-inn-v1-payload/src/payload/collections/Sellers.ts`、`packages/kith-inn-v1-payload/src/payload/collections/Operators.ts`
- [x] T012 [P] [US2] 实现顾客“称呼 + 地址”资料和菜品 collection 及其普通复合索引：`packages/kith-inn-v1-payload/src/payload/collections/CustomerProfiles.ts`、`packages/kith-inn-v1-payload/src/payload/collections/Offerings.ts`
- [x] T013 [P] [US2] 实现含日历日、菜单快照、预订状态和 `(seller, date, occasion)` 唯一索引的餐次 collection：`packages/kith-inn-v1-payload/src/payload/collections/MealSlots.ts`
- [x] T014 [P] [US2] 实现直接 has-many 餐次、全局唯一 `publicId` 的预订批次 collection：`packages/kith-inn-v1-payload/src/payload/collections/BookingBatches.ts`
- [x] T015 [P] [US2] 实现订单快照/三状态轴和 `(seller, mealSlot, customerProfile)` 唯一索引的订单 collection：`packages/kith-inn-v1-payload/src/payload/collections/Orders.ts`
- [x] T016 [US2] 按稳定顺序导出恰好七个 v1 collections：`packages/kith-inn-v1-payload/src/payload/index.ts`

**Checkpoint**: M0-A package 可被任意 Payload config 直接聚合，且不会碰撞旧 collection slug。

---

## Phase 4：用户故事 3——身份与数据边界不混用（P1，M0-A）

**目标**: `kiv1_operators` 保持普通业务 collection；所有 v1 collection 默认拒绝未认证请求；所有 seller-owned 写入拒绝跨 seller relationship。

**独立测试**: 用纯 collection config 和 mock Payload 请求验证 `kiv1_operators` 未启用 auth、seller 字段必填、未认证 access 被拒绝，以及顶层/has-many/嵌套跨 seller 关系全部原子失败。

### 测试

- [x] T017 [US3] 扩充配置断言，先覆盖 `kiv1_operators` 非 auth、seller-owned collection 的必填 seller/access/hook，以及 seller 禁止 delete：`packages/kith-inn-v1-payload/src/payload/collections.assert.test.ts`

### 实现

- [x] T018 [US3] 将 CMS access、seller delete 规则和同 seller relationship hooks 装配到七个 collection：`packages/kith-inn-v1-payload/src/payload/collections/Sellers.ts`、`packages/kith-inn-v1-payload/src/payload/collections/Operators.ts`、`packages/kith-inn-v1-payload/src/payload/collections/CustomerProfiles.ts`、`packages/kith-inn-v1-payload/src/payload/collections/Offerings.ts`、`packages/kith-inn-v1-payload/src/payload/collections/MealSlots.ts`、`packages/kith-inn-v1-payload/src/payload/collections/BookingBatches.ts`、`packages/kith-inn-v1-payload/src/payload/collections/Orders.ts`

**Checkpoint**: Admin 身份和 v1 产品身份不混用，跨 seller 引用在 package 边界被拒绝。

---

## Phase 5：用户故事 4——可重复初始化桃子资料（P2，M0-A）

**目标**: 提供独立且幂等的 v1 桃子 seller/operator seed，不查询、修改或删除旧 collection。

**独立测试**: 使用 mock Payload local API 连续执行两次 seed；第一次只创建一条 v1 seller/operator，第二次返回 skipped 且无新增；已有 seller 但 operator 缺失时可恢复补齐。

### 测试

- [x] T019 [US4] 先覆盖首次创建、完整数据跳过、部分失败恢复、v1-only collection 调用和七个 v1 collection 的 FK-safe reset slug 顺序：`packages/kith-inn-v1-payload/src/seed/taozi.test.ts`

### 实现

- [x] T020 [US4] 实现独立、幂等、可重试的桃子 seller/operator seed，并导出稳定 seed 入口与仅描述 v1 collections 的 FK-safe reset slug 顺序（不在 package 内执行删除）：`packages/kith-inn-v1-payload/src/seed/taozi.ts`、`packages/kith-inn-v1-payload/src/seed/index.ts`

---

## Phase 6：M0-A PR 验证

**目的**: 在不修改 `apps/cms` 和旧业务 package 的前提下完成首个可审查 PR。

- [x] T021 运行两个新 package 的 lint、typecheck、100% coverage、build 窄检查并执行仓库 `pnpm verify`，将完成状态记录在 `specs/008-kith-inn-v1-foundation/tasks.md`
- [x] T022 检查 M0-A diff 只包含 `packages/kith-inn-v1-shared/**`、`packages/kith-inn-v1-payload/**`、`specs/008-kith-inn-v1-foundation/tasks.md` 和 `pnpm-lock.yaml`，并确认不存在 `apps/kith-inn-v1-fe/**`、`apps/kith-inn-v1-be/**`、`apps/cms/**` 或旧 `@cfp/kith-inn-*` 业务 package 改动：`specs/008-kith-inn-v1-foundation/tasks.md`

**M0-A 独立交付标准**: T001–T022 完成后提交 draft PR；M0-B 任务保持未勾选，等待 M0-A 合并后再开始。

---

## Phase 7：用户故事 1——在现有 CMS 中装配 v1（P1，M0-B）

**目标**: M0-A 合并后，在现有 `apps/cms` 聚合 v1 collection，不新增 Payload app、端口或进程。

**独立测试**: 仅启动 `apps/cms`，旧 collections 与七个 v1 collections 同时注册；`admin.user`、schema、端口、health 和旧 routes 保持不变。

### 测试

- [ ] T023 [US1] 先为 old + v1 collection 聚合、`admin.user=operators`、`schemaName=cms`、health 和无第二 Payload host 补失败回归：`apps/cms/tests/spike-coexistence.test.ts`

### 实现

- [ ] T024 [US1] 增加 v1 payload workspace 依赖并聚合 collections，保持 adapter/Admin/onInit/routes 不变：`apps/cms/package.json`、`apps/cms/payload.config.ts`、`pnpm-lock.yaml`

**Checkpoint**: `apps/cms` 是唯一共享 Payload host，v1 collection 已装配但没有业务 API。

---

## Phase 8：用户故事 2/3——共享 schema 与身份边界回归（P1，M0-B）

**目标**: 证明旧表和 v1 表在同一个 `cms` schema 无碰撞共存，并确保旧 Admin/collection 行为不回归。

**独立测试**: 在 PostgreSQL 启动共享 config，验证旧主表和七个 `kiv1_` 主表都位于 `cms`，`public`/`website` 无 v1 表，且未认证 v1 请求被拒绝。

- [ ] T025 [US2] 扩展 PostgreSQL 共存测试，覆盖七个 v1 主表前缀、完整最小索引清单、同 seller 重复 operator openid 拒绝、跨 seller 同 openid 允许、旧表保留和 `public`/`website` schema 无 v1 表：`apps/cms/tests/spike-coexistence.test.ts`
- [ ] T026 [US3] 扩展共享 config 回归，覆盖旧 Admin user 不变、`kiv1_operators` 非 auth、未认证 deny 和旧 internal routes 不变：`apps/cms/tests/spike-coexistence.test.ts`

---

## Phase 9：用户故事 4——共享 seed 编排（P2，M0-B）

**目标**: 共享 seed 入口按顺序调用旧/v1 seed，重复执行不清库，reset 继续复用现有单一安全守卫。

**独立测试**: 连续运行两次 `@cfp/cms` seed，旧结果不变且 v1 seller/operator 各一条；模拟 v1 seed 首次失败后再次执行可恢复。

### 测试

- [ ] T027 [US4] 先为旧 seed 后 v1 seed 的顺序、seeded/skipped 结果、失败重试和 reset FK-safe 编排补失败回归：`apps/cms/tests/seed-run.test.ts`

### 实现

- [ ] T028 [US4] 在共享入口编排两个 package 的 seed/reset，同时保留环境与本地数据库安全守卫：`apps/cms/seed/run.ts`

---

## Phase 10：M0-B 收口与完整验证

**目的**: 完整验证 M0 规格并确认长期文档没有实现漂移。

- [ ] T029 运行 shared、payload、CMS 窄测试和 PostgreSQL 共存测试，按 `specs/008-kith-inn-v1-foundation/quickstart.md` 验证共享 host/seed
- [ ] T030 [P] 核对分享路由、same-schema、openid 可空、七 collection 和 M0 非目标；仅在实现决策发生变化时同步 `docs/kith-inn-v1/USER-STORIES.md`、`docs/kith-inn-v1/TECH-SPEC.md`、`docs/kith-inn-v1/DATA-MODEL.md`
- [ ] T031 运行仓库 `pnpm verify` 并将完整 M0 完成状态记录在 `specs/008-kith-inn-v1-foundation/tasks.md`

---

## 依赖与执行顺序

### Phase 依赖

- **Phase 1（M0-A 初始化）**: 无依赖。
- **Phase 2（M0-A 共享基础）**: 依赖 Phase 1；阻塞所有 collection 工作。
- **Phase 3（US2 / M0-A collections）**: 依赖 Phase 2。
- **Phase 4（US3 / M0-A 身份与 seller 边界）**: 依赖 Phase 3 的 collection config。
- **Phase 5（US4 / M0-A seed）**: 依赖 Phase 3 的 seller/operator collection；可与 Phase 4 的 config 装配并行。
- **Phase 6（M0-A 验证）**: 依赖 Phase 1–5；完成后停止并提交 M0-A。
- **Phase 7–9（M0-B）**: 必须等待 M0-A 合并进 `main`，不得在 M0-A 分支实施。
- **Phase 10（M0-B 收口）**: 依赖 Phase 7–9。

### 用户故事依赖

- **US2（P1）**: M0-A 可独立提供无碰撞的 v1 collection package；M0-B 再证明同 schema 运行时共存。
- **US3（P1）**: 依赖 US2 的 collection config，但 access/guard 纯逻辑可提前独立测试。
- **US4（P2）**: M0-A seed 依赖 sellers/operators；M0-B 共享编排依赖 M0-A package 已合并。
- **US1（P1）**: 运行时装配属于 M0-B，依赖完整 M0-A package；不反向阻塞 M0-A 独立交付。

### 每个故事内部顺序

- 测试任务必须先执行并观察到因缺少目标实现而失败。
- 纯函数/schema/collection config 完成后，再做 package 或共享 host 聚合。
- M0-A 通过后才允许改 `apps/cms`；M0-B 完成后才验证共享 PostgreSQL schema。

### 可并行机会

- T001 与 T002 可并行创建 package 配置。
- T004、T006、T008 可并行编写三个基础模块的失败测试。
- T011–T015 可在 T010 失败后按文件并行实现 collections。
- T018 与 T019–T020 可并行，因为分别修改 collection config 和 seed 文件。
- M0-B 中 T025 与 T027 可先分别编写 schema/seed 回归，但实现仍遵守各自测试优先顺序。

---

## 并行示例：M0-A

```text
并行：T001 shared package 配置 | T002 payload package 配置
并行：T004 shared schema 测试 | T006 access 测试 | T008 relationship guard 测试
并行：T011 sellers/operators | T012 profiles/offerings | T013 meal slots | T014 batches | T015 orders
```

## 并行示例：M0-B

```text
先执行：T023 共享 config 失败回归
并行准备：T025 PostgreSQL schema 回归 | T027 seed 编排回归
最后串行：T029 窄验证 → T031 pnpm verify
```

---

## 实施策略

### 当前 MVP：M0-A

1. 完成 Phase 1–2，建立两个 package 和独立基础能力。
2. 完成 US2 的七个 collection 与普通复合索引。
3. 完成 US3 的 access/relationship 边界。
4. 完成 US4 的独立幂等桃子 seed。
5. 执行 Phase 6 后停止；开 M0-A draft PR，不修改 `apps/cms`。

### 后续增量：M0-B

1. M0-A 合并后，从最新 `main` 创建新分支。
2. 完成 US1 的共享 CMS 装配。
3. 增加 same-schema、旧行为和共享 seed 回归。
4. 通过 Phase 10 后提交独立 M0-B PR。

## 备注

- 本任务清单不创建 `apps/kith-inn-v1-fe`、`apps/kith-inn-v1-be`，不实现业务 API、微信登录、分享 UI、订单状态动作或 AI。
- M0-A 不修改 `apps/cms`；M0-B 不修改旧 `@cfp/kith-inn-*` 业务 package。
- 普通复合索引使用 Payload collection `indexes` 表达，不增加 `onInit` SQL 或 partial predicate。
- 每个 PR 都必须逐条处理 Codex review，并 resolve 所有重要 comment。
