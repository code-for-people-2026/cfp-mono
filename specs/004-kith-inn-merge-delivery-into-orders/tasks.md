---
description: "kith-inn 合并配送进订单 实现任务"
---

# Tasks：kith-inn 合并配送进订单

**输入**: `specs/004-kith-inn-merge-delivery-into-orders/spec.md`、`plan.md`

**测试策略**: 本 feature be 零改动、改动集中在 fe（逻辑 + 菜单页重写 + 删页 + TabBar）。逻辑抽进 `logic/ordersLifecycle.ts` 纯函数单测到 100%；订单页（display）交 e2e，不追行覆盖。

**组织**: 三 phase：纯函数 → 页重写 + 删页/tab → docs + 门禁 + PR。

## Format：`[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、不依赖未完成）。
- **[Story]**: `[US1]`/`[US2]`/`[US3]`/`[US4]`。
- 每任务写明精确文件路径 + FR。

## Phase 1：纯函数 + 测试（先红）

**目的**: 把订单生命周期/餐次焦点/地址排序/双轴映射落成可单测纯函数，页只管渲染。

- [ ] T001 [P] 在 `apps/kith-inn-fe/src/logic/ordersLifecycle.test.ts`（新）增加用例覆盖：
  - `joinOrdersFulfillments(orders, fulfillments)`：按 `fulfillment.order.id === order.id` 配对；order 无 fulfillment（draft/canceled 未物化）→ `fulfillment: undefined`。
  - `lifecycleDots(row)`：返 `{ base: "draft"|"confirmed"|"canceled", delivery: "pending"|"done"|"none", payment: "unpaid"|"paid" }`（delivery `none` = 无 fulfillment，draft 单）。
  - `mealFocus(rows)`：今天最早一个有 `delivery==="pending"` 的餐次（午→晚）；都 done → 最晚存在的餐次；空 → null。
  - `sortByAddress(rows)`：按 `order.address` 字符串升序（`localeCompare`），无地址排末。
  覆盖 FR-002/FR-003/FR-004。
- [ ] T002 [P] 在同文件加 `gapCount(rows, occasion)`（该餐次 `delivery==="pending"` 计数）+ `byOccasion(rows, occasion)`（筛该餐次 confirmed/canceled 行）用例。覆盖 FR-007。

## Phase 2：纯函数实现

- [ ] T003 在 `apps/kith-inn-fe/src/logic/ordersLifecycle.ts`（新）实现 T001/T002 的函数。类型：
  ```ts
  type Row = { order: Order; fulfillment?: Fulfillment };
  function joinOrdersFulfillments(orders: Order[], fulfillments: Fulfillment[]): Row[]
  function lifecycleDots(row: Row): { base; delivery: "pending"|"done"|"none"; payment: "unpaid"|"paid" }
  function mealFocus(rows: Row[]): "lunch" | "dinner" | null
  function sortByAddress(rows: Row[]): Row[]
  function byOccasion(rows: Row[], occasion: "lunch"|"dinner"): Row[]
  function gapCount(rows: Row[], occasion: "lunch"|"dinner"): number
  ```
  - `lifecycleDots.delivery`：`row.fulfillment?.status === "done"` → done；`=== "pending"` → pending；无 fulfillment → none。
  - `lifecycleDots.payment`：`order.paymentStatus === "paid" || "reconciled"` → paid，否则 unpaid。
  - `lifecycleDots.base`：`order.status`（draft/confirmed/canceled）。

**Checkpoint**: 纯函数 100% 单测；`pnpm --filter @cfp/kith-inn-fe test` 绿。

## Phase 3：订单页重写 + 删配送 + 三 tab

- [ ] T004 [US1][US2][US3][US4] 重写 `apps/kith-inn-fe/src/pages/orders/index.tsx`：
  - mount：并行拉 `GET /orders?date=today` + `GET /delivery?date=today` → `joinOrdersFulfillments` → `sortByAddress` → state。
  - 餐次焦点：`mealFocus` → 默认；顶部 `[◀ 前一餐] 今日·{午餐|晚餐} [后一餐 ▶]` 切午/晚（M1 限今天午/晚）。
  - 缺口：`gapCount(rows, currentOccasion)` 顶部 "本餐次 X 单未送"。
  - 地址前缀勾销：输入框 + 「勾销」→ 调 `PATCH /delivery/fulfillments {address: 片段}`（be 多命中）→ 200 拿回命中 ids → `Taro.showModal` 列确认 → 确认 → `PATCH /delivery/fulfillments {ids, set:{status:"done"}}` → refetch；0 命中 toast。
  - 列表（`byOccasion` 当前餐次）：每行 顾客/份数/地址 + 双轴 Tag（`lifecycleDots`：[履○/✓][付○/✓] 各色）+ 单行「标送达」（`PATCH /fulfillments {ids:[id]}`）+ 「标已付/回退」（`PATCH /orders {paymentStatus}`）。
  - draft 行淡、canceled 划线灰、不计缺口。
  - 401 → 清 token 跳登录（同 menu 页）。
  - 逻辑走 ordersLifecycle.ts，页交 e2e。
- [ ] T005 [P] 删 `apps/kith-inn-fe/src/pages/delivery/`（整目录）；删 `app.config.ts` 里 delivery page 注册。
- [ ] T006 [P] `apps/kith-inn-fe/src/components/TabBar.tsx` + `app.config.ts`：tabBar 改三 tab（今天/菜单/订单），去掉"送餐"。确认 orders 页 `active="orders"`。
- [ ] T007 清理：若 `logic/deliveryView.ts` 不再被任何页引用 → 删（knip 会报）；`services/api.ts` 的 `deliveryUrl`/`markDeliveredUrl` 仍被 orders 页用 → 保留。

**Checkpoint**: 订单 tab 双轴 + 地址勾销 + 餐次焦点通；配送 tab 消失；`pnpm --filter @cfp/kith-inn-fe test` 绿、`pnpm verify` 全绿。

## Phase 4：docs + 门禁 + PR

- [ ] T008 [P] `docs/kith-inn/PRD.md` §5.5：四 tab → 三 tab 表述（送餐并入订单，订单=全生命周期+按地址聚拢+前缀勾销+双轴图标）。
- [ ] T009 [P] `docs/kith-inn/DATA-MODEL.md`：送餐 tab 段改为"并入订单（按地址字符串排序 + 前缀批量勾销 + 双轴生命周期图标）；地址不可 geocode、不规划路线（PRD §4.2 伪需求）"。
- [ ] T010 跑 `pnpm verify`（lint/typecheck/100% 覆盖/knip/build），PR 描述记录；遵守 `AGENTS.md`（base=main 自动审、rebase merge、逐条 resolve Codex）。

## Dependencies & Execution Order

- **Phase 1 测试**: 无依赖，先红。
- **Phase 2 实现**: 依赖 1。
- **Phase 3 页重写**: 依赖 2（纯函数）。删页/TabBar 可与页重写并行准备（不同文件）。
- **Phase 4 docs/门禁**: 全完成后。

### Parallel
T001/T002 可并行（同文件不同 describe，先写在一起也行）；T005/T006/T008/T009 任意时机。

## Out of Scope（deferred）

跨日翻看（昨日/明日餐次）、地址相似度 fuzzy 排序（M1 字符串排序）、收款催收/reconciled 专门 UI（M2）、自动路线规划（永不做）、agent `mark_delivered` 工具改不动（复用 ① 修好的前缀+边界）。见 `spec.md` §假设。
