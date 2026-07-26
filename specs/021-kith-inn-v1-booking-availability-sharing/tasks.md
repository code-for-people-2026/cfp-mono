# Tasks: Kith Inn v1 营业预订与分享定位

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/](./contracts/)

**Tests**: 契约、领域、route、页面纯逻辑和 E2E 均测试先行；真机分享单列人工证据。

## PR 切片

| PR | 目标 / 核心不变量 | 关联故事/需求 | 包含任务 | 允许路径 / 非目标 | 独立验证 | 人工 diff | 依赖 |
|----|-------------------|---------------|----------|-----------------|----------|-----------|------|
| PR1 | 固化营业、可见性和分享定位契约 | US1/US2；FR1-12 | T001-T003、T026 | `specs/021-*`、v1 shared、长期契约文档；不写数据库/UI | shared test/typecheck | 约750 | 无 |
| PR2 | 持久化租户隔离营业关闭和分享目标 | US1/US2；FR6-9 | T004-T007 | v1 payload、CMS；不开放商家 API | CMS tests | 约500 | PR1 |
| PR3a | 只通过受控 API 修改商家默认价 | US1；FR1 | T008a-T009a | v1 BE/CMS seller settings；不做打烊、批量状态、分享 target 或 FE | route tests | 约250 | PR2 |
| PR3b | 只通过 seller/date 锁内受控 API 修改打烊记录 | US1；FR6-8 | T008b-T009b | v1 BE/CMS closure routes；不做批量状态、分享 target 或 FE | route/domain tests | 约650 | PR3a |
| PR3c | 提供最多 20 餐次的逐项批量状态结果 | US1；FR2-5、FR13-15 | T010-T011 | v1 BE meal-slot routes；不做分享 target 或 FE | route/domain tests | 约350 | PR3b |
| PR3d | 校验并暴露日期/餐次分享目标与实时详情 | US2/US3；FR9-12、FR15 | T016-T017 | v1 BE/CMS booking-batch routes；不改 FE | route/domain tests | 约450 | PR3c |
| PR4 | Page 4 配置和批量经营操作 | US1；FR1-8、FR13-16 | T012-T015 | v1 FE；不做分享详情视觉 | unit + E2E | 约650 | PR3d |
| PR5 | 日期/餐次分享和历史实时详情 | US2/US3；FR9-16 | T018-T023 | v1 FE/BE client/E2E；不重构顾客浏览 | unit + E2E | 约500 | PR4 |
| PR6 | 高保真视觉和验收证据 | US3；FR13-16 | T024-T025、T027 | Page 4 CSS/E2E/验收记录；不扩功能 | screenshot + verify + 真机 | 约400 | PR5 |

每片统一执行独立验证、`git diff --check`、人工 diff 统计、`pnpm verify`，并按 `pr-review-converge` 完成 Ready PR、latest-head CI、review、零 unresolved thread 和 rebase merge。

## Phase 1: Setup

- [x] T001 产出并校验 `specs/021-kith-inn-v1-booking-availability-sharing/` 全套规格、契约和 PR 映射

## Phase 2: Foundational

- [x] T002 [P] 为营业关闭、顾客展示状态、默认价设置、批量状态和分享目标补失败契约测试至 `packages/kith-inn-v1-shared/src/api.test.ts` 与新纯逻辑测试
- [x] T003 实现 T002 的 schema、types、exports 和纯展示规则于 `packages/kith-inn-v1-shared/src/`
- [x] T004 [P] 为营业关闭 partial unique indexes、BookingBatch 定位字段及 `closed → open` 可恢复门禁补 Payload/CMS 持久化测试于 `apps/cms/tests/`
- [x] T005 实现对应 collection、target 字段、partial unique index migration 与可恢复状态持久化门禁于 `packages/kith-inn-v1-payload/`、`apps/cms/src/db/`
- [x] T006 [P] 为默认价、target 读写及打烊/开放/订单并发冲突补租户隔离 internal route tests 于 `apps/cms/tests/`
- [x] T007 实现对应 internal routes 和持久化门禁，并让冲突写入共享 seller/date 级事务锁；target 端到端保存后才启用 targeted create schema

## Phase 3: User Story 1 - 安排未来营业与预订

**Independent Test**: 单餐及混合批量开放/停止、整天/单餐打烊、默认价固化和已有订单冲突均返回准确逐项结果。

- [x] T008a [P] [US1] 为 CMS 与商家默认价设置 API 补 route tests 于 `apps/cms/tests/`、`apps/kith-inn-v1-be/src/`
- [x] T009a [US1] 实现 seller-scoped 默认价 API 与 CMS client 于 `apps/cms/src/`、`apps/kith-inn-v1-be/src/`
- [ ] T008b [P] [US1] 为 CMS 关闭 CRUD 与营业关闭商家 API 补 route/domain tests 于 `apps/cms/tests/`、`apps/kith-inn-v1-be/src/`
- [ ] T009b [US1] 实现 seller/date 锁内的 CMS 关闭 CRUD、商家 API、CMS client 和领域校验于 `apps/cms/src/`、`apps/kith-inn-v1-be/src/`
- [ ] T010 [P] [US1] 为批量开放/停止、部分失败和可恢复状态补测试于 `apps/kith-inn-v1-be/src/routes/mealSlots.test.ts`
- [ ] T011 [US1] 实现最多20餐次的逐项批量状态 API 于 `apps/kith-inn-v1-be/src/`
- [ ] T012 [P] [US1] 为 Page 4 上下文、可见性、选择、pending、部分失败和返回模式补纯逻辑测试于 `apps/kith-inn-v1-fe/src/logic/bookingBatches.test.ts`
- [ ] T013 [US1] 扩展严格 API client 于 `apps/kith-inn-v1-fe/src/services/api.ts` 和 `api.test.ts`
- [ ] T014 [US1] 实现默认价、周餐次、单餐/批量开放停止和打烊交互于 `apps/kith-inn-v1-fe/src/pages/merchant/batches/index.tsx`
- [ ] T015 [US1] 补商家经营操作 E2E 于 `apps/kith-inn-v1-e2e/src/merchant.spec.ts`

## Phase 4: User Story 2 - 分享某天或某餐

**Independent Test**: 日期和餐次卡片各自生成准确公开标题、路径和定位，非微信环境不伪装分享成功。

- [ ] T016 [P] [US2] 为 targeted schema 切换、目标创建、旧批次兼容和实时详情补 route tests 于 `apps/kith-inn-v1-be/src/routes/bookingBatches.test.ts`
- [ ] T017 [US2] 在 CMS 已可持久化后切换 targeted create schema，并实现 BookingBatch target 创建、详情和兼容映射于 `apps/kith-inn-v1-be/src/`
- [ ] T018 [P] [US2] 为日期/餐次目标、摘要和微信 payload 补纯逻辑测试于 `apps/kith-inn-v1-fe/src/logic/bookingBatches.test.ts`
- [ ] T019 [US2] 实现 Page 4 创建成功态和微信原生卡片分享于 `apps/kith-inn-v1-fe/src/pages/merchant/batches/index.tsx`
- [ ] T020 [US2] 补日期/餐次分享 E2E 于 `apps/kith-inn-v1-e2e/src/merchant.spec.ts`

## Phase 5: User Story 3 - 查看和管理分享入口

**Independent Test**: 紧凑历史可打开开放、关闭和归档实时详情，并安全再次分享或停用入口。

- [ ] T021 [P] [US3] 为历史排序、三态、实时摘要和复制失败补纯逻辑测试于 `apps/kith-inn-v1-fe/src/logic/bookingBatches.test.ts`
- [ ] T022 [US3] 实现紧凑历史、按需详情和入口管理于 `apps/kith-inn-v1-fe/src/pages/merchant/batches/index.tsx`
- [ ] T023 [US3] 补历史和详情 E2E 于 `apps/kith-inn-v1-e2e/src/merchant.spec.ts`

## Phase 6: Polish & Cross-Cutting

- [ ] T024 实现 375×812 高保真样式于 `apps/kith-inn-v1-fe/src/app.css` 和 Page 4 语义 class
- [ ] T025 [P] 补固定数据视觉状态与截图验收于 `apps/kith-inn-v1-e2e/`
- [x] T026 [P] 更新长期行为和数据文档于 `docs/kith-inn-v1/USER-STORIES.md`、`DATA-MODEL.md`、`TECH-SPEC.md`
- [ ] T027 完成微信真机日期/餐次分享、目标变化和安全区 smoke 并记录于 `specs/021-kith-inn-v1-booking-availability-sharing/quickstart.md`

## Dependencies & Execution Order

`PR1 → PR2 → PR3a → PR3b → PR3c → PR3d → PR4 → PR5 → PR6`。US1 的商家工作流依赖 PR1-3c；US2 依赖 PR3d 的真实餐次状态与目标校验；US3 依赖分享详情。每片合并前不开始下一片。T027 只能按真实设备事实勾选。

## Implementation Strategy

先完成 PR1 的共享契约并收敛；再按持久化、服务、配置 UI、分享/历史、视觉顺序递增交付。顾客端全量实时浏览和商家选择仍属于后续独立规格。
