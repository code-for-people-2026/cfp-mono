# 实施计划：订单页逐行勾选批量勾销 + 大小写不敏感 + 删语音勾销

**分支**: `007-kith-inn-orders-bulk-checkout` | **日期**: 2026-07-07 | **规格**: [spec.md](./spec.md)

## 摘要

三块活：① 地址匹配大小写不敏感（shared canonical + FE 内联副本，修「输 3a 匹不到 3A」bug）；② 订单页 filter-bulk 改 select-bulk（逐行勾选 + 顶部「批量送达」条，复用既有 `PATCH /delivery/fulfillments {ids}`）；③ 删 agent `mark_delivered` 语音工具整链 + `delivery.ts` 死的 `{address}` 模式。FE 交互改造为主，shared 1 行修、be/agent 为删除清理。

## 当前实现事实（Brownfield）

- **`apps/kith-inn-fe/src/pages/orders/index.tsx`**（feature 004）：meal toggle（午餐/晚餐）+ 地址片段输入 + 「勾销」按钮（`batchDeliver` :89-100，filter-bulk：`previewAddressMatch` → `Taro.showModal` 列命中 → 确认 → `{ids}` PATCH）+ 每行 lifecycle dots（送○/付○）+ per-row「确认/标已付/回退未付/标送达」按钮（:160-173）。`act()` :73-87 通用写 helper（POST/PATCH + reload）。
- **`apps/kith-inn-fe/src/logic/ordersLifecycle.ts`**：内联 `addressMatches`（:6-14，**大小写敏感** `startsWith`，:3-5 注释要求与 shared keep-in-sync）、`previewAddressMatch`、`lifecycleDots`、`byOccasion`、`joinOrdersFulfillments`、`sortByAddress`、`mealFocus`、`gapCount`。纯函数、有单测。
- **`packages/kith-inn-shared/src/addressMatch.ts`**：canonical `addressMatches`（:9-16，**大小写敏感** `startsWith`）。注释 :2-8 说明「3a = 楼栋3A」「前缀非 substring」「纯数字按楼栋边界」——设计意图对，但漏了大小写归一化。be `fulfillmentsMatchingAddress`（derivations.ts）也走它。
- **`apps/kith-inn-be/src/routes/delivery.ts`**：`PATCH /fulfillments`（:39-63）两 body——`{ids}`（:45-49，按钮用，精确无串地址）/`{address}`（:51-58，片段，agent/语音用）。注释 :19-23 明确 `{ids}` 是为「避免 substring 跨地址误伤」、`{address}` 取代 agent tool-call。
- **agent `mark_delivered` 链**：`tools.ts:175-182`（工具 def+execute）+ `:27`（`AgentServices.markDelivered` 类型）+ `:40`（`previewDelivered` 类型）→ `services.ts:206`（`markDelivered`，空白地址守卫 + `fulfillmentsMatchingAddress` + `setFulfillmentsByIds`）+ `:413`（`previewDelivered`）→ `chat.ts:206-209`（dispatch case）。`run.ts:20` prompt 能力清单列 `mark_delivered（地址）`、:24 纪律列举含「标送达」。注释引用：`delivery.ts:22`、`derivations.ts:58`。
- **FE 调用方（grep 已确认）**：`markDeliveredUrl()` 三处全用 `{ids}`——`today/index.tsx:193`（`data:{ids}`）、`orders/index.tsx:99`（批量）、`:171`（per-row）。**无 FE 用 `{address}` 模式**。
- **FE 无 Checkbox 组件**：NutUI 在本项目只用 Button/Tag，grep 无 Checkbox → 自定义 tap-toggle（复用 `送○/付○` Tag 样式），不引新依赖。
- **`apps/kith-inn-fe/src/services/api.ts:56`**：`markDeliveredUrl()` 已存在（`PATCH /delivery/fulfillments`）。

## 宪法检查 + tier

跨 shared + fe + be + agent 四层 → 按宪法「跨切面」硬阈值本该全套 spec。但实质是 FE 交互模型改造为主 + shared 1 行 bug 修 + be/agent 删除清理，**无新数据模型 / 无新 API 契约（只删一个死分支模式）/ 无状态机 / 无租户隔离判断**。按宪法「兜底·拿不准倾向开——但用轻量档」走 **轻量 spec**（spec.md + plan.md + tasks.md，跳过 research/contracts/data-model/quickstart/checklists）。

## 项目结构

```text
specs/007-kith-inn-orders-bulk-checkout/
├── spec.md            ← 本功能规格
├── plan.md            ← 本文件
└── tasks.md           ← 任务清单

packages/kith-inn-shared/src/
└── addressMatch.ts            # addressMatches 字母分支 toLowerCase（+ 测试）

apps/kith-inn-fe/src/
├── logic/ordersLifecycle.ts   # 内联副本同步 case 归一化 + 新增 selection 纯函数（+ 测试）
└── pages/orders/index.tsx      # filter-bulk → select-bulk：selection state + 勾选 + 批量条

apps/kith-inn-be/src/
├── routes/delivery.ts          # 删 {address} 模式 + 注释
├── routes/chat.ts              # 删 mark_delivered dispatch case
├── domain/delivery/derivations.ts  # 注释更新
└── agent/
    ├── tools.ts                # 删 mark_delivered 工具 + 类型
    ├── services.ts             # 删 markDelivered + previewDelivered
    └── run.ts                  # prompt 去 mark_delivered / 标送达
```

## 复杂度跟踪

- **① 大小写归一化两处同步**：shared canonical + FE 内联副本，别漏副本（keep-in-sync 注释提醒）。纯数字分支（楼栋边界）不能被 lowercase 影响——其实不影响（数字无大小写），但测试要锁。
- **② selection state 与过滤/餐次切换的交互**：切餐次 tab 或改过滤输入时清空 `selected`，避免选中了一个集合、提交时列表已是另一个集合（跨集误操作）。selectable 行限定为「当前餐次 + 未取消 + 待送」（`lifecycleDots` 已给 delivery=pending）。
- **③ 删 agent mark_delivered 整链别留死引用**：6 个源文件 + 2 个测试文件，逐个清；删完 grep `mark_delivered|markDelivered|previewDelivered` 应只剩 delivery.ts 注释（如保留历史说明）或全清。
- **④ 删 `delivery.ts` `{address}` 模式前再 grep**：确认零 FE 调用（已确认 today/orders 全 `{ids}`），删 :51-58 分支 + 收紧 :19-23 注释。
- **⑤ 拆 PR**：T001-T002（大小写）可独立先发一个小 PR（让「搜 3a 匹 3A」立刻可用，桃子不等主体）；主体（select-bulk + 删语音）作第二个 PR。或单 PR，看 #131 节奏。
