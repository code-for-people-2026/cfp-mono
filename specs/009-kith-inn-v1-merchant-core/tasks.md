# Tasks: 街坊味 v1 商家核心闭环

**Input**: Design documents from `/specs/009-kith-inn-v1-merchant-core/`

**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/](./contracts/)、[quickstart.md](./quickstart.md)

**Tests**: 本功能含认证、租户隔离、导入解析、菜单规则和订单状态机。所有非平凡逻辑与信任边界必须先补失败测试，再写实现；shared/BE/FE 可执行纯逻辑继续保持 100% coverage。

**Organization**: 任务按 M1-A/B/C 三个顺序 PR 与三个用户故事组织。后一个 PR 只在前一个 rebase merge 后从最新 `main` 开始，不建堆叠 PR。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与同阶段其他任务并行，修改不同文件且不依赖未完成实现
- **[US1]**: 登录并维护菜品池（M1-A）
- **[US2]**: 生成并调整菜单（M1-B）
- **[US3]**: 手动记录并完成订单（M1-C）

---

## Phase 1：M1-A Workspace 与工程入口

**Purpose**: 只为第一个实际功能切片建立 v1 BE/FE；本阶段结束时 workspace 还不能单独交付，必须继续完成 Phase 2–3。

- [ ] T001 从 M1 规格 PR 合并后的最新 `main` 创建 M1-A 分支，确认 `apps/kith-inn-v1-be/**`、`apps/kith-inn-v1-fe/**` 仍不存在，并在 `specs/009-kith-inn-v1-merchant-core/tasks.md` 记录起点提交
- [ ] T002 初始化可运行的 `@cfp/kith-inn-v1-be` Hono workspace 与 3311 health/boot 配置：`apps/kith-inn-v1-be/package.json`、`apps/kith-inn-v1-be/.env.example`、`apps/kith-inn-v1-be/eslint.config.mjs`、`apps/kith-inn-v1-be/tsconfig.json`、`apps/kith-inn-v1-be/vitest.config.ts`、`apps/kith-inn-v1-be/src/index.ts`、`apps/kith-inn-v1-be/src/app.ts`、`apps/kith-inn-v1-be/src/routes/health.ts`
- [ ] T003 [P] 初始化不含 NutUI/Tailwind 的 `@cfp/kith-inn-v1-fe` Taro workspace、10087 H5/weapp 构建和最小商家 app shell：`apps/kith-inn-v1-fe/package.json`、`apps/kith-inn-v1-fe/.env.example`、`apps/kith-inn-v1-fe/babel.config.js`、`apps/kith-inn-v1-fe/config/index.ts`、`apps/kith-inn-v1-fe/eslint.config.mjs`、`apps/kith-inn-v1-fe/tsconfig.json`、`apps/kith-inn-v1-fe/vitest.config.ts`、`apps/kith-inn-v1-fe/src/index.html`、`apps/kith-inn-v1-fe/src/app.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts`、`apps/kith-inn-v1-fe/src/app.css`
- [ ] T004 注册两个 workspace、v1 独立 secrets 和 direct shared 依赖，保持旧环境变量/端口不变：`apps/cms/package.json`、`apps/cms/.env.example`、`turbo.json`、`knip.json`、`pnpm-lock.yaml`

**Checkpoint**: 两个 workspace 能进入 lint/typecheck/build 图，但不得在此提交空壳 PR。

---

## Phase 2：M1-A 认证与 tenant 基础（阻塞 US1–US3）

**Purpose**: 建立 v1 独立 JWT、登录 bootstrap、多 seller 选择和 CMS membership revalidation；所有后续 route 都复用该边界。

**⚠️ CRITICAL**: Phase 2 未完成前不得实现菜品、菜单或订单 route。

- [ ] T005 先覆盖 selection/operator token 的签发、kind 隔离、签名、过期、畸形输入和 claims schema 失败分支：`packages/kith-inn-v1-shared/src/auth.test.ts`
- [ ] T006 实现无第三方 JWT 依赖的 Web Crypto helper、5 分钟 selection/7 天 operator claims schema 和稳定导出：`packages/kith-inn-v1-shared/src/auth.ts`、`packages/kith-inn-v1-shared/src/index.ts`、`packages/kith-inn-v1-shared/package.json`
- [ ] T007 [P] 先覆盖 v1 service token fail-closed、membership lookup、operator/seller active 重查、JWT kind/expiry、body seller 拒绝和跨 seller 404：`apps/cms/tests/kiv1-auth.test.ts`
- [ ] T008 实现独立 `x-kith-inn-v1-*` 身份 helper 与 `/api/internal/kiv1/auth/operator-memberships` bootstrap，不修改旧 internal helper/route：`apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/auth/operator-memberships/route.ts`
- [ ] T009 [P] 先覆盖 code2Session、显式 dev login 双开关、零/单/多 membership、多 seller 选择 token、防伪 seller、membership 停用/seller 暂停和 bearer middleware：`apps/kith-inn-v1-be/src/lib/wx/code2session.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/auth.test.ts`、`apps/kith-inn-v1-be/src/routes/auth.test.ts`、`apps/kith-inn-v1-be/src/middleware/operatorAuth.test.ts`
- [ ] T010 实现微信交换、CMS bootstrap client、wx/dev/select-seller routes 和 operator bearer middleware，weapp 失败不得 fallback dev login：`apps/kith-inn-v1-be/src/lib/wx/code2session.ts`、`apps/kith-inn-v1-be/src/lib/cms/auth.ts`、`apps/kith-inn-v1-be/src/routes/auth.ts`、`apps/kith-inn-v1-be/src/middleware/operatorAuth.ts`、`apps/kith-inn-v1-be/src/app.ts`
- [ ] T011 [P] 先覆盖 H5/weapp 登录分流、token storage、401/403 清会话、多 seller 必须选择和绝不存 openid：`apps/kith-inn-v1-fe/src/store/session.test.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts`、`apps/kith-inn-v1-fe/src/logic/login.test.ts`
- [ ] T012 实现 v1 session store、API client、登录/选择 seller 页面和 merchant route guard：`apps/kith-inn-v1-fe/src/store/session.ts`、`apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/login.ts`、`apps/kith-inn-v1-fe/src/pages/merchant/login/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts`

**Checkpoint**: seeded 桃子能通过显式 H5 dev login 或真实 weapp login 获得单 seller token；多 seller 必选；停用 membership 后 CMS 立即拒绝。

---

## Phase 3：User Story 1——登录并维护菜品池（P1，M1-A）🎯

**Goal**: 桃子可在实际 v1 商家入口完成单条菜品维护和 50 行文本预览/提交。

**Independent Test**: 从 H5 dev login 进入菜品页，完成 list/create/edit/deactivate/restore 及 valid/invalid/conflict import；另一个 seller token 看不到桃子数据。

### Tests for User Story 1 ⚠️

- [ ] T013 [P] [US1] 先覆盖 merchant offering、import preview/commit、逐行结果和额外 seller 字段拒绝的共享 API schema/type：`packages/kith-inn-v1-shared/src/api.test.ts`
- [ ] T014 [P] [US1] 先覆盖空行、常见分隔符、荤/素/汤映射、字段过长、未知分类、50 行上限、重名默认 skip 与显式 overwrite：`apps/kith-inn-v1-be/src/domain/offerings/importText.test.ts`
- [ ] T015 [P] [US1] 先覆盖 CMS offering list/create/patch、active 筛选、同 seller unique、跨 seller 404、停用 membership 和 body seller 422，并更新旧 route 清单回归只新增 `kiv1` namespace：`apps/cms/tests/kiv1-offerings.test.ts`、`apps/cms/tests/spike-coexistence.test.ts`
- [ ] T016 [P] [US1] 先覆盖 BE CMS offering client、merchant route schema、逐行 partial result、401/403/404/409/422 映射和 commit 重新解析/重查：`apps/kith-inn-v1-be/src/lib/cms/offerings.test.ts`、`apps/kith-inn-v1-be/src/routes/offerings.test.ts`
- [ ] T017 [P] [US1] 先覆盖 FE 菜品 active 分组、preview 汇总、conflict action、提交结果和 API 请求：`apps/kith-inn-v1-fe/src/logic/offeringsImport.test.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts`
- [ ] T018 [US1] 先编写失败的 H5 “dev login → 新增/编辑/停用/恢复 → import preview/commit”纵向测试和未授权重定向：`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts`、`apps/kith-inn-v1-fe/playwright.config.ts`

### Implementation for User Story 1

- [ ] T019 [US1] 实现 offering/import/auth response schemas、共享实体类型和稳定子路径导出：`packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts`、`packages/kith-inn-v1-shared/src/index.ts`、`packages/kith-inn-v1-shared/package.json`
- [ ] T020 [US1] 实现 seller-scoped CMS offering routes，仅允许 name/mainIngredient/category/active 白名单且不提供 DELETE：`apps/cms/src/app/api/internal/kiv1/offerings/route.ts`、`apps/cms/src/app/api/internal/kiv1/offerings/[id]/route.ts`
- [ ] T021 [US1] 实现纯文本解析/preview/commit、CMS client 和受 operator middleware 保护的 merchant offering routes：`apps/kith-inn-v1-be/src/domain/offerings/importText.ts`、`apps/kith-inn-v1-be/src/lib/cms/offerings.ts`、`apps/kith-inn-v1-be/src/routes/offerings.ts`、`apps/kith-inn-v1-be/src/app.ts`
- [ ] T022 [US1] 实现原生 Taro 菜品页、单条表单、停用/恢复和 import preview/conflict/结果 UI：`apps/kith-inn-v1-fe/src/logic/offeringsImport.ts`、`apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx`、`apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/app.config.ts`、`apps/kith-inn-v1-fe/src/app.css`
- [ ] T023 [US1] 打通 Playwright 的 CMS seed、3304/3311/10087 三服务启动和数据唯一命名/清理，使 M1-A H5 测试真实经过 BE/CMS：`apps/kith-inn-v1-fe/playwright.config.ts`、`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts`

### M1-A PR Gate

- [ ] T024 [US1] 运行 shared/BE/FE 100% coverage、CMS SQLite + PostgreSQL 双 seller tenant 回归、M1-A H5 e2e 和 weapp build，按 `specs/009-kith-inn-v1-merchant-core/quickstart.md` 验证 30 秒登录和 50 行 preview 2 秒预算
- [ ] T025 [US1] 运行 `pnpm verify`，确认 M1-A 未创建 menu/orders/customer/booking/AI 页面或 route、未修改旧 `@cfp/kith-inn-*` 业务源码，并在 `specs/009-kith-inn-v1-merchant-core/tasks.md` 记录 T001–T025 完成状态
- [ ] T026 [US1] 提交 M1-A ready PR，等待 checks 与 Codex review；逐条修复或解释并 resolve 所有 actionable threads 后停止，M1-B 任务保持未勾选：`specs/009-kith-inn-v1-merchant-core/tasks.md`

**Checkpoint**: M1-A 可独立交付；两个新 workspace 都承载登录/菜品实际功能，没有 M1-B/C 空文件。

---

## Phase 4：User Story 2——生成并调整菜单（P2，M1-B）

**Goal**: 桃子可从菜品池生成单餐/一周菜单并换一道菜，历史 snapshot 不随菜品变更。

**Independent Test**: 用足量/不足菜品分别生成；验证硬约束、软偏好评分、已有餐次确认覆盖和无候选换菜不写入。

### Tests for User Story 2 ⚠️

- [ ] T027 [US2] M1-A rebase merge 后从最新 `main` 创建 M1-B 分支，并在 `specs/009-kith-inn-v1-merchant-core/tasks.md` 记录起点提交
- [ ] T028 [P] [US2] 先覆盖 meal-slot list/generate/swap 请求响应、31 日范围、20 target 上限、conflict/insufficient/relaxed error schema：`packages/kith-inn-v1-shared/src/api.test.ts`
- [ ] T029 [P] [US2] 先覆盖 2 meat/2 veg/1 soup、active-only、单餐不重复、分类不足无结果、snapshot、同周/同日/7 日字典序评分、同分随机源和 swap 无候选：`apps/kith-inn-v1-be/src/domain/menu/generate.test.ts`
- [ ] T030 [P] [US2] 先覆盖 CMS meal-slot 日期范围、create unique、seller stamp、PATCH menu 白名单、嵌套 offering owner 和跨 seller 404：`apps/cms/tests/kiv1-meal-slots.test.ts`
- [ ] T031 [P] [US2] 先覆盖 BE meal-slot CMS client、已有 target 409/确认 replace、分类不足零写入、批量重试和 swap 原子性：`apps/kith-inn-v1-be/src/lib/cms/mealSlots.test.ts`、`apps/kith-inn-v1-be/src/routes/mealSlots.test.ts`
- [ ] T032 [P] [US2] 先覆盖 FE target 生成、已有菜单确认、relaxed 说明、单项 swap 视图和 API 请求：`apps/kith-inn-v1-fe/src/logic/menu.test.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts`
- [ ] T033 [US2] 先扩展失败的 H5 单餐/工作周生成、覆盖确认和换菜关键流：`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts`

### Implementation for User Story 2

- [ ] T034 [US2] 实现 meal-slot/generate/swap API schemas 与共享类型：`packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts`
- [ ] T035 [US2] 实现 CMS meal-slot list/create/patch，逐项校验 menu offering owner：`apps/cms/src/app/api/internal/kiv1/meal-slots/route.ts`、`apps/cms/src/app/api/internal/kiv1/meal-slots/[id]/route.ts`
- [ ] T036 [US2] 实现纯菜单生成/评分/swap、CMS client 和 merchant meal-slot routes：`apps/kith-inn-v1-be/src/domain/menu/generate.ts`、`apps/kith-inn-v1-be/src/lib/cms/mealSlots.ts`、`apps/kith-inn-v1-be/src/routes/mealSlots.ts`、`apps/kith-inn-v1-be/src/app.ts`
- [ ] T037 [US2] 实现原生 Taro 菜单页、日期/午晚 target、覆盖确认、relaxed 提示和 swap UI：`apps/kith-inn-v1-fe/src/logic/menu.ts`、`apps/kith-inn-v1-fe/src/pages/merchant/menu/index.tsx`、`apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/app.config.ts`、`apps/kith-inn-v1-fe/src/app.css`
- [ ] T038 [P] [US2] 核对“近期=目标日前 7 个日历日”和软偏好优先级；仅在实现决策漂移时同步长期文档：`docs/kith-inn-v1/USER-STORIES.md`、`docs/kith-inn-v1/TECH-SPEC.md`

### M1-B PR Gate

- [ ] T039 [US2] 运行 M1-A 回归、shared/BE/FE coverage、CMS PostgreSQL 嵌套 tenant 回归、菜单 H5 e2e 和 weapp build，按 `specs/009-kith-inn-v1-merchant-core/quickstart.md` 验证单餐 3 秒预算和足量池 10 餐次无同周重复菜/同日重复主料
- [ ] T040 [US2] 运行 `pnpm verify`，确认 M1-B 未预建 orders/customer/booking/AI 页面或 route、未修改旧业务源码，并记录 T027–T040 完成状态：`specs/009-kith-inn-v1-merchant-core/tasks.md`
- [ ] T041 [US2] 提交 M1-B ready PR，等待 checks/Codex review 并闭环 actionable threads 后停止，M1-C 保持未勾选：`specs/009-kith-inn-v1-merchant-core/tasks.md`

**Checkpoint**: M1-B 可独立交付；菜单硬约束不可放宽，有限菜品池下软偏好冲突可解释。

---

## Phase 5：User Story 3——手动记录并完成订单（P3，M1-C）

**Goal**: 桃子不依赖顾客侧即可补单、确认、收款、送达、取消和复制清单。

**Independent Test**: 新建无 openid profile/manual order，验证 duplicate/resubmit、三状态轴、汇总、批量送达、跨 seller 和 confirmed 影响确认。

### Tests for User Story 3 ⚠️

- [ ] T042 [US3] M1-B rebase merge 后从最新 `main` 创建 M1-C 分支，并在 `specs/009-kith-inn-v1-merchant-core/tasks.md` 记录起点提交
- [ ] T043 [P] [US3] 先覆盖 merchant profile/order/list/summary/action/bulk 请求响应、稳定错误和 seller 字段拒绝 schema：`packages/kith-inn-v1-shared/src/api.test.ts`
- [ ] T044 [P] [US3] 先覆盖 draft→confirmed/canceled、canceled→resubmit、confirmed-only payment/delivery、时间清理、重复幂等、confirmed 编辑确认、汇总和纯文本清单：`apps/kith-inn-v1-be/src/domain/orders/service.test.ts`、`apps/kith-inn-v1-be/src/domain/orders/summary.test.ts`
- [ ] T045 [P] [US3] 先覆盖 CMS seller snapshot、profile list/create openid 强制为空，以及 order list/create/patch 字段白名单、slot/profile owner、unique、跨 seller 404 和停用 membership：`apps/cms/tests/kiv1-orders.test.ts`
- [ ] T046 [P] [US3] 先覆盖 BE seller/profile/order CMS clients、manual price fallback/snapshot、duplicate 409、action 状态映射、bulk partial result 和无跨 seller 泄露：`apps/kith-inn-v1-be/src/lib/cms/seller.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.test.ts`、`apps/kith-inn-v1-be/src/routes/orders.test.ts`
- [ ] T047 [P] [US3] 先覆盖 FE 订单分组/汇总、编辑/取消/resubmit 确认、付款送达按钮、批量选中和地址排序清单：`apps/kith-inn-v1-fe/src/logic/orders.test.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts`
- [ ] T048 [US3] 先扩展失败的 H5 “新 profile → 补单 → 修改 → 确认 → 付款 → 送达 → 取消 → resubmit”关键流和跨 seller negative flow：`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts`

### Implementation for User Story 3

- [ ] T049 [US3] 实现 profile/order/action/bulk API schemas 与共享类型：`packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts`
- [ ] T050 [US3] 实现 seller-scoped CMS seller/profile/order routes、relationship owner 与写字段白名单，不下沉状态机：`apps/cms/src/app/api/internal/kiv1/seller/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer-profiles/route.ts`、`apps/cms/src/app/api/internal/kiv1/orders/route.ts`、`apps/cms/src/app/api/internal/kiv1/orders/[id]/route.ts`
- [ ] T051 [US3] 实现订单纯状态机/汇总/清单、CMS clients 和 merchant order/action/bulk routes：`apps/kith-inn-v1-be/src/domain/orders/service.ts`、`apps/kith-inn-v1-be/src/domain/orders/summary.ts`、`apps/kith-inn-v1-be/src/lib/cms/seller.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts`、`apps/kith-inn-v1-be/src/routes/orders.ts`、`apps/kith-inn-v1-be/src/app.ts`
- [ ] T052 [US3] 实现原生 Taro 订单页、profile 选择/创建、重复更新/resubmit、状态操作、批量送达和剪贴板清单：`apps/kith-inn-v1-fe/src/logic/orders.ts`、`apps/kith-inn-v1-fe/src/pages/merchant/orders/index.tsx`、`apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/app.config.ts`、`apps/kith-inn-v1-fe/src/app.css`
- [ ] T053 [P] [US3] 核对取消后重提、confirmed-only 付款/送达、手动 profile 无 openid 和清单范围，并仅在实现决策漂移时同步：`docs/kith-inn-v1/USER-STORIES.md`、`docs/kith-inn-v1/TECH-SPEC.md`、`docs/kith-inn-v1/DATA-MODEL.md`

### M1-C / M1 Complete Gate

- [ ] T054 [US3] 运行全部 shared/BE/FE coverage、CMS SQLite/PostgreSQL tenant/relationship 回归、完整商家 H5 e2e 和 weapp build，按 `specs/009-kith-inn-v1-merchant-core/quickstart.md` 验证 2 分钟手动订单生命周期
- [ ] T055 [US3] 按 `specs/009-kith-inn-v1-merchant-core/quickstart.md` 连续从空本地数据跑通“seed → 登录 → 菜品 → 一周菜单 → 手动补单 → 确认 → 付款/送达”，确认 booking batch/customer session/AI/支付数据与入口均未创建
- [ ] T056 [US3] 运行 `pnpm verify`，检查 M1 全 diff 不修改旧 `@cfp/kith-inn-*` 业务源码、不新增 collection/Payload app/数据库，并将 T042–T056 与完整 M1 状态记录在 `specs/009-kith-inn-v1-merchant-core/tasks.md`
- [ ] T057 [US3] 提交 M1-C ready PR，等待 checks 与 Codex review；逐条修复或解释并 resolve 所有 actionable threads：`specs/009-kith-inn-v1-merchant-core/tasks.md`

**Checkpoint**: M1 完成；桃子可在没有顾客侧的情况下跑通菜单和商家订单经营闭环。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（M1-A Setup）**: 规格 PR 合并后开始；不能单独提交。
- **Phase 2（认证/tenant foundation）**: 依赖 Phase 1，阻塞三个用户故事。
- **Phase 3（US1 / M1-A）**: 依赖 Phase 2；完成并合并后才开始 M1-B。
- **Phase 4（US2 / M1-B）**: 依赖 M1-A，因为使用登录、菜品与 workspace；完成并合并后才开始 M1-C。
- **Phase 5（US3 / M1-C）**: 依赖 M1-B，因为手动订单选择 meal slot；完成即完成 M1。

### User Story Dependencies

- **US1（P1）**: 首个独立 MVP；交付登录和菜品池。
- **US2（P2）**: 使用 US1 菜品和认证，但可用 seed/fixture 独立验证菜单规则。
- **US3（P3）**: 使用 US2 餐次和 US1 认证，但可用 fixture 独立验证订单状态机。

### Within Each User Story

- 所有 tests task 先完成并确认失败，再开始 implementation task。
- shared contract → CMS persistence → BE domain/route → FE 页面 → H5 e2e。
- seller/relationship owner 检查先于任何 `overrideAccess` 写入。
- 每个 PR 通过窄验证和 `pnpm verify`，Codex review 闭环后才合并。

### Parallel Opportunities

- M1-A workspace 的 BE/FE 配置可并行；auth 的 CMS/BE/FE 失败测试可在 shared claims 确定后并行。
- 每个用户故事的 shared、CMS、BE domain、FE logic 失败测试修改不同文件，可并行准备。
- M1-A/B/C 不并行实施，避免堆叠 PR 和未合并契约漂移。

---

## Parallel Example：M1-A / US1

```text
Task T013: shared offering/import contract tests
Task T014: BE import parser tests
Task T015: CMS seller-scoped offering route tests
Task T016: BE CMS client/merchant route tests
Task T017: FE import/view logic tests
```

## Parallel Example：M1-B / US2

```text
Task T028: shared meal-slot API tests
Task T029: pure menu generator tests
Task T030: CMS meal-slot owner tests
Task T031: BE client/route tests
Task T032: FE menu logic tests
```

## Parallel Example：M1-C / US3

```text
Task T043: shared profile/order API tests
Task T044: pure order state/summary tests
Task T045: CMS profile/order owner tests
Task T046: BE client/route tests
Task T047: FE order/list logic tests
```

---

## Implementation Strategy

### MVP First：M1-A / User Story 1

1. 创建承载实际登录/菜品功能的两个 workspace。
2. 完成 v1 独立 auth/tenant foundation。
3. 完成菜品单条 CRUD 和文本 preview/commit。
4. 通过 M1-A gate 后提交 ready PR 并停止；不预建后续目录。

### Incremental Delivery

1. **M1-A**: 登录 + 菜品池 → 可独立试用。
2. **M1-B**: 单餐/一周菜单 + 换菜 → 可独立试用。
3. **M1-C**: 手动订单 + 生命周期 → M1 经营闭环。

### Deliberate Deferrals

- M2 才创建 booking batch、分享、customer session/profile/order 页面。
- M3 才做审核兜底接龙导入；AI 继续不进入主链路。
- M4 才建立 shared CMS migration baseline 和发布收口；此前不写真实需保留订单。
- 不抽通用 auth/domain/UI package；出现第三个真实消费者后再评估。
