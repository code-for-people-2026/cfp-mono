---

description: "街坊味 v1 M2 顾客预订登记的依赖有序实施任务"
---

# Tasks：街坊味 v1 顾客预订登记

**Input**: `specs/010-kith-inn-v1-customer-booking/` 下的 spec、plan、research、data-model、contracts 和 quickstart

**Tests**: 本功能要求 contract、领域、route、FE logic、H5 E2E 与 weapp smoke；每个实现 PR 先写能失败的窄测试，再实现，再运行 `pnpm verify`。

**Organization**: M2-A/B、恢复计划与 C1～C5 已合并；剩余任务严格按 plan.md 的坐标纠偏计划→C5R→C6→D1→D2→D3→D4 顺序切分。每片从前一片 rebase merge 后的最新 `main` 开始，完成 ready review、latest-head CI 与 Codex thread 闭环后才进入下一片。

## 格式

- `[P]`：可与同阶段其他 `[P]` 任务并行，且不会修改同一文件。
- `[US1]`～`[US4]`：对应 spec.md 用户故事。
- 每条任务给出预期修改或验证的准确路径。

## Phase 1：M2-A 商家餐次配置与批次 path（US1）

**Goal**: 桃子可以配置餐次预订状态、创建/关闭 booking batch，并获得固定分享 path。

**Independent Test**: 以 operator 登录，开放两个有效餐次，创建 batch 并预览/复制 path，再分别关闭 batch 和 slot；验证 batch close 不修改 slot、slot close 会让所有入口中的该餐次不可写，且 M2-A 不发出指向未注册页面的真实卡片。

### Tests first

- [x] T001 [P] [US1] 在 `packages/kith-inn-v1-shared/src/api.test.ts` 为含 `orderDeadline` 的 MealSlot、booking config、batch create/update/list/share schema 添加 contract 测试并确认先失败
- [x] T002 [P] [US1] 在 `apps/cms/tests/kiv1-booking-batches.test.ts` 添加 operator owner、relationship guard、service token、创建/关闭 batch 的 route 测试并确认先失败
- [x] T003 [P] [US1] 在 `apps/cms/tests/kiv1-meal-slots.test.ts` 添加 booking config 白名单、owner 与 service token 测试并确认先失败
- [x] T004 [P] [US1] 在 `apps/kith-inn-v1-be/src/routes/bookingBatches.test.ts` 和 `apps/kith-inn-v1-be/src/routes/mealSlots.test.ts` 添加 UUID、1–20 去重、默认标题、open 前置条件、关闭幂等与错误映射测试并确认先失败
- [x] T005 [P] [US1] 在 `apps/kith-inn-v1-fe/src/logic/bookingBatches.test.ts` 添加可选餐次、分享 path、关闭提示的纯逻辑测试并确认先失败
- [x] T006 [P] [US1] 在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 添加配置餐次、创建/关闭批次和 H5 复制 path 的无头场景并确认先失败

### Implementation

- [x] T007 [US1] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 merchant booking config/batch contract，并为 MealSlot 补 `orderDeadline`
- [x] T008 [US1] 在 `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/meal-slots/[id]/booking-config/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/booking-batches/route.ts` 实现 service-auth 的配置、batch list/create 与同 seller guard
- [x] T009 [US1] 在 `apps/cms/src/app/api/internal/kiv1/booking-batches/[id]/route.ts` 实现 owner-scoped 幂等关闭，且不联动修改 meal slot
- [x] T010 [US1] 在 `apps/kith-inn-v1-be/src/lib/cms/mealSlots.ts`、`apps/kith-inn-v1-be/src/lib/cms/bookingBatches.ts` 和 `apps/kith-inn-v1-be/src/domain/bookings/availability.ts` 实现 CMS client、open 前置条件、价格解析、UUID/default title/share path 纯逻辑
- [x] T011 [US1] 在 `apps/kith-inn-v1-be/src/routes/mealSlots.ts`、`apps/kith-inn-v1-be/src/routes/bookingBatches.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 装配 merchant endpoints 与稳定错误码
- [x] T012 [US1] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/bookingBatches.ts`、`apps/kith-inn-v1-fe/src/pages/merchant/batches/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts` 和 `apps/kith-inn-v1-fe/src/app.css` 实现商家批次页与 weapp/H5 path 预览复制，M2-A 不注册顾客页或启用原生分享

### Gate / PR

- [x] T013 [US1] 运行 shared/CMS/BE/FE 窄测试、`pnpm --filter @cfp/kith-inn-v1-fe build:weapp`、`CI=1` H5 E2E 与 `pnpm verify`；验证 M2-A 无原生分享入口，并把 60 秒和零内部标识指标记录在 `specs/010-kith-inn-v1-customer-booking/tasks.md`
- [x] T014 [US1] 审计 M2-A diff：不含 customer auth/profile/order write，不改 `packages/kith-inn-v1-payload` collection/索引、不改旧 `@cfp/kith-inn-*` 业务 package、不新增 workspace/依赖
- [x] T015 [US1] 提交并推送 `codex/kith-inn-v1-m2-a`，创建 base=`main` 的 ready PR；等待一次自动 Codex review，逐条回复/修复并 resolve actionable thread 后 rebase merge，状态记录于 `specs/010-kith-inn-v1-customer-booking/tasks.md`

**Checkpoint**: M2-A 独立可用；合并后才能开始 M2-B。

---

## Phase 2：M2-B 顾客静默会话与只读分享页（US2）

**Goal**: 顾客从有效分享 path 静默建立 seller-bound session，并只读查看限定 batch；operator/customer 信任域完全隔离。

**Independent Test**: 从有效、closed 和跨 seller 三种 publicId 进入，验证有效入口静默显示内容、closed 入口只读、跨 seller/不存在入口不签发 token；无 profile/order 写入。

### Tests first

- [x] T016 [P] [US2] 在 `packages/kith-inn-v1-shared/src/auth.test.ts` 和 `packages/kith-inn-v1-shared/src/api.test.ts` 添加 customer claims、session、login、public batch view contract 测试并确认先失败
- [x] T017 [P] [US2] 在 `apps/cms/tests/kiv1-customer-auth.test.ts` 添加 service bootstrap、customer JWT kind/expiry/seller owner、closed batch read 与跨 seller 404 测试并确认先失败
- [x] T018 [P] [US2] 在 `apps/kith-inn-v1-be/src/middleware/customerAuth.test.ts` 和 `apps/kith-inn-v1-be/src/routes/auth.test.ts` 添加 customer token 隔离、微信 code 只使用一次、dev 双开关和敏感信息不落日志测试并确认先失败
- [x] T019 [P] [US2] 在 `apps/kith-inn-v1-be/src/routes/bookingBatches.test.ts` 添加 public view、resolved price、canBook reason、closed/archived 可读与跨 seller 404 测试并确认先失败
- [x] T020 [P] [US2] 在 `apps/kith-inn-v1-fe/src/store/customerSession.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.test.ts` 添加独立 storage、query 恢复、silent login 与只读派生测试并确认先失败
- [x] T021 [P] [US2] 在 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 添加 H5 dev customer login、batch 展示、closed 状态与 query 恢复的无头 E2E 并确认先失败

### Implementation

- [x] T022 [US2] 在 `packages/kith-inn-v1-shared/src/auth.ts`、`packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 customer claims/login/session/public view schema，确保编译产物兼容 Taro loader
- [x] T023 [US2] 在 `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/auth/customer-session/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/booking-batches/[publicId]/route.ts` 实现 service bootstrap 与只读 customer scope
- [x] T024 [US2] 在 `apps/kith-inn-v1-be/src/middleware/customerAuth.ts`、`apps/kith-inn-v1-be/src/lib/cms/auth.ts`、`apps/kith-inn-v1-be/src/lib/cms/bookingBatches.ts` 和 `apps/kith-inn-v1-be/src/routes/auth.ts` 实现微信/dev customer session 与 operator/customer token 隔离
- [x] T025 [US2] 在 `apps/kith-inn-v1-be/src/routes/bookingBatches.ts`、`apps/kith-inn-v1-be/src/domain/bookings/availability.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 实现 customer-authenticated public batch read 与只读原因派生
- [x] T026 [US2] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/store/customerSession.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.ts`、`apps/kith-inn-v1-fe/src/pages/booking/index.tsx`、`apps/kith-inn-v1-fe/src/pages/merchant/batches/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts` 和 `apps/kith-inn-v1-fe/src/app.css` 实现静默登录、只读目标页并在目标存在后启用 weapp 原生分享
- [x] T027 [US2] 在 `apps/kith-inn-v1-be/.env.example` 和 `apps/kith-inn-v1-fe/.env.example` 记录微信配置、customer dev login 双开关与生产禁用语义

### Gate / PR

- [ ] T028 [US2] 运行 shared/CMS/BE/FE 窄测试、`pnpm --filter @cfp/kith-inn-v1-fe build:weapp`、`CI=1` H5 E2E 与 `pnpm verify`；完成原生分享卡片→目标页→`wx.login`/query 真机 smoke，并把 M2-B 正常网络 5 秒指标记录在 `specs/010-kith-inn-v1-customer-booking/tasks.md`

> 自动门禁、SQLite/PostgreSQL、无头 H5、weapp build 与 5 秒指标已完成；原生分享卡片和真实 `wx.login` 的真机 smoke 待维护者使用已配置微信小程序的设备执行。
- [x] T029 [US2] 审计 M2-B diff：无 profile/order 写 API、无 operator session 回归、无新持久化字段/secret 日志/Node-only weapp 依赖，并把结果记录在 `specs/010-kith-inn-v1-customer-booking/tasks.md`
- [x] T030 [US2] 从 M2-A 合并后的 main 提交并推送 `codex/kith-inn-v1-m2-b`，创建 ready PR；等待一次自动 Codex review，处理完 actionable thread 后 rebase merge，并在 `specs/010-kith-inn-v1-customer-booking/tasks.md` 记录 PR #153 已于 2026-07-11 合并

**Checkpoint**: M2-B 代码已通过 review/CI 并合并；T028 原生分享与真实 `wx.login`/query 真机门禁仍未完成，不据此宣称可发布。

---

## PR 切片状态

| PR | 单一目标 | 任务 | 独立验证 | 依赖 / 人工 diff |
|---|---|---|---|---|
| C1 | strict shared contract 与重复项归一化 | T031–T034 | shared 100% coverage | 已合并 PR #214 |
| C2 | profile seller+openid owner 边界 | T035–T038 | CMS SQLite/PostgreSQL | 已合并 PR #217 |
| C3 | order owner/relationship/unique 坐标 | T039–T042 | CMS SQLite/PostgreSQL | 已合并 PR #218 |
| C4 | BE domain、CMS clients 与部分成功编排 | T043–T046 | BE 100% coverage | 已合并 PR #219 |
| C5 | profile/reservation HTTP 与错误映射 | T047–T050 | BE route 100% coverage | 已合并 PR #220 |
| C5R | 公开餐次坐标 contract/domain/HTTP 原子纠偏 | T051–T054 | shared/BE 100% coverage | 坐标纠偏计划 PR；`<400` |
| C6 | 资料选择、摘要、多餐次提交 UI | T055–T058 | FE coverage、无头 H5、weapp | C5R；`<400` |
| D1 | own-order/edit/cancel/deactivate contract | T059–T062 | shared 100% coverage | C6；`<400` |
| D2 | owner-scoped persistence 与历史可见 | T063–T066 | CMS SQLite/PostgreSQL | D1；`<400` |
| D3 | BE 修改/取消、截止重查和 confirmed 锁单 | T067–T070 | BE domain/route coverage | D2；`<400` |
| D4 | 顾客页面、H5/weapp 与 M2 总验收 | T071–T074 | FE coverage、无头 H5、weapp | D3；`<400` |

每片开 PR 前按 `origin/main` 统计人工编写 diff。超过 400 行先继续拆；确实不可拆时必须在 PR 说明写明原因、风险和验证。超过 800 行不得开 PR。

---

## Phase 3：M2-C1 strict shared contract（US3）

**Goal**: 顾客资料/登记 contract 只接受顾客可控字段，并确定性归一化 1–20 个餐次。

**Independent Test**: 完全重复项只保留首次位置；同 slot 的 quantity 或规范化 `resubmitCanceled` 冲突时整请求 422；seller/openid/source/status 注入均拒绝。

- [x] T031 [US3] 先在 `packages/kith-inn-v1-shared/src/api.test.ts` 覆盖 strict profile/reservation、1–20 项、完全重复归一化、冲突重复 422、禁止 seller/openid/source/status 注入及 created/updated/resubmitted/failed 结果，并确认测试失败
- [x] T032 [US3] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 C1 strict contract 与稳定归一化函数，不增加 CMS/BE/FE 代码
- [x] T033 [US3] 运行 shared 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 C1 只改 `packages/kith-inn-v1-shared/**` 且 `<400` 行
- [x] T034 [US3] 提交 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/api.test.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts`，推送并创建 M2-C1 ready PR；处理 latest-head CI/Codex review、回复并 resolve 重要 thread 后使用 rebase merge（PR #214 已合并）

---

## Phase 4：M2-C2 customer profile persistence（US3）

**Goal**: profile list/create/touch 始终以 customer JWT 的 seller+openid 为 owner，响应隐藏 openid。

**Independent Test**: SQLite/PostgreSQL 都拒绝跨 owner、body 注入和缺 service token 写入；active owner 成功且响应白名单不含 openid。

- [x] T035 [US3] 先在 `apps/cms/tests/kiv1-customer-profiles.test.ts` 覆盖 JWT+service、seller+openid list/create/touch、active owner、跨 owner 404、body 注入和响应隐藏 openid，并确认测试失败
- [x] T036 [US3] 在 `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/customer/profiles/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/touch/route.ts` 实现 C2 owner/service/response 边界
- [x] T037 [US3] 运行 CMS SQLite/PostgreSQL 窄测试、`pnpm verify`、路径审计与人工 diff 统计，确认 C2 只含 `apps/cms/src/app/api/internal/kiv1/customer/profiles/**`、`apps/cms/src/lib/kiv1-internal.ts` 和 `apps/cms/tests/kiv1-customer-profiles.test.ts` 且 `<400` 行
- [x] T038 [US3] 提交 `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/customer/profiles/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/touch/route.ts` 和 `apps/cms/tests/kiv1-customer-profiles.test.ts`，推送并创建 M2-C2 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #217 已合并）

---

## Phase 5：M2-C3 customer order persistence（US3）

**Goal**: order 查重/create/update 始终以 seller+openid+slot+profile 为坐标，并拒绝跨关系。

**Independent Test**: SQLite/PostgreSQL 覆盖 relationship owner、customer-card 白名单、unique 冲突可重读、跨 owner 404 与原子拒绝。

- [x] T039 [US3] 先在 `apps/cms/tests/kiv1-customer-orders.test.ts` 覆盖 by-slot 查重、create/update、slot/profile/openid relationship、unique、service guard、customer-card 白名单与跨 owner 404，并确认测试失败
- [x] T040 [US3] 在 `apps/cms/src/app/api/internal/kiv1/customer/orders/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/by-slot/[mealSlotId]/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts` 实现 C3 persistence boundary
- [x] T041 [US3] 运行 CMS SQLite/PostgreSQL 窄测试、`pnpm verify`、路径审计与人工 diff 统计，确认 C3 只含 `apps/cms/src/app/api/internal/kiv1/customer/orders/**` 和 `apps/cms/tests/kiv1-customer-orders.test.ts` 且 `<400` 行
- [x] T042 [US3] 提交 `apps/cms/src/app/api/internal/kiv1/customer/orders/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/by-slot/[mealSlotId]/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts` 和 `apps/cms/tests/kiv1-customer-orders.test.ts`，推送并创建 M2-C3 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #218 已合并）

---

## Phase 6：M2-C4 BE domain 与 CMS clients（US3）

**Goal**: BE 对每项写前重查，并以幂等、确定性顺序返回部分成功结果。

**Independent Test**: 纯领域/client 测试覆盖 create/update/resubmit/confirmed lock、价格快照、unique 后重读、profile 不回滚和逐项顺序。

- [x] T043 [US3] 先在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.test.ts` 和 `apps/kith-inn-v1-be/src/lib/cms/orders.test.ts` 覆盖 C4 编排与 client 错误，并确认测试失败
- [x] T044 [US3] 在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts` 和 `apps/kith-inn-v1-be/src/lib/cms/orders.ts` 实现 profile/slot/order 重查、create/update/resubmit/lock、价格快照与 partial result，不增加 HTTP route
- [x] T045 [US3] 运行 BE 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 C4 只含 `apps/kith-inn-v1-be/src/domain/customerOrders/**` 与 `apps/kith-inn-v1-be/src/lib/cms/{customerProfiles,orders}*` 且 `<400` 行
- [x] T046 [US3] 提交 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts`、`apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts` 和 `apps/kith-inn-v1-be/src/lib/cms/orders.test.ts`，推送并创建 M2-C4 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #219 已合并）

---

## Phase 7：M2-C5 customer HTTP routes（US3）

**Goal**: profile/reservation HTTP 只接受 customer JWT，并稳定映射整请求与逐项错误。

**Independent Test**: route 测试覆盖鉴权、1–20 项、冲突重复整请求 422、partial result 为 200、CMS 4xx/5xx 映射和无 owner 泄露。

- [x] T047 [US3] 先在 `apps/kith-inn-v1-be/src/routes/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.test.ts` 和 `apps/kith-inn-v1-be/src/app.test.ts` 覆盖 C5 鉴权、schema、结果与错误映射，并确认测试失败
- [x] T048 [US3] 在 `apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 装配 profile list/create 与 reservation submit endpoints，不增加 FE 调用
- [x] T049 [US3] 运行 BE 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 C5 只含 `apps/kith-inn-v1-be/src/routes/customerProfiles*`、`apps/kith-inn-v1-be/src/routes/customerOrders*` 与 `apps/kith-inn-v1-be/src/app*` 且 `<400` 行
- [x] T050 [US3] 提交 `apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts`、`apps/kith-inn-v1-be/src/app.ts` 及对应测试，推送并创建 M2-C5 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #220 已合并）

**Checkpoint**: C1～C5 已分别由 PR #214、#217、#218、#219、#220 rebase merge；C6 前必须先消除公开读模型与 reservation 写 contract 的坐标断裂。

---

## Phase 8：M2-C5R 公开餐次坐标原子纠偏（US3）

**Goal**: reservation 输入与逐项结果只使用页面已公开的 `{date, occasion}`，BE 在指定 batch 内解析内部餐次且不扩大公开数据。

**Independent Test**: shared/BE 测试覆盖拒绝 `mealSlotId` 注入、按公开 target 归一化与冲突 422、batch 内唯一解析、CMS 仅接收服务端 ID、成功/失败结果按 target 关联和未知错误净化。

- [ ] T051 [US3] 先在 `packages/kith-inn-v1-shared/src/api.test.ts`、`apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts` 和 `apps/kith-inn-v1-be/src/routes/customerOrders.test.ts` 覆盖 C5R strict target、重复归一化、解析、结果与错误净化，并确认测试失败
- [ ] T052 [US3] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts`、`packages/kith-inn-v1-shared/src/index.ts`、`apps/kith-inn-v1-be/src/domain/customerOrders/service.ts` 和 `apps/kith-inn-v1-be/src/routes/customerOrders.ts` 原子切换 live reservation endpoint；不修改 CMS route 或 FE
- [ ] T053 [US3] 运行 shared/BE 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 C5R 只含 T051/T052 的精确路径且 `<400` 行；若超过则停止开 PR 并重新设计兼容切分
- [ ] T054 [US3] 提交 T051/T052 精确路径，推送并创建 M2-C5R ready PR；在 PR 说明记录跨 shared/BE 原子切换是保持 `main` 类型一致且 contract 可执行的最小例外，闭环 latest-head CI/Codex review 后 rebase merge

---

## Phase 9：M2-C6 顾客登记 UI（US3）

**Goal**: booking 页完成资料选择/新建、本次快照、确认摘要、多餐次提交和逐项结果。

**Independent Test**: 无头 H5 跑通新/旧资料、两个餐次、部分失败和商家可见；weapp build 通过，T028 不被 H5 替代。

- [ ] T055 [US3] 先在 `apps/kith-inn-v1-fe/src/services/api.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.test.ts` 和 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 覆盖资料用途短文案、公开 target、资料/摘要/提交、partial result 与 H5 纵向流，并确认测试失败
- [ ] T056 [US3] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.ts`、`apps/kith-inn-v1-fe/src/pages/booking/index.tsx` 和 `apps/kith-inn-v1-fe/src/app.css` 实现用途短文案与 C6 UI，只从公开 batch view 构造 target，不增加“我的预订”页面
- [ ] T057 [US3] 运行 FE 100% coverage、`CI=1` 无头 H5 E2E、weapp build、`pnpm verify`、90 秒/45 秒指标、路径审计与人工 diff 统计；确认 C6 只含 `apps/kith-inn-v1-fe/src/**` 和 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 且 `<400` 行，并在 T028/维护者发布结论完成前不标记可发布或已交付
- [ ] T058 [US3] 提交 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.test.ts`、`apps/kith-inn-v1-fe/src/pages/booking/index.tsx`、`apps/kith-inn-v1-fe/src/app.css` 和 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts`，推送并创建 M2-C6 ready PR；闭环 latest-head CI/Codex review 后 rebase merge

**Checkpoint**: C1–C6 实现首次多餐次登记；T028 未完成时交付状态仍受真机门禁约束。

---

## Phase 10：M2-D1 strict self-service contracts（US4）

**Goal**: own-order/edit/cancel/deactivate contract 不允许顾客覆盖 owner 或三状态轴。

**Independent Test**: strict schema 只接受规定字段，own-order view 保留历史快照，额外 seller/openid/source/status/time 字段全部拒绝。

- [ ] T059 [US4] 先在 `packages/kith-inn-v1-shared/src/api.test.ts` 覆盖 own-order/view、edit、cancel、deactivate strict contract 和状态轴注入拒绝，并确认测试失败
- [ ] T060 [US4] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 D1 contracts
- [ ] T061 [US4] 运行 shared 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 D1 只改 `packages/kith-inn-v1-shared/**` 且 `<400` 行
- [ ] T062 [US4] 提交 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/api.test.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts`，推送并创建 M2-D1 ready PR；闭环 latest-head CI/Codex review 后 rebase merge

---

## Phase 11：M2-D2 owner-scoped persistence（US4）

**Goal**: own-order 与 profile deactivate/update 始终按 owner 过滤，并保持历史可见。

**Independent Test**: SQLite/PostgreSQL 覆盖幂等停用、历史订单读取、跨顾客 404、customer 写 service guard 和快照不变。

- [ ] T063 [US4] 先扩展 `apps/cms/tests/kiv1-customer-profiles.test.ts` 和 `apps/cms/tests/kiv1-customer-orders.test.ts`，覆盖 D2 deactivate、own list、owner update、历史可见与跨顾客 404，并确认测试失败
- [ ] T064 [US4] 在 `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts` 实现 D2 persistence boundary
- [ ] T065 [US4] 运行 CMS SQLite/PostgreSQL 窄测试、`pnpm verify`、路径审计与人工 diff 统计，确认 D2 只含 `apps/cms/src/app/api/internal/kiv1/customer/**` 和 `apps/cms/tests/kiv1-customer-*.test.ts`、人工 diff `<400` 行且历史数据不改写
- [ ] T066 [US4] 提交 `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts`、`apps/cms/tests/kiv1-customer-profiles.test.ts` 和 `apps/cms/tests/kiv1-customer-orders.test.ts`，推送并创建 M2-D2 ready PR；闭环 latest-head CI/Codex review 后 rebase merge

---

## Phase 12：M2-D3 BE 自助管理门禁（US4）

**Goal**: 修改/取消/停用前重查 batch/slot/deadline/owner/status，confirmed 立即锁单。

**Independent Test**: domain/route 覆盖 own list、edit/cancel/deactivate、closed/expired、confirmed/canceled、跨 owner 404 和非法状态零写入。

- [ ] T067 [US4] 先在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.test.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.test.ts` 和 `apps/kith-inn-v1-be/src/app.test.ts` 覆盖 D3 重查与错误映射，并确认测试失败
- [ ] T068 [US4] 在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 实现 D3 own list/edit/cancel/deactivate 与锁单门禁
- [ ] T069 [US4] 运行 BE 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 D3 只含 `apps/kith-inn-v1-be/src/**`、人工 diff `<400` 行且不增加 FE 页面
- [ ] T070 [US4] 提交 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts`、`apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.test.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.test.ts`、`apps/kith-inn-v1-be/src/app.ts` 和 `apps/kith-inn-v1-be/src/app.test.ts`，推送并创建 M2-D3 ready PR；闭环 latest-head CI/Codex review 后 rebase merge

---

## Phase 13：M2-D4 顾客页面与总验收（US4）

**Goal**: 顾客只看到自有订单，并仅在允许窗口修改/取消和停用资料。

**Independent Test**: 无头 H5 跑通查看→修改→取消→商家确认→顾客锁单→资料停用；历史订单和三状态轴保持可见。

- [ ] T071 [US4] 先在 `apps/kith-inn-v1-fe/src/services/api.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerOrders.test.ts`、`apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 和 `apps/kith-inn-v1-fe/tests/e2e/customer-orders.spec.ts` 覆盖 D4 页面逻辑与总纵向流，并确认测试失败
- [ ] T072 [US4] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/customerOrders.ts`、`apps/kith-inn-v1-fe/src/pages/customer/orders/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts` 和 `apps/kith-inn-v1-fe/src/app.css` 实现 D4 页面
- [ ] T073 [US4] 运行 FE 100% coverage、`CI=1` 无头 H5 E2E、weapp build、`pnpm verify`、M2 scope/path 审计与人工 diff 统计；确认 D4 只含 `apps/kith-inn-v1-fe/src/**` 和 `apps/kith-inn-v1-fe/tests/e2e/**` 且 `<400` 行，并在 T028 未完成时不宣称可发布
- [ ] T074 [US4] 提交 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerOrders.ts`、`apps/kith-inn-v1-fe/src/logic/customerOrders.test.ts`、`apps/kith-inn-v1-fe/src/pages/customer/orders/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts`、`apps/kith-inn-v1-fe/src/app.css`、`apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 和 `apps/kith-inn-v1-fe/tests/e2e/customer-orders.spec.ts`，推送并创建 M2-D4 ready PR；闭环 latest-head CI/Codex review 后 rebase merge

**Checkpoint**: M2 实现闭环；发布状态仍由 T028 与维护者结论单独决定。

---

## Dependencies & Execution Order

```text
恢复计划 PR
  └─ C1 ─ C2 ─ C3 ─ C4 ─ C5
                         └─ 坐标纠偏计划 ─ C5R ─ C6 ─ D1 ─ D2 ─ D3 ─ D4
```

- M2-A 的 T001–T015、M2-B 的 T016–T027/T029/T030 和 C1～C5 的 T031–T050 已完成；T028 保持未完成真机门禁。
- 六个剩余产品代码 PR 不并行、不 stacked；每片 rebase merge 后从最新 `main` 开始下一片。
- 每片 tests-first；只实现当前层的不变量，不预建下一片 route/page/scaffold。
- C5R 是 C6 的新增顺序依赖；D1/D2/D3 是 D4 的顺序依赖。

## Parallel Opportunities

- 不并行推进 PR；同一片内若测试涉及多个既有文件，可在同一失败测试阶段准备，但实现仍在测试确认失败后开始。
- C6/D4 的 H5 与 coverage 可在实现完成后并行运行；weapp build 和 `pnpm verify` 仍以同一 head 为准汇总。

## Implementation Strategy

1. 恢复计划与 C1～C5 已合并；先合并只修改本规格目录的公开餐次坐标纠偏计划 PR。
2. C5R 原子切换 live reservation contract/domain/HTTP，保持 CMS 内部 ID 边界不变；随后 C6 接 UI。
3. D1→D3 依次锁定自助管理 contract、persistence 与 BE 门禁，D4 最后接页面和总验收。
4. 每轮修复后等待 latest-head CI，再精确 `@codex review`；latest head 无新 comment、unresolved=0、CI 全绿、mergeState=CLEAN 后才 rebase merge。
5. T028 只能由维护者真机完成；H5 自动化不改变该任务状态。
