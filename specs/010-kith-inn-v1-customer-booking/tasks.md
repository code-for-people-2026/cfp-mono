---

description: "街坊味 v1 M2 顾客预订登记的依赖有序实施任务"
---

# Tasks：街坊味 v1 顾客预订登记

**Input**: `specs/010-kith-inn-v1-customer-booking/` 下的 spec、plan、research、data-model、contracts 和 quickstart

**Tests**: 本功能要求 contract、领域、route、FE logic、H5 E2E 与 weapp smoke；每个实现 PR 先写能失败的窄测试，再实现，再运行 `pnpm verify`。

**Organization**: M2-A/B、C1～C6、D1～D4、D2R 与 M3/M4 十个自动化 PR 切片均已串行完成。新增商家“今日工作台”目标按 M5-P 规划、M5-H1 状态模型、M5-H2 页面、M5-H3 手动加单四片串行推进；每片都从前一片 rebase merge 后的最新 `main` 开始并闭环 ready review、latest-head CI 与 Codex threads。T028/T087/T090/T097 是仍未完成的独立人工发布门禁，T057 仍按历史人工 diff 479 行事实保持未完成。

## 格式

- `[P]`：可与同阶段其他 `[P]` 任务并行，且不会修改同一文件。
- `[US1]`～`[US7]`：对应 spec.md 用户故事。
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
| C5R | 公开餐次坐标 contract/domain/HTTP 原子纠偏 | T051–T054 | shared/BE 100% coverage | 已合并 PR #222 |
| C6 | 资料选择、摘要、多餐次提交 UI | T055–T058 | FE coverage、无头 H5、weapp | 已合并 PR #223；T057 历史预算未达标 |
| D1 | own-order/edit/cancel/deactivate contract | T059–T062 | shared 100% coverage | 已合并 PR #224 |
| D2 | owner-scoped persistence 与历史可见 | T063–T066 | CMS SQLite/PostgreSQL | 已合并 PR #225；D2R 纠偏 PR #226 |
| D3 | BE 修改/取消、截止重查和 confirmed 锁单 | T067–T070 | BE domain/route coverage | 已合并 PR #227 |
| D4 | 顾客页面、H5/weapp 与 M2 总验收 | T071–T074 | FE coverage、无头 H5、weapp | 已合并 PR #230；363 行 |
| M3-A | nullable 导入订单读模型 | T075–T076 | shared/CMS/BE/FE coverage | D4；`<400` |
| M3-B | strict 接龙 parser/contract | T077–T078 | shared 100% coverage | M3-A；`<400` |
| M3-C | owner-scoped CMS 导入写入 | T079–T080 | CMS SQLite/PostgreSQL | M3-B；`<400` |
| M3-D | BE preview/commit 与幂等 | T081–T082 | BE 100% coverage | M3-C；`<400` |
| M3-E | FE preview/confirm API/logic | T083–T084 | FE 100% coverage | M3-D；`<400` |
| M3-F | feature-gated 兜底页面 | T085–T086 | headless H5、weapp | M3-E；`<400` |
| M3-G | 公开文案与隐私提示 | T088–T089 | FE coverage、headless H5、weapp | M3-F 自动化完成；`<400` |
| M4-A | 顾客数据复制与资料批量软停用 | T091–T092 | FE coverage、headless H5 | M3-G；`<400` |
| M4-B | 错误/空态/截止/关闭态打磨 | T093–T094 | FE coverage、headless H5、weapp | M4-A；`<400` |
| M4-C | latest-main 自动化与人工门禁记账 | T095–T096 | 全量 headless/verify；记录但不完成人工门禁 | M4-B；`<400` |
| M5-H1 | 今日工作台纯状态模型 | T098–T099 | FE 100% coverage；跨日、五状态、汇总、价格与补单资格 | M5-P；目标 `<300` |
| M5-H2 | 真实数据今日工作台与登录落点 | T100–T101 | FE coverage、headless H5、weapp；状态/失败/导航矩阵 | M5-H1；默认 `<400` |
| M5-H3 | 专用 manual draft 补录 | T102–T103 | FE coverage、headless H5、weapp；未开放/开放/截止/关闭与显式重复处理 | M5-H2；默认 `<400` |

每片开 PR 前按 `origin/main` 统计人工编写 diff。超过 400 行先继续拆；确实不可拆时必须在 PR 说明写明原因、风险和验证。超过 800 行不得开 PR。

M5-H1～H3 共享完成清单（不分配 Task ID）：相关窄测试、FE 100% coverage、`CI=1` 无头 H5 E2E、weapp build、`pnpm verify`、`git diff --check`、精确路径与人工 diff 审计全部通过；ready PR 的 latest-head CI/Codex review、actionable comment、unresolved thread 与 `mergeStateStatus=CLEAN` 闭环后只允许 rebase merge。docs-only M5-P 只执行其切片表所列验证与同一 PR 闭环。

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

- [x] T051 [US3] 先在 `packages/kith-inn-v1-shared/src/api.test.ts`、`apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts` 和 `apps/kith-inn-v1-be/src/routes/customerOrders.test.ts` 覆盖 C5R strict target、重复归一化、解析、结果与错误净化，并确认测试失败
- [x] T052 [US3] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts`、`packages/kith-inn-v1-shared/src/index.ts`、`apps/kith-inn-v1-be/src/domain/customerOrders/service.ts` 和 `apps/kith-inn-v1-be/src/routes/customerOrders.ts` 原子切换 live reservation endpoint；不修改 CMS route 或 FE
- [x] T053 [US3] 运行 shared/BE 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 C5R 只含 T051/T052 的精确路径且 `<400` 行；若超过则停止开 PR 并重新设计兼容切分
- [x] T054 [US3] 提交 T051/T052 精确路径，推送并创建 M2-C5R ready PR；在 PR 说明记录跨 shared/BE 原子切换是保持 `main` 类型一致且 contract 可执行的最小例外，闭环 latest-head CI/Codex review 后 rebase merge（PR #222 已合并）

---

## Phase 9：M2-C6 顾客登记 UI（US3）

**Goal**: booking 页完成资料选择/新建、本次快照、确认摘要、多餐次提交和逐项结果。

**Independent Test**: 无头 H5 跑通新/旧资料、两个餐次、部分失败和商家可见；weapp build 通过，T028 不被 H5 替代。

- [x] T055 [US3] 先在 `apps/kith-inn-v1-fe/src/services/api.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.test.ts` 和 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 覆盖资料用途短文案、公开 target、资料/摘要/提交、partial result 与 H5 纵向流，并确认测试失败
- [x] T056 [US3] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.ts`、`apps/kith-inn-v1-fe/src/pages/booking/index.tsx` 和 `apps/kith-inn-v1-fe/src/app.css` 实现用途短文案与 C6 UI，只从公开 batch view 构造 target，不增加“我的预订”页面
- [ ] T057 [US3] 运行 FE 100% coverage、`CI=1` 无头 H5 E2E、weapp build、`pnpm verify`、90 秒/45 秒指标、路径审计与人工 diff 统计；C6 路径符合范围且自动化已通过，但按 `5e1d63f..3b37a29` 实测人工 diff 为 459 additions / 20 deletions（479 行），超过 `<400` 默认预算，未找到合并前例外说明，因此本任务保持未完成；T028/维护者发布结论完成前仍不得标记可发布或已交付
- [x] T058 [US3] 提交 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.test.ts`、`apps/kith-inn-v1-fe/src/pages/booking/index.tsx`、`apps/kith-inn-v1-fe/src/app.css` 和 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts`，推送并创建 M2-C6 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #223 已合并）

**Checkpoint**: C1–C6 产品实现与自动化已合并；微信分享卡片到真实登录/query 的路径仍待 T028 真机验证，且 T057 历史预算未达标，不据此宣称 C6 已完整交付。

---

## Phase 10：M2-D1 strict self-service contracts（US4）

**Goal**: own-order/edit/cancel/deactivate contract 不允许顾客覆盖 owner 或三状态轴。

**Independent Test**: strict schema 只接受规定字段，own-order view 保留历史快照，额外 seller/openid/source/status/time 字段全部拒绝。

- [x] T059 [US4] 先在 `packages/kith-inn-v1-shared/src/api.test.ts` 覆盖 own-order/view、edit、cancel、deactivate strict contract 和状态轴注入拒绝，并确认测试失败
- [x] T060 [US4] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 D1 contracts
- [x] T061 [US4] 运行 shared 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 D1 只改 `packages/kith-inn-v1-shared/**` 且 `<400` 行
- [x] T062 [US4] 提交 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/api.test.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts`，推送并创建 M2-D1 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #224 已合并）

---

## Phase 11：M2-D2 owner-scoped persistence（US4）

**Goal**: own-order 与 profile deactivate/update 始终按 owner 过滤，并保持历史可见。

**Independent Test**: SQLite/PostgreSQL 覆盖幂等停用、历史订单读取、跨顾客 404、customer 写 service guard 和快照不变。

- [x] T063 [US4] 先扩展 `apps/cms/tests/kiv1-customer-profiles.test.ts` 和 `apps/cms/tests/kiv1-customer-orders.test.ts`，覆盖 D2 deactivate、own list、owner update、历史可见与跨顾客 404，并确认测试失败
- [x] T064 [US4] 在 `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts` 实现 D2 persistence boundary
- [x] T065 [US4] 运行 CMS SQLite/PostgreSQL 窄测试、`pnpm verify`、路径审计与人工 diff 统计，确认 D2 只含 `apps/cms/src/app/api/internal/kiv1/customer/**` 和 `apps/cms/tests/kiv1-customer-*.test.ts`、人工 diff `<400` 行且历史数据不改写
- [x] T066 [US4] 提交 `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts`、`apps/cms/tests/kiv1-customer-profiles.test.ts` 和 `apps/cms/tests/kiv1-customer-orders.test.ts`，推送并创建 M2-D2 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #225 已合并；取消持久化原子边界由 D2R PR #226 纠偏）

---

## Phase 12：M2-D3 BE 自助管理门禁（US4）

**Goal**: 修改/取消/停用前重查 batch/slot/deadline/owner/status，confirmed 立即锁单。

**Independent Test**: domain/route 覆盖 own list、edit/cancel/deactivate、closed/expired、confirmed/canceled、跨 owner 404 和非法状态零写入。

- [x] T067 [US4] 先在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.test.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.test.ts` 和 `apps/kith-inn-v1-be/src/app.test.ts` 覆盖 D3 重查与错误映射，并确认测试失败
- [x] T068 [US4] 在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 实现 D3 own list/edit/cancel/deactivate 与锁单门禁
- [x] T069 [US4] 运行 BE 100% coverage、`pnpm verify`、路径审计与人工 diff 统计，确认 D3 只含 `apps/kith-inn-v1-be/src/**`、人工 diff `<400` 行且不增加 FE 页面
- [x] T070 [US4] 提交 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts`、`apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.test.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerProfiles.test.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.test.ts`、`apps/kith-inn-v1-be/src/app.ts` 和 `apps/kith-inn-v1-be/src/app.test.ts`，推送并创建 M2-D3 ready PR；闭环 latest-head CI/Codex review 后 rebase merge（PR #227 已合并）

---

## Phase 13：M2-D4 顾客页面与总验收（US4）

**Goal**: 顾客只看到自有订单，并仅在允许窗口修改/取消和停用资料。

**Independent Test**: 无头 H5 跑通查看→修改→取消→商家确认→顾客锁单→资料停用；历史订单和三状态轴保持可见。

- [x] T071 [US4] 在 FE service/logic 与 `customer-booking.spec.ts`、`customer-orders.spec.ts` 覆盖 D4 页面逻辑和总纵向流，并确认测试先失败
- [x] T072 [US4] 在 `apps/kith-inn-v1-fe/src/**` 实现顾客订单页、session bootstrap、修改/取消与资料停用
- [x] T073 [US4] FE 100% coverage（60 tests，506/506 statements、684/684 branches、177/177 functions、430/430 lines）、8 条无头 H5 E2E、weapp build 与 `pnpm verify` 全绿；人工 diff 361 additions / 2 deletions（363 行），T028 仍未完成
- [x] T074 [US4] PR #230 已完成 latest-head CI、两轮 Codex review、unresolved=0，并于 2026-07-17 rebase merge

**Checkpoint**: M2 实现闭环；发布状态仍由 T028 与维护者结论单独决定。

---

## Phase 14：M3-A nullable 导入订单读模型（US5）

**Independent Test**: `jielong-import` 可为空 profile/address 并显示“无地址”；manual/customer-card 的缺失字段仍拒绝，既有排序、汇总和编辑无回归。

- [x] T075 [US5] 在 `packages/kith-inn-v1-shared/src/api.test.ts`、`apps/cms/tests/kiv1-orders.test.ts`、`apps/kith-inn-v1-be/src/domain/orders/summary.test.ts`、`apps/kith-inn-v1-fe/src/services/api.test.ts` 和 `apps/kith-inn-v1-fe/src/logic/orders.test.ts` 覆盖按 source 区分的 nullable DTO、CMS normalize、稳定排序和“无地址”清单
- [x] T076 [US5] 在 `packages/kith-inn-v1-shared/src/{api.ts,types.ts}`、`apps/cms/src/app/api/internal/kiv1/orders/route.ts`、`apps/kith-inn-v1-be/src/domain/orders/summary.ts`、`apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/orders.ts` 和 `apps/kith-inn-v1-fe/src/pages/merchant/orders/index.tsx` 实现向后兼容读模型

## Phase 15：M3-B strict 接龙 parser/contract（US5）

**Independent Test**: grammar、1～100 行/一万字符边界、行序、金额、preview hash 与 strict commit schema 全部确定性；只有标题或任何非法非空行都整批拒绝。

- [x] T077 [US5] 在 `packages/kith-inn-v1-shared/src/{api,jielong}.test.ts` 覆盖 strict preview/commit schema、header-only 拒绝、1/100/101 行边界、确定性 grammar 与 canonical input
- [x] T078 [US5] 在 `packages/kith-inn-v1-shared/src/{api.ts,jielong.ts,types.ts,index.ts}` 实现 parser、preview/commit DTO 和 canonical input，不增加 hash 计算、route 或写入

## Phase 16：M3-C CMS 导入持久化边界（US5）

**Independent Test**: SQLite/PostgreSQL 均要求 operator JWT + service secret，重查 seller/slot；只允许 jielong-import 的 null profile/openid/address 和服务端白名单字段；86 字符 marker 对外不可见，914/915 字符可见备注边界确定。

- [x] T079 [US5] 在 `apps/cms/tests/kiv1-orders.test.ts` 覆盖导入 create 的鉴权、owner、relationship、nullable、字段注入、marker 剥离/保留、914/915 字符可见备注边界和响应白名单
- [x] T080 [US5] 在 `apps/cms/src/app/api/internal/kiv1/orders/{route.ts,[id]/route.ts}` 与 `apps/cms/src/lib/kiv1-internal.ts` 实现导入写入、内部 note 标记剥离/保留和顺序重试查重，不放宽 manual/customer-card

## Phase 17：M3-D BE preview/commit（US5）

**Independent Test**: preview 零写入；commit 重新解析并重查餐次/当前价格，未写入时价格变化要求重新预览；首次提交成功但响应丢失后即使价格变化仍按旧 hash 返回 existing，旧 hash 搭配改过称呼/份数/目标/行号的文本则拒绝；顾客 batch 关闭/过期不阻止 seller-owned、有价格餐次导入；hash 篡改失败，相同 hash+行号重复提交订单增量为 0。

- [x] T081 [US5] 在 `apps/kith-inn-v1-be/src/domain/jielong/service.test.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.test.ts`、`apps/kith-inn-v1-be/src/routes/jielong.test.ts` 和 `apps/kith-inn-v1-be/src/app.test.ts` 覆盖绑定 seller/slot/price 的 preview hash、未写入价格变化失效、成功后价格漂移仍幂等、旧 hash 配篡改原文拒绝、关闭/过期顾客窗口不阻止接龙、确认、顺序重试与错误净化
- [x] T082 [US5] 在 `apps/kith-inn-v1-be/src/domain/jielong/service.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts`、`apps/kith-inn-v1-be/src/routes/jielong.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 实现 `/merchant/jielong/preview`、`/merchant/jielong/commit` 与 SHA-256 preview hash

## Phase 18：M3-E FE preview/confirm API 与逻辑（US5）

**Independent Test**: FE 只展示服务端 strict preview；未确认、hash 不匹配或非法结果不调用 commit，重试保持同一原文/hash。

- [x] T083 [US5] 在 `apps/kith-inn-v1-fe/src/{services/api,logic/jielongImport}.test.ts` 覆盖 strict 响应、确认门禁与结果派生
- [x] T084 [US5] 在 `apps/kith-inn-v1-fe/src/{services/api.ts,logic/jielongImport.ts}` 实现 typed client/logic，不注册页面或导航

## Phase 19：M3-F 默认关闭的接龙兜底页面（US5）

**Independent Test**: 默认构建主导航入口数为 0；显式开关构建的无头 H5 跑通粘贴→预览→确认→商家订单“无地址”，weapp build 通过。

- [x] T085 [US5] 在 `apps/kith-inn-v1-fe/src/logic/jielongImport.test.ts` 与 `apps/kith-inn-v1-fe/tests/e2e/jielong-import.spec.ts` 覆盖默认隐藏、显式启用和纵向导入
- [x] T086 [US5] 在 `apps/kith-inn-v1-fe/{config/index.ts,.env.example,src/app.config.ts,src/app.css,src/pages/merchant/jielong-import/index.tsx}` 实现 feature-gated 弱入口与页面

## Phase 20：M3-G 公开文案与隐私提示（US6）

**Independent Test**: 顾客公开页统一“预订登记”，风险词审计为 0；称呼/地址用途、保存/软停用/历史保留边界可见，H5/weapp 无回归。

- [x] T088 [US6] 在 `apps/kith-inn-v1-fe/tests/e2e/{customer-booking.spec.ts,customer-orders.spec.ts}` 覆盖公开文案审计、隐私说明入口及用途/保留边界
- [x] T089 [US6] 在 `apps/kith-inn-v1-fe/src/pages/booking/index.tsx`、`apps/kith-inn-v1-fe/src/pages/customer/orders/index.tsx`、`apps/kith-inn-v1-fe/src/pages/privacy/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts` 和 `apps/kith-inn-v1-fe/src/app.css` 实现文案与说明页

## Phase 21：M4-A 顾客数据控制（US6）

**Independent Test**: 版本化 JSON 只含当前 owner 的 active profiles/own orders；批量软停用需二次确认，部分失败可重试，历史订单可读率 100%。

- [x] T091 [US6] 在 FE customer logic/page tests 与 headless E2E 覆盖安全导出字段、复制、二次确认、逐项停用和部分失败
- [x] T092 [US6] 在 `apps/kith-inn-v1-fe/src/{logic/customerData.ts,pages/customer/orders/index.tsx,services/api.ts,app.css}` 实现数据复制与批量软停用，不增加物理删除 API

## Phase 22：M4-B 页面状态收口（US6）

**Independent Test**: booking、customer orders、merchant orders 与 jielong 页的 loading/empty/error/closed/deadline 状态都有唯一、可执行文案；无匿名或 mock 降级。

- [x] T093 [US6] 在 `apps/kith-inn-v1-fe/src/logic/{customerBooking,customerOrders,orders,jielongImport}.test.ts` 与 `apps/kith-inn-v1-fe/tests/e2e/{customer-booking,customer-orders,merchant,jielong-import}.spec.ts` 建立错误、空态、截止和关闭状态矩阵
- [x] T094 [US6] 在 `apps/kith-inn-v1-fe/src/pages/booking/index.tsx`、`apps/kith-inn-v1-fe/src/pages/customer/orders/index.tsx`、`apps/kith-inn-v1-fe/src/pages/merchant/orders/index.tsx`、`apps/kith-inn-v1-fe/src/pages/merchant/jielong-import/index.tsx` 和 `apps/kith-inn-v1-fe/src/app.css` 收口状态呈现，不改变业务状态机

## Phase 23：M4-C 自动化总验收与真实门禁记账（US6）

**Independent Test**: latest main 的 migration readiness 只读检查、workspace coverage、全量无头 H5、weapp build 与 `pnpm verify` 全绿；人工门禁只凭真实证据勾选。

- [x] T095 [US6] 在 `specs/010-kith-inn-v1-customer-booking/tasks.md` 记录 latest-main 自动化命令、结果、head、scope 审计证据，以及 T028/T087/T090/T097 的真实未完成/完成状态；不得用本任务完成任何缺少真实证据的人工门禁
- [x] T096 [US6] 在 M4-C 的 latest main 重新只读核实 production migration baseline、runner、ready/health gate 与对应测试并记录 head；规划时已见 `cae51c0`、`1f8622f`，但不以早期检查替代最终验收，且不修改授权范围外文件

### M4-C 验收记录（2026-07-17）

- **受验基线**：从当时 latest `origin/main` `2cc075da998123dae8cc53c266e9e5666733feb2`（PR #240 rebase merge）创建 M4-C 分支；验收完成后重新 `git fetch origin main`，本地基线与远端仍相同、worktree 无业务改动。`cae51c0`、`1f8622f` 均经 `git merge-base --is-ancestor <commit> HEAD` 确认为该 head 的祖先。
- **migration/readiness 只读验收**：checked-in head 仍为 `20260714_105116_initial_cms_schema`。`apps/cms/migrations/run.ts` 强制 PostgreSQL 且关闭 schema push，迁移前只接受安全的 committed prefix、迁移后要求精确 head；`/api/health` 只承担 liveness，带内部鉴权的 `/api/ready` 才检查 PostgreSQL、精确 migration head 与 seller query。未修改这些授权范围外文件。
- **migration/readiness 测试**：fresh 隔离 PostgreSQL 先以 `NODE_ENV=test PAYLOAD_DB_PUSH=false ... pnpm --filter @cfp/cms exec tsx migrations/run.ts` 通过真实 production runner 迁移到 `20260714_105116_initial_cms_schema`，再以同一数据库和 `PAYLOAD_DB_PUSH=false` 运行 `pnpm --filter @cfp/cms exec vitest run tests/migration-production.test.ts src/app/api/health/route.test.ts`，2 files、13/13 tests 通过；真实 ready probe 已执行精确 head 检查，并覆盖同 head 重跑保留 sentinel、危险/缺失历史 fail-closed、鉴权、超时与错误净化。隔离测试库随后清理。
- **v1 workspace coverage**：`pnpm --filter @cfp/kith-inn-v1-shared test:coverage` 为 4 files、61 tests、288/288 statements、58/58 branches、64/64 functions、265/265 lines；`pnpm --filter @cfp/kith-inn-v1-be test:coverage` 为 26 files、163 tests、1416/1416 statements、979/979 branches、348/348 functions、1188/1188 lines；`pnpm --filter @cfp/kith-inn-v1-fe test:coverage` 为 12 files、74 tests、598/598 statements、759/759 branches、210/210 functions、500/500 lines。
- **纵向与构建门禁**：`CI=1 pnpm --filter @cfp/kith-inn-v1-fe test:e2e` 为 9/9 无头 H5 tests 通过；`pnpm --filter @cfp/kith-inn-v1-fe build:weapp` 通过；以本地 PostgreSQL 和 CI 同等必要环境运行 `pnpm verify`，lint 13/13、typecheck 13/13、coverage 13/13、knip 退出 0、build 13/13。
- **scope 审计**：汇总 PR #229～#240 的 `gh pr diff <pr> --name-only` 后共有 61 个唯一路径；业务与文档改动全部位于授权的 v1 workspaces、`/api/internal/kiv1/**`、`apps/cms/src/lib/kiv1-internal.ts`、对应 `kiv1-*` tests 和 `specs/010-*`。唯一根级文件是 PR #236 为 v1 FE 增加 `zod` 直接依赖所生成的 3 行 `pnpm-lock.yaml` 更新；旧 apps/packages、`docs/kith-inn/**`、`specs/016-*`、`specs/017-*` 命中均为 0。
- **真实发布状态**：T028、T087、T090、T097 均缺少真机、微信后台或审核证据，继续保持未完成；本验收不以 H5、weapp build 或自动化替代。T057 也继续按历史 479 行人工 diff 事实保持未完成。

## Phase 24：M5-H1 今日工作台纯状态模型

**Goal**: 在不注册新页面的前提下，把 US7 的今日日期、午晚餐状态、订单汇总、价格文案和手动加单资格收敛为可测试的纯逻辑。

**Independent Test**: Asia/Shanghai 在 UTC 跨日边界取到正确日期；午餐/晚餐分别覆盖尚未排菜单、已排菜单但未开放、预订中、已截止、已关闭；draft 只汇总为“待确认订单”；已确认订单数/份数、未付和待送数据准确；空价格显示“商家默认价”；只要餐次存在，截止或关闭后仍允许商家手动加单。

- [ ] T098 [US7] 先在 `apps/kith-inn-v1-fe/src/logic/merchantHome.test.ts` 覆盖 Asia/Shanghai UTC 跨日、五种餐次状态、draft/confirmed/未付/待送汇总、金额/默认价文案、餐次存在性与手动加单资格，并确认测试失败
- [ ] T099 [US7] 在 `apps/kith-inn-v1-fe/src/logic/merchantHome.ts` 实现无 Taro/React 副作用的首页状态模型，不注册页面、不请求 API、不显示“新订单”

## Phase 25：M5-H2 真实数据今日工作台页面

**Goal**: 商家登录和已有 session 默认进入高保真今日工作台，并用既有接口呈现今天午餐、晚餐及订单汇总。

**Independent Test**: 首页首屏调用一次 `listMealSlots(today,today)`，仅为存在的午/晚餐并行调用 `listOrders`；登录/session 落点、不同餐次状态、待确认汇总、加载/空态/部分失败/整页失败/重试、页面重新显示刷新与菜单/预订/订单/配送快捷入口均可在无头 H5 验证，weapp build 通过。

- [ ] T100 [US7] 先在 `apps/kith-inn-v1-fe/src/logic/login.test.ts` 与 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 覆盖登录和已有 session 落点、午晚餐真实状态、待确认汇总、空态/单餐失败/整页失败/重试、重新显示刷新、快捷入口与页面内 `MerchantNav`，并确认测试失败
- [ ] T101 [US7] 在 `apps/kith-inn-v1-fe/src/{logic/login.ts,pages/merchant/login/index.tsx,components/MerchantNav.tsx,pages/merchant/home/index.tsx,app.config.ts,app.css}` 实现首页；复用 API client/store/H1 模型，不增加全局 tabBar、第二套状态管理或 `/merchant/dashboard`

## Phase 26：M5-H3 专用手动加单闭环

**Goal**: 桃子从今日餐次进入专用页面，为已排菜单但未开放、正在预订、已截止或已关闭餐次补录 manual draft 私信订单，且重复/重提均需显式确认。

**Independent Test**: 页面展示日期、午晚餐和顾客预订状态；可选择已有资料或创建“称呼 + 地址”，填写正整数份数和备注；重复 manual draft 只在确认后更新，manual canceled 只在确认后重提；customer-card/jielong-import 冲突保留 source 并转查看既有订单；未开放、开放、截止和关闭餐次均可保存，无餐次时提示先排菜单；成功后可查看对应餐次订单。

- [ ] T102 [US7] 先在 `apps/kith-inn-v1-fe/src/logic/orders.test.ts` 与 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 覆盖未开放/开放/截止/关闭、已有/新建顾客、数量/备注、重复 manual draft 显式更新、manual canceled 显式重提、非 manual 冲突保留 source 并转查看既有订单、无餐次与成功去向，并确认测试失败
- [ ] T103 [US7] 在 `apps/kith-inn-v1-fe/src/{logic/orders.ts,pages/merchant/home/index.tsx,pages/merchant/orders/index.tsx,pages/merchant/orders/add/index.tsx,app.config.ts,app.css}` 实现专用流程；复用现有 profile/manual-order API，不因顾客截止禁用，不将非 manual 冲突改标为 manual，并显示“顾客预订已截止，商家仍可手动补录私信订单。”

### 独立人工发布门禁（不阻塞自动化切片）

- [ ] T087 [US5] 使用已配置微信小程序的真机完成接龙兜底页体验版 smoke；不得以 H5/weapp build 替代
- [ ] T090 [US6] 在微信后台完成正式用户隐私保护指引配置并留存真实审核证据；页面文案和自动化不得替代
- [ ] T097 [US6] 完成小程序类目/资质路径确认、体验版/审核版结论并留存真实证据；不得因自动化全绿而勾选

---

## Dependencies & Execution Order

```text
恢复计划 PR
  └─ C1 ─ C2 ─ C3 ─ C4 ─ C5
                         └─ 坐标纠偏计划 ─ C5R ─ C6 ─ D1 ─ D2 ─ D3 ─ D4
  └─ M3-A ─ M3-B ─ M3-C ─ M3-D ─ M3-E ─ M3-F ─ M3-G ─ M4-A ─ M4-B ─ M4-C
  └─ M5-P ─ M5-H1 ─ M5-H2 ─ M5-H3
```

- M2 的 T001–T027/T029–T056/T058–T074 已完成；T028 保持未完成真机门禁，T057 因历史 C6 人工 diff 为 479 行保持未完成。
- M3/M4 PR 不并行、不 stacked；每片从前一片合并后的最新 `main` 开始。
- M5 同样不并行、不 stacked；M5-P 只改本规格的 `spec.md`/`plan.md`/`tasks.md`，H1 只建纯状态模型，H2 才注册首页，H3 才拆出专用手动加单页。
- 每片 tests-first；只实现当前层的不变量，不预建下一片 route/page/scaffold。
- nullable 读模型是导入写入前置；parser contract 是 CMS/BE/FE 共同边界；M4 只在 M3 自动化闭环后开始。

## Parallel Opportunities

- 不并行推进 PR；同一片内若测试涉及多个既有文件，可在同一失败测试阶段准备，但实现仍在测试确认失败后开始。
- 同一片的独立 test suite 可并行运行；weapp build 和 `pnpm verify` 仍以同一 head 为准汇总。

## Implementation Strategy

1. M2 与 D2R 已合并；T057 历史预算未达标与 T028 真机未验证的事实不变。
2. M3-A～M4-C 已严格串行实施，没有重复已合并能力或预建下一片 scaffold。
3. 接龙默认关闭且无 AI；M4 数据删除只做已规定的 profile 软停用，历史订单不改写。
4. 每轮修复后等待 latest-head CI，再精确 `@codex review`；latest head 无新 comment、unresolved=0、CI 全绿、mergeState=CLEAN 后才 rebase merge。
5. T028、T087、T090、T097 只能由真实设备/微信后台/审核事实完成；自动化不改变其状态。
6. M5 保留 API client、store 与可复用逻辑，逐页重写商家呈现层；顾客截止门禁不放宽，merchant manual 补录继续允许截止或关闭餐次。
