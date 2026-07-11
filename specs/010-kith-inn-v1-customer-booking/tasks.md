---

description: "街坊味 v1 M2 顾客预订登记的依赖有序实施任务"
---

# Tasks：街坊味 v1 顾客预订登记

**Input**: `specs/010-kith-inn-v1-customer-booking/` 下的 spec、plan、research、data-model、contracts 和 quickstart

**Tests**: 本功能要求 contract、领域、route、FE logic、H5 E2E 与 weapp smoke；每个实现 PR 先写能失败的窄测试，再实现，再运行 `pnpm verify`。

**Organization**: 任务严格按 plan.md 的 M2-A～M2-D 四个顺序 PR 切分。每个 PR 必须从前一 PR 合并后的最新 `main` 开始，置为 ready for review 并处理完 Codex actionable comments 后才进入下一片。

## 格式

- `[P]`：可与同阶段其他 `[P]` 任务并行，且不会修改同一文件。
- `[US1]`～`[US4]`：对应 spec.md 用户故事。
- 每条任务给出预期修改或验证的准确路径。

## Phase 1：M2-A 商家餐次配置与批次 path（US1）

**Goal**: 桃子可以配置餐次预订状态、创建/关闭 booking batch，并获得固定分享 path。

**Independent Test**: 以 operator 登录，开放两个有效餐次，创建 batch 并预览/复制 path，再分别关闭 batch 和 slot；验证 batch close 不修改 slot、slot close 会让所有入口中的该餐次不可写，且 M2-A 不发出指向未注册页面的真实卡片。

### Tests first

- [ ] T001 [P] [US1] 在 `packages/kith-inn-v1-shared/src/api.test.ts` 为含 `orderDeadline` 的 MealSlot、booking config、batch create/update/list/share schema 添加 contract 测试并确认先失败
- [ ] T002 [P] [US1] 在 `apps/cms/tests/kiv1-booking-batches.test.ts` 添加 operator owner、relationship guard、service token、创建/关闭 batch 的 route 测试并确认先失败
- [ ] T003 [P] [US1] 在 `apps/cms/tests/kiv1-meal-slots.test.ts` 添加 booking config 白名单、owner 与 service token 测试并确认先失败
- [ ] T004 [P] [US1] 在 `apps/kith-inn-v1-be/src/routes/bookingBatches.test.ts` 和 `apps/kith-inn-v1-be/src/routes/mealSlots.test.ts` 添加 UUID、1–20 去重、默认标题、open 前置条件、关闭幂等与错误映射测试并确认先失败
- [ ] T005 [P] [US1] 在 `apps/kith-inn-v1-fe/src/logic/bookingBatches.test.ts` 添加可选餐次、分享 path、关闭提示的纯逻辑测试并确认先失败
- [ ] T006 [P] [US1] 在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 添加配置餐次、创建/关闭批次和 H5 复制 path 的无头场景并确认先失败

### Implementation

- [ ] T007 [US1] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 merchant booking config/batch contract，并为 MealSlot 补 `orderDeadline`
- [ ] T008 [US1] 在 `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/meal-slots/[id]/booking-config/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/booking-batches/route.ts` 实现 service-auth 的配置、batch list/create 与同 seller guard
- [ ] T009 [US1] 在 `apps/cms/src/app/api/internal/kiv1/booking-batches/[id]/route.ts` 实现 owner-scoped 幂等关闭，且不联动修改 meal slot
- [ ] T010 [US1] 在 `apps/kith-inn-v1-be/src/lib/cms/mealSlots.ts`、`apps/kith-inn-v1-be/src/lib/cms/bookingBatches.ts` 和 `apps/kith-inn-v1-be/src/domain/bookings/availability.ts` 实现 CMS client、open 前置条件、价格解析、UUID/default title/share path 纯逻辑
- [ ] T011 [US1] 在 `apps/kith-inn-v1-be/src/routes/mealSlots.ts`、`apps/kith-inn-v1-be/src/routes/bookingBatches.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 装配 merchant endpoints 与稳定错误码
- [ ] T012 [US1] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/bookingBatches.ts`、`apps/kith-inn-v1-fe/src/pages/merchant/batches/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts` 和 `apps/kith-inn-v1-fe/src/app.css` 实现商家批次页与 weapp/H5 path 预览复制，M2-A 不注册顾客页或启用原生分享

### Gate / PR

- [ ] T013 [US1] 运行 shared/CMS/BE/FE 窄测试、`pnpm --filter @cfp/kith-inn-v1-fe build:weapp`、`CI=1` H5 E2E 与 `pnpm verify`；验证 M2-A 无原生分享入口，并记录 60 秒和零内部标识指标
- [ ] T014 [US1] 审计 M2-A diff：不含 customer auth/profile/order write，不改 `packages/kith-inn-v1-payload` collection/索引、不改旧 `@cfp/kith-inn-*` 业务 package、不新增 workspace/依赖
- [ ] T015 [US1] 提交并推送 `codex/kith-inn-v1-m2-a`，创建 base=`main` 的 ready PR；等待一次自动 Codex review，逐条回复/修复并 resolve actionable thread 后 rebase merge

**Checkpoint**: M2-A 独立可用；合并后才能开始 M2-B。

---

## Phase 2：M2-B 顾客静默会话与只读分享页（US2）

**Goal**: 顾客从有效分享 path 静默建立 seller-bound session，并只读查看限定 batch；operator/customer 信任域完全隔离。

**Independent Test**: 从有效、closed 和跨 seller 三种 publicId 进入，验证有效入口静默显示内容、closed 入口只读、跨 seller/不存在入口不签发 token；无 profile/order 写入。

### Tests first

- [ ] T016 [P] [US2] 在 `packages/kith-inn-v1-shared/src/auth.test.ts` 和 `packages/kith-inn-v1-shared/src/api.test.ts` 添加 customer claims、session、login、public batch view contract 测试并确认先失败
- [ ] T017 [P] [US2] 在 `apps/cms/tests/kiv1-customer-auth.test.ts` 添加 service bootstrap、customer JWT kind/expiry/seller owner、closed batch read 与跨 seller 404 测试并确认先失败
- [ ] T018 [P] [US2] 在 `apps/kith-inn-v1-be/src/middleware/customerAuth.test.ts` 和 `apps/kith-inn-v1-be/src/routes/auth.test.ts` 添加 customer token 隔离、微信 code 只使用一次、dev 双开关和敏感信息不落日志测试并确认先失败
- [ ] T019 [P] [US2] 在 `apps/kith-inn-v1-be/src/routes/bookingBatches.test.ts` 添加 public view、resolved price、canBook reason、closed/archived 可读与跨 seller 404 测试并确认先失败
- [ ] T020 [P] [US2] 在 `apps/kith-inn-v1-fe/src/store/customerSession.test.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.test.ts` 添加独立 storage、query 恢复、silent login 与只读派生测试并确认先失败
- [ ] T021 [P] [US2] 在 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 添加 H5 dev customer login、batch 展示、closed 状态与 query 恢复的无头 E2E 并确认先失败

### Implementation

- [ ] T022 [US2] 在 `packages/kith-inn-v1-shared/src/auth.ts`、`packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 customer claims/login/session/public view schema，确保编译产物兼容 Taro loader
- [ ] T023 [US2] 在 `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/auth/customer-session/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/booking-batches/[publicId]/route.ts` 实现 service bootstrap 与只读 customer scope
- [ ] T024 [US2] 在 `apps/kith-inn-v1-be/src/middleware/customerAuth.ts`、`apps/kith-inn-v1-be/src/lib/cms/auth.ts`、`apps/kith-inn-v1-be/src/lib/cms/bookingBatches.ts` 和 `apps/kith-inn-v1-be/src/routes/auth.ts` 实现微信/dev customer session 与 operator/customer token 隔离
- [ ] T025 [US2] 在 `apps/kith-inn-v1-be/src/routes/bookingBatches.ts`、`apps/kith-inn-v1-be/src/domain/bookings/availability.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 实现 customer-authenticated public batch read 与只读原因派生
- [ ] T026 [US2] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/store/customerSession.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.ts`、`apps/kith-inn-v1-fe/src/pages/booking/index.tsx`、`apps/kith-inn-v1-fe/src/pages/merchant/batches/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts` 和 `apps/kith-inn-v1-fe/src/app.css` 实现静默登录、只读目标页并在目标存在后启用 weapp 原生分享
- [ ] T027 [US2] 在 `apps/kith-inn-v1-be/.env.example` 和 `apps/kith-inn-v1-fe/.env.example` 记录微信配置、customer dev login 双开关与生产禁用语义

### Gate / PR

- [ ] T028 [US2] 运行 shared/CMS/BE/FE 窄测试、`pnpm --filter @cfp/kith-inn-v1-fe build:weapp`、`CI=1` H5 E2E 与 `pnpm verify`；完成原生分享卡片→目标页→`wx.login`/query 真机 smoke，并记录 M2-B 正常网络 5 秒指标
- [ ] T029 [US2] 审计 M2-B diff：无 profile/order 写 API、无 operator session 回归、无新持久化字段/secret 日志/Node-only weapp 依赖
- [ ] T030 [US2] 从 M2-A 合并后的 main 提交并推送 `codex/kith-inn-v1-m2-b`，创建 ready PR；等待一次自动 Codex review，处理完 actionable thread 后 rebase merge

**Checkpoint**: M2-B 独立可用；合并后才能开始 M2-C。

---

## Phase 3：M2-C 顾客资料与首次多餐次登记（US3）

**Goal**: 首次和回访顾客可选择/新建资料，编辑本次快照，并以逐项结果提交最多 20 个餐次的 draft 订单。

**Independent Test**: 同一顾客选择两个餐次提交，验证成功项可在 M1 商家订单页看到；重复 draft 更新原 id，confirmed/canceled/截止项分别返回稳定逐项结果，其他成功项不回滚。

### Tests first

- [ ] T031 [P] [US3] 在 `packages/kith-inn-v1-shared/src/api.test.ts` 添加 customer profile、reservation input、1–20 去重 items、完全重复项归一化、冲突重复项 422、created/updated/resubmitted/failed result 与 customer-card CMS schema 测试并确认先失败
- [ ] T032 [P] [US3] 在 `apps/cms/tests/kiv1-customer-profiles.test.ts` 添加 seller+openid list/create、响应隐藏 openid、service token 与 profile owner guard 测试并确认先失败
- [ ] T033 [P] [US3] 在 `apps/cms/tests/kiv1-customer-orders.test.ts` 添加 customer order 查重/create/update、profile/slot/openid relationship guard、唯一冲突和 customer-card 白名单测试并确认先失败
- [ ] T034 [P] [US3] 在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts` 添加 create/update/显式 resubmit/confirmed lock、价格快照、逐项部分成功和 profile 不回滚测试并确认先失败
- [ ] T035 [P] [US3] 在 `apps/kith-inn-v1-be/src/routes/customerProfiles.test.ts` 和 `apps/kith-inn-v1-be/src/routes/customerOrders.test.ts` 添加 route 鉴权、batch/slot/deadline 重查、输入上限与错误映射测试并确认先失败
- [ ] T036 [P] [US3] 在 `apps/kith-inn-v1-fe/src/logic/customerBooking.test.ts` 添加资料选择、本次快照、保存为新资料、确认摘要和逐项结果展示测试并确认先失败
- [ ] T037 [P] [US3] 在 `apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` 添加新/旧资料、多餐次、部分失败与 M1 商家可见的无头 E2E 场景并确认先失败

### Implementation

- [ ] T038 [US3] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 customer profile/reservation/CMS customer-card strict contracts
- [ ] T039 [US3] 在 `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/customer/profiles/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/touch/route.ts` 实现 customer profile list/create/touch 的 scope、owner 与 service guard
- [ ] T040 [US3] 在 `apps/cms/src/app/api/internal/kiv1/customer/orders/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/by-slot/[mealSlotId]/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts` 实现 customer order list-by-coordinate/create/update persistence boundary
- [ ] T041 [US3] 在 `apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts` 和 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts` 实现 profile owner、availability 重查、单项状态机、价格快照与部分成功 orchestration
- [ ] T042 [US3] 在 `apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 装配 profile list/create 与 reservation submit endpoints
- [ ] T043 [US3] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/customerBooking.ts`、`apps/kith-inn-v1-fe/src/pages/booking/index.tsx` 和 `apps/kith-inn-v1-fe/src/app.css` 实现资料选择/新建、本次快照、多餐次确认与逐项结果 UI

### Gate / PR

- [ ] T044 [US3] 运行 shared/CMS/BE/FE 窄测试、`pnpm --filter @cfp/kith-inn-v1-fe build:weapp`、`CI=1` H5 E2E 与 `pnpm verify`；完成 M2-C 真机 smoke，并记录首次/回访顾客 90 秒/45 秒指标
- [ ] T045 [US3] 审计 M2-C diff：customer 写均要求 JWT+service token、无 openid/seller 客户端覆盖、无跨项事务假设、无“我的预订”修改/取消或 profile 停用
- [ ] T046 [US3] 从 M2-B 合并后的 main 提交并推送 `codex/kith-inn-v1-m2-c`，创建 ready PR；等待一次自动 Codex review，处理完 actionable thread 后 rebase merge

**Checkpoint**: M2-C 独立可用；合并后才能开始 M2-D。

---

## Phase 4：M2-D 我的预订、修改/取消与资料软停用（US4）

**Goal**: 顾客只读查看自有订单三状态轴，在锁单前修改/取消 draft，并可软停用资料；商家确认后即时锁定。

**Independent Test**: 顾客修改、取消和显式重登记 draft/canceled，桃子确认后顾客写入均失败；停用 profile 后历史订单仍可按 openid 查看且快照不变。

### Tests first

- [ ] T047 [P] [US4] 在 `packages/kith-inn-v1-shared/src/api.test.ts` 添加 customer order list/view、edit/cancel、profile deactivate 与三状态轴 contract 测试并确认先失败
- [ ] T048 [P] [US4] 在 `apps/cms/tests/kiv1-customer-profiles.test.ts` 和 `apps/cms/tests/kiv1-customer-orders.test.ts` 添加幂等停用、历史可见、seller+openid owner filter 和写入 service guard 测试并确认先失败
- [ ] T049 [P] [US4] 在 `apps/kith-inn-v1-be/src/domain/customerOrders/service.test.ts` 添加 edit/cancel 前重查 batch/slot/deadline/owner/status、confirmed lock、canceled 显式重登记清理时间轴测试并确认先失败
- [ ] T050 [P] [US4] 在 `apps/kith-inn-v1-be/src/routes/customerOrders.test.ts` 和 `apps/kith-inn-v1-be/src/routes/customerProfiles.test.ts` 添加 own list、edit/cancel/deactivate route 与跨顾客 404 测试并确认先失败
- [ ] T051 [P] [US4] 在 `apps/kith-inn-v1-fe/src/logic/customerOrders.test.ts` 添加状态文案、可改判断、取消确认、历史 profile 显示测试并确认先失败
- [ ] T052 [P] [US4] 在 `apps/kith-inn-v1-fe/tests/e2e/customer-orders.spec.ts` 添加顾客修改→取消→重登记→商家确认→顾客锁定及 profile 停用的无头 E2E 场景并确认先失败

### Implementation

- [ ] T053 [US4] 在 `packages/kith-inn-v1-shared/src/api.ts`、`packages/kith-inn-v1-shared/src/types.ts` 和 `packages/kith-inn-v1-shared/src/index.ts` 实现 own-order/edit/cancel/deactivate contracts
- [ ] T054 [US4] 在 `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route.ts` 和 `apps/cms/src/app/api/internal/kiv1/customer/orders/[id]/route.ts` 实现幂等软停用与 owner-scoped update boundary
- [ ] T055 [US4] 在 `apps/kith-inn-v1-be/src/lib/cms/customerProfiles.ts`、`apps/kith-inn-v1-be/src/lib/cms/orders.ts` 和 `apps/kith-inn-v1-be/src/domain/customerOrders/service.ts` 实现停用、own list、edit/cancel/resubmit 的写前重查和状态转换
- [ ] T056 [US4] 在 `apps/kith-inn-v1-be/src/routes/customerProfiles.ts`、`apps/kith-inn-v1-be/src/routes/customerOrders.ts` 和 `apps/kith-inn-v1-be/src/app.ts` 装配 deactivate、own list、edit 与 cancel endpoints
- [ ] T057 [US4] 在 `apps/kith-inn-v1-fe/src/services/api.ts`、`apps/kith-inn-v1-fe/src/logic/customerOrders.ts`、`apps/kith-inn-v1-fe/src/pages/customer/orders/index.tsx`、`apps/kith-inn-v1-fe/src/app.config.ts` 和 `apps/kith-inn-v1-fe/src/app.css` 实现我的预订、三状态轴、修改/取消与资料停用 UI

### Gate / PR

- [ ] T058 [US4] 运行 shared/CMS/BE/FE 窄测试、`pnpm --filter @cfp/kith-inn-v1-fe build:weapp`、`CI=1` H5 E2E 与 `pnpm verify`；完成 M2-D 真机 smoke，并从空 M2 数据执行 seed→分享→登记→商家确认→顾客锁单 quickstart 总验收
- [ ] T059 [US4] 审计 M2 总 diff：七个 collection/索引不变，旧 `@cfp/kith-inn-*` 业务 package 不变，无 M3 对账催款/批量状态增强、无 M4 AI、无新 workspace/进程/依赖
- [ ] T060 [US4] 从 M2-C 合并后的 main 提交并推送 `codex/kith-inn-v1-m2-d`，创建 ready PR；等待一次自动 Codex review，处理完 actionable thread 后 rebase merge

**Checkpoint**: M2 顾客预订登记闭环完成。

---

## Dependencies & Execution Order

```text
规格 PR merge
  └─ M2-A / US1 (T001–T015)
       └─ M2-B / US2 (T016–T030)
            └─ M2-C / US3 (T031–T046)
                 └─ M2-D / US4 (T047–T060)
```

- 四个 phase 不做 stacked PR；每个 phase 都从前一个 rebase merge 后的最新 `main` 开始。
- phase 内 tests-first；shared contract → CMS persistence boundary → BE domain/routes → FE 页面 → gate。
- `[P]` 只表示测试文件互不冲突；实现任务因 contract 和跨层依赖按编号顺序执行。
- 任一 checkpoint 可独立停止，不提前把下一 phase 的空 route/page/scaffold 放入当前 PR。

## Implementation Strategy

1. 先合并本规格 PR；它只包含 `specs/010-kith-inn-v1-customer-booking/**`。
2. M2-A 交付商家配置、batch 和待分享 path；M2-B 在目标页存在后一次性启用真实分享，是顾客入口的完整纵向切片。
3. M2-B 只建立 customer 信任域和只读页，便于单独审查 auth 边界。
4. M2-C 集中 profile + 首次提交，复用 M1 商家订单页验证持久化结果。
5. M2-D 最后增加自助变更和总验收，不把未来 M3/M4 能力带入。
6. 每个 PR 只触发一次 ready-for-review 自动 Codex review；除自动 review 未启动且已确认机制异常外，不重复 `@codex review`。
