---
description: "kith-inn agent 确认卡（所有写操作预览→确认→执行）实现任务"
---

# Tasks：agent 确认卡（#126）

**输入**: `specs/006-kith-inn-agent-confirm-cards/` 下的 spec/plan/research/contracts/quickstart

**测试策略**: be（pendingOps 纯函数 + 工具 handler mock + confirm-operation 端点）；fe（ChatCard 渲染 + 确认按钮逻辑）。cms 不动。

## Format：`[ID] [P?] [Story] Description`

## Phase 1：基础设施（pendingOps + confirm-operation 端点 + card shape）

- [ ] T001 [P] 在 `apps/kith-inn-be/src/agent/pendingOps.ts`（新文件）实现 per-operator pending op 存储（同 pendingState 模式）：`setPendingOp(operatorId, { opType, args, summary })` / `getPendingOp(operatorId)` / `clearPendingOp(operatorId)`。纯函数 + 单测。
- [ ] T002 [P] 在 `packages/kith-inn-shared/src/schemas.ts` 调整 `operation-confirm` card 的 data shape：`{ opType: string; summary: string; args: Record<string, unknown> }`（当前已有，确认 shape 对齐）。
- [ ] T003 在 `apps/kith-inn-be/src/routes/chat.ts` 加 `POST /chat/confirm-operation`：取 pending op → 按 `opType` switch 分发到对应 service 写方法（用 pending args）→ 清 pending → 返回结果文本。同 `confirm-customers` 模式（确定性、绕开 LLM）。
- [ ] T004 在 `chat.test.ts` 加 confirm-operation 用例：存 pending → POST confirm → 验证 service 被调 + pending 被清；无 pending → 404。

## Phase 2：写工具改预览模式（10 个）

**模式**：每个 execute handler 改为 (a) 调 service 读方法算预览 (b) 存 pending op (c) 返确认卡。不调 service 写方法。

- [ ] T005 `record_orders` 改为预览：解析接龙 → 列出将建的订单（顾客/份数/餐次/新客标记）→ 存 pending `{ opType: "record_orders", args: { items }, summary }` → 返卡。新顾客在卡片里有地址输入。
- [ ] T006 `confirm_order` 改为预览：读 order → "将确认 #X（顾客 份数 餐次）：开餐+建履约" → 存 pending → 返卡。
- [ ] T007 `cancel_order` 改为预览：读 order → "将取消 #X（顾客）：作废" → 存 pending → 返卡。
- [ ] T008 `mark_paid` 改为预览：读 order → "将标记 #X 已付款" → 存 pending → 返卡。
- [ ] T009 `mark_delivered` 改为预览：查匹配 fulfillments → 列出匹配订单 → "将标记 N 单送达" → 存 pending → 返卡。0 匹配直接文字提示。
- [ ] T010 `generate_menu` 改为预览：算出将排的菜（调 generateForTargets 不落库）→ "将为 X月X日 午餐排菜：菜1、菜2…" → 存 pending（含 targets + force）→ 返卡。pool-too-small 直接提示。
- [ ] T011 `swap_dish` 改为预览：算出替代菜（调 swapDish/swapDishSpecified 不落库）→ "将把 X(#id) 换成 Y(#id)" → 存 pending → 返卡。
- [ ] T012 `publish_menu` 改为预览：读 plan + 算接龙文案 → "将发布 X月X日 午餐 + 文案如下：…" → 存 pending → 返卡。
- [ ] T013 `add_dish` 改为预览：→ "将添加：蒜蓉粉丝虾（主料虾/荤）" → 存 pending → 返卡。
- [ ] T014 `mark_unpaid` 新工具（W5 低优先）：→ "将回退 #X 为未付款" → 存 pending → 返卡。AgentServices 加 `markUnpaid` 方法。

## Phase 3：confirm-operation 端点分发逻辑

- [ ] T015 在 `POST /chat/confirm-operation` 的 opType switch 里接全 10 个 opType：record_orders → recordOrders、confirm_order → confirmOrder、cancel_order → cancelOrder、mark_paid → markPaid、mark_unpaid → markUnpaid、mark_delivered → markDelivered、generate_menu → generateMenu、swap_dish → swapDish、publish_menu → publishMenu、add_dish → createOffering。
- [ ] T016 各 opType 的执行结果文本（"记好了 3 单草稿"/"已确认 #45"/"已取消"/"已标记付款"/"已标记送达"/"排好了"/"换成了 Y"/"已发布+文案复制"/"加好了"/"已回退未付"）。

## Phase 4：FE 确认卡渲染 + 确认按钮

- [ ] T017 在 `ChatCard.tsx` 的 operation-confirm 渲染加「确认」按钮（active 状态）+ 「已确认 ✓」（confirmed 状态）+「已过期」（stale 状态）。同 customer-confirm 卡的三态机制。
- [ ] T018 在 `today/index.tsx` 加 `confirmOperation(i)` 处理函数：POST /chat/confirm-operation → 成功后更新 confirmed set + 刷新消息。
- [ ] T019 确认卡在历史消息中恢复时标 stale（fromHistory → 只读）。

## Phase 5：system prompt 更新

- [ ] T020 system prompt 更新：所有写操作都会返回确认卡——引导桃子点卡片里的「确认」按钮（不要在对话里打字确认）。读操作直接回答。

## Phase 6：测试 + 门禁 + PR

- [ ] T021 tools.test.ts：每个写工具验证 (a) 返回确认卡 (b) 不调 service 写方法 (c) pending op 被存。
- [ ] T022 confirm-operation 端点测试：10 个 opType 各一条（存 pending → confirm → service 被调 → pending 清）。
- [ ] T023 `pnpm verify` 全绿 + PR + Codex review。

## Dependencies

- Phase 1（基础设施）无依赖。
- Phase 2（工具改预览）依赖 Phase 1（pendingOps）。
- Phase 3（端点分发）依赖 Phase 1+2。
- Phase 4（FE）依赖 Phase 1+3。
- Phase 5+6 最后。

## Out of Scope

mark_unpaid 完整实现（W5 可后做）；顾客端分享卡片（M3/V1）；订单日视图/周视图（另开 feature）。
