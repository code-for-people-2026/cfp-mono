# 实施计划：「今天」agent 菜单工具（US-M06）

**分支**: `005-kith-inn-agent-menu-tools` | **日期**: 2026-07-05 | **规格**: [spec.md](./spec.md)

## 摘要

在既有 `AGENT_TOOLS` 模式上加 4 个菜单工具（generate/swap/publish/get），复用 feature 003 的 be 菜单端点。一并补 PRD §5.5 缺口：重操作确认卡（operation-confirm card + pendingOp + 确定性执行端点）、工具参数 zod safeParse、system prompt 注入今天日期。

## 技术上下文

TS 5.9 / Node 20 / Hono。be-only（不动 FE 部分由 separate task 跟 / FE 改动一并做）；shared 只加一个 cardPayload 变体。复用既有 `AgentServices` DI 模式、`pendingState` 暂存模式、`AGENT_TOOLS` execute handler 模式。

## 当前实现事实（Brownfield）

- **`apps/kith-inn-be/src/agent/tools.ts`**：8 个工具（record_orders/confirm_order/cancel_order/mark_paid/mark_delivered/get_today_summary/get_orders/get_delivery），`AgentServices` 接口 + `AGENT_TOOLS[]` + execute handler。
- **`apps/kith-inn-be/src/agent/services.ts`**：`createCmsAgentServices` 生产实现（调 be 路由 via fetch / cms internal via cmsBase）。
- **`apps/kith-inn-be/src/agent/run.ts`**：`AGENT_SYSTEM_PROMPT` 常量（无动态日期注入）；`runAgent` 浅环 maxSteps=7 + `fallbackToday` 兜底。
- **`apps/kith-inn-be/src/agent/pendingState.ts`**：per-operator `Map<operatorId, ConfirmCustomerItem[]>`，in-process。
- **`apps/kith-inn-be/src/routes/chat.ts`**：`POST /chat`（agent run）+ `POST /chat/confirm-customers`（确定性执行新顾客确认）。
- **`apps/kith-inn-be/src/routes/menu.ts`**：`GET /plans`、`POST /generate`、`POST /plans/:id/swap`、`POST /plans/:id/publish`——全 sellerAuth。
- **`apps/kith-inn-fe/src/components/ChatCard.tsx`**：处理 customer-confirm / orders / delivery card；未知 card type 走 delivery fallback（需加 operation-confirm 渲染——**FE task**，不在本 feature 的 be-only 范围内，单开 task 跟）。
- **shared `cardPayloadSchema`**：discriminatedUnion type: customer-confirm / orders / delivery。

## 宪法检查 + tier

轻量 spec（spec + plan + tasks）。be-only + shared 加一个 card 变体 + FE 加一个 card 渲染（小改 ChatCard + confirm-operation POST）。不改 schema/state machine/路由契约（菜单端点全复用）。

## 项目结构

```text
specs/005-kith-inn-agent-menu-tools/
├── spec.md
├── plan.md          ← 本文件
└── tasks.md

packages/kith-inn-shared/src/schemas.ts   # + operation-confirm card 变体
apps/kith-inn-be/src/
├── agent/
│   ├── tools.ts       # + 4 menu 工具；重操作→确认卡；zod safeParse
│   ├── services.ts    # + generateMenu/swapDish/publishMenu/getMenu
│   ├── pendingOps.ts  # 新：per-operator pending operation（同 pendingState 模式）
│   └── run.ts         # system prompt 加菜单 + 注入今天日期
└── routes/chat.ts     # + POST /chat/confirm-operation

apps/kith-inn-fe/src/components/ChatCard.tsx  # + operation-confirm 渲染 + POST
```

## 复杂度跟踪

非平凡点：① 确认卡的 pendingOp 机制（per-operator 暂存 toolName+args → 确定性执行）；② system prompt 动态注入今天日期（不再纯常量）；③ swap_dish 的 replacement 名称——swap route 返 `{plan, warning}` 不含 replacement dish → 工具层从 plan.dishes diff 出新菜（或 route 加返 replacement）。
