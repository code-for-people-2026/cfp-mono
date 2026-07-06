# 实施计划：agent 确认卡

**分支**: `006-kith-inn-agent-confirm-cards` | **日期**: 2026-07-07 | **规格**: [spec.md](./spec.md)

## 摘要

10 个写工具全部从"直接执行"改为"预览→确认→执行"。统一模式：execute handler 调 service 读方法算预览 → 存 pending op → 返确认卡。用户点确认 → `POST /chat/confirm-operation` → 按 opType 调 service 写方法。

## 当前实现事实（Brownfield）

- **`apps/kith-inn-be/src/agent/tools.ts`**：15 个工具（10 写 + 5 读）。写工具直接调 `services.xxx()` 执行。
- **`apps/kith-inn-be/src/agent/pendingState.ts`**：per-operator `Map<operatorId, ConfirmCustomerItem[]>`，仅用于新顾客确认。
- **`apps/kith-inn-be/src/routes/chat.ts`**：`POST /chat/confirm-customers`（新顾客确认的确定性执行端点）。
- **`packages/kith-inn-shared/src/schemas.ts`**：`cardPayloadSchema` 已含 `operation-confirm` 类型（feature 005 spec 定义、ChatCard 有基础渲染但无确认按钮）。
- **`apps/kith-inn-fe/src/components/ChatCard.tsx`**：operation-confirm 只显示 summary 文字（无按钮）。
- **`apps/kith-inn-fe/src/pages/today/index.tsx`**：`confirmCustomers` 走 confirm-customers 端点；无通用 confirm-operation。

## 宪法检查 + tier

全套 spec（跨切面 shared+be+fe、改变核心交互模式）。不改 schema/state machine/路由契约。

## 项目结构

```text
specs/006-kith-inn-agent-confirm-cards/
├── spec.md
├── plan.md          ← 本文件
├── research.md
├── data-model.md
├── contracts/
│   ├── be-confirm-api.md      ← POST /chat/confirm-operation 契约
│   └── operation-confirm-card.md  ← card data shape
├── quickstart.md
├── tasks.md
└── checklists/
    └── requirements.md

apps/kith-inn-be/src/
├── agent/
│   ├── pendingOps.ts    # 新：per-operator pending op（opType + args + summary）
│   ├── tools.ts         # 10 个写工具 execute handler 改为预览+存 pending
│   ├── services.ts      # 加 markUnpaid（W5）
│   └── run.test.ts      # mock 更新
└── routes/
    └── chat.ts          # 加 POST /chat/confirm-operation

apps/kith-inn-fe/src/
├── components/ChatCard.tsx  # operation-confirm 渲染 summary + 确认按钮
└── pages/today/index.tsx    # 确认按钮 → POST /chat/confirm-operation

packages/kith-inn-shared/src/
└── schemas.ts               # operation-confirm data shape 调整（加 opType + args）
```

## 复杂度跟踪

非平凡点：① 10 个工具统一拆 preview+execute（模式重复但量大）；② record_orders 预览要含新顾客地址输入（合并 customer-confirm）；③ mark_delivered 预览要先查出匹配订单；④ ChatCard 确认按钮要区分"当前可操作"vs"历史只读"（同 customer-confirm 卡机制）。
