# 实施计划：kith-inn 合并配送进订单

**分支**: `004-kith-inn-merge-delivery-into-orders` | **日期**: 2026-07-05 | **规格**: [spec.md](./spec.md)

## 摘要

砍配送 tab，订单 tab 升级为全生命周期视图：默认聚焦最近未完成餐次（午/晚可滑）、每单双轴状态图标（履约/付款，独立染色）、按地址排序、地址前缀批量勾销（复用 ① 修好的前缀+边界逻辑）、当前餐次缺口。**be 零改动**（orders/delivery/fulfillments 端点全复用，FE join）。TabBar 4→3。同 PR 更新 PRD §5.5 + DATA-MODEL。

## 技术上下文

TS 5.9 / React 18 / Taro 4.2 / NutUI React（现仅用 Button/Tag/Progress）。**be 零改动**。Asia/Shanghai 餐次基准。FE 100% 覆盖靠逻辑抽离（`logic/ordersLifecycle.ts` 纯函数单测，页交 e2e）。

## 当前实现事实（Brownfield）

- **`apps/kith-inn-fe/src/pages/orders/index.tsx`**：订单台账，按 today；每行 status dot + 顾客 + ¥ + 「确认」(draft→confirm) / 「标已付」(confirmed unpaid→paid)；调 `GET /orders?date=` + `act(url,method,body)`。**无履约状态、无地址排序、无餐次切换**。
- **`apps/kith-inn-fe/src/pages/delivery/index.tsx`**：送餐 tab，`GET /delivery?date=` → 按地址分组（`packingSort`）+ Progress + 「送达」（`PATCH /fulfillments {ids}` or address）。**整个 tab 本 feature 删除**。
- **`apps/kith-inn-fe/src/components/TabBar.tsx` + `app.config.ts`**：4 tab（今天/菜单/订单/送餐）。
- **`apps/kith-inn-fe/src/logic/ordersView.ts`**：`orderStatusDot`/`customerName`/`yuan`/`STATUS_DOT_CLASS`（单轴 status dot，本 feature 升级为双轴）。
- **`apps/kith-inn-fe/src/logic/deliveryView.ts`**：delivery 视图逻辑（本 feature 部分复用/部分随页删）。
- **be `routes/orders.ts`**：`GET /orders?date=`（depth populate customer）、`POST /`、`/:id/confirm`、`/:id/cancel`、`PATCH /:id`（payment/date/note）。**全复用**。
- **be `routes/delivery.ts`**：`GET /delivery?date=&occasion=`（fulfillments，populate order）、`PATCH /fulfillments`（by ids / by address）。**全复用**。
- **be `domain/delivery/derivations.ts`**：`fulfillmentsMatchingAddress`（① 已修：前缀+楼栋边界）、`packingSort`、`gapReport`。FE 前端 join 用 GET /delivery；前缀勾销经 be `PATCH /fulfillments {address}`（be 内部调 `fulfillmentsMatchingAddress`）。
- **shared**：`Order`（status/paymentStatus/occasion/...）、`Fulfillment`（order/serviceDate/occasion/status）。order 与 fulfillment 经 `fulfillment.order` 关联（无 order.fulfillments 反向字段 → FE join）。

## 宪法检查 + tier

I-VI 通过。**「何时开 spec 目录」三档**：本 feature 跨 FE（重）+ be（零/微）+ 改 IA（PRD §5.5 4→3 tab），但**不动数据模型/状态机、不动 be 契约、单 PR** → **轻量 spec**（spec + plan + tasks，跳 research/contracts/checklists/quickstart/data-model）。改长期产品行为（tab 结构）→ 同 PR 更新 `docs/kith-inn/PRD.md` §5.5 + `DATA-MODEL.md`（治理铁律）。

## 项目结构

```text
specs/004-kith-inn-merge-delivery-into-orders/
├── spec.md
├── plan.md
└── tasks.md

apps/kith-inn-fe/src/
├── logic/
│   ├── ordersLifecycle.ts   # 新：joinOrdersFulfillments / lifecycleDots / mealFocus / sortByAddress（纯函数）
│   └── ordersLifecycle.test.ts
├── pages/
│   ├── orders/index.tsx     # 重写：餐次焦点+滑动 / 双轴图标 / 地址排序 / 前缀勾销 / 缺口 / 标已付
│   └── delivery/            # 删（整目录）
├── components/TabBar.tsx    # 3 tab
└── app.config.ts            # tabBar 3 项

docs/kith-inn/
├── PRD.md                   # §5.5：4 tab → 3 tab（送餐并入订单）
└── DATA-MODEL.md            # 送餐 tab 说明改为"并入订单（按地址排序+前缀勾销+双轴生命周期）"
```

**结构决策**：be 零改动；纯逻辑（join/双轴/餐次焦点/排序）抽进 `logic/ordersLifecycle.ts` 单测；订单页交 e2e。

## 复杂度跟踪

无 constitution violations。非平凡点：① 双轴图标的视觉语言（履/付 独立 Tag + 色映射，4 组合可辨）；② mealFocus 默认（最近未完成餐次的确定性规则）；③ FE join orders+fulfillments（按 order.id 匹配，fulfillment 可能缺失——draft 单无 fulfillment）。
