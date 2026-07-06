# 功能规格：agent 确认卡——所有写操作预览→确认→执行

**功能分支**: `006-kith-inn-agent-confirm-cards`

**创建日期**: 2026-07-07

**状态**: 草稿（设计评审中，未开始实现）

**输入**: PRD §5.5（数据操作类先确认卡再写库）、issue #126。

## 项目作用域

**项目**: kith-inn

**允许触碰**:
- `apps/kith-inn-be/src/agent/**`（tools.ts 拆 preview+execute、新建 pendingOps.ts、services.ts 加 mark_unpaid）
- `apps/kith-inn-be/src/routes/chat.ts`（加 POST /chat/confirm-operation）
- `apps/kith-inn-fe/src/components/ChatCard.tsx`（渲染 operation-confirm + 确认按钮）
- `apps/kith-inn-fe/src/pages/today/index.tsx`（确认按钮 → POST confirm-operation）
- `packages/kith-inn-shared/src/schemas.ts`（operation-confirm card 已定义，可能需调 data shape）

**不触碰**: 菜单 tab / 订单 tab / 菜品池 tab（它们是确定性 UI、不走 agent）；collection schema。

## Clarifications

- **Q: 每个写工具怎么拆？** → A: 统一模式——execute handler 先调 service 的**读方法**算出预览（不落库）→ 存 pending op → 返确认卡。用户点确认 → `POST /chat/confirm-operation` → 按 opType 调 service 的**写方法**执行。
- **Q: 预览和执行之间状态变了怎么办？** → A: M1 单操作者（桃子），不处理并发。执行时如果发现状态已变（如订单已被确认），service 的现有错误处理覆盖（返 error，agent 转述）。
- **Q: record_orders 的接龙确认卡和新顾客确认卡合并？** → A: 是。一张卡同时展示将建的订单（含新顾客标"待建"+ 地址输入），点一次确认全建。
- **Q: mark_delivered 多匹配怎么确认？** → A: 卡片列出匹配的订单，点确认全标送达。如果 0 匹配直接文字提示。
- **Q: published plan 被 swap/generate 怎么处理？** → A: 工具仍先算预览（force=true），卡片额外标注"已发给顾客"。
- **Q: 读操作也走这个机制吗？** → A: 不。读操作（5 个）直接执行、展示结果，不确认。

## 用户场景

### US1 — 贴接龙 → 看到将建的订单 → 确认 → 落库
桃子粘接龙 → agent 解析 → 确认卡列出 3 单（王燕萍 2份午餐、李叔 1份晚餐、大龙猫 1份午餐+地址输入）→ 桃子填地址 → 点「确认」→ 落 draft + 建新顾客 → "记好了，3 单草稿"。

### US2 — 生成菜单 → 确认 → 排菜
桃子说"排明天午餐" → agent 确认卡"将为 7/8 午餐排菜（约 5 道）" → 点「确认」→ 排菜落 draft。

### US3 — 换菜 → 确认 → 换
桃子说"把牛腩换掉" → agent 算出替代菜 → 确认卡"将把 牛腩(#12) 换成 香菇滑鸡(#19)" → 点「确认」→ 换好。

### US4 — 发布 → 确认 → 复制文案
桃子说"发出去" → agent 确认卡"将发布 7/8 午餐 + 接龙文案如下：…" → 点「确认」→ published + 文案复制到剪贴板。

### US5 — 标送达 → 确认 → 批量标
桃子说"3a 送了" → agent 查出 2 单匹配 → 确认卡"将标记 3a 送达（王燕萍、李叔）" → 点「确认」→ 标 done。

## 需求

- **FR-001**: `apps/kith-inn-be/src/agent/pendingOps.ts`（新文件）：per-operator（同 pendingState 模式）存 `{ opType, args, summary }`。setPendingOp / getPendingOp / clearPendingOp。
- **FR-002**: 每个**写工具**（10 个）的 execute handler 改为：调 service 读方法算预览 → 存 pending op → 返 `{ text: summary, card: { type: "operation-confirm", data: { opType, summary, args } } }`。不调 service 写方法。
- **FR-003**: `apps/kith-inn-be/src/routes/chat.ts` 加 `POST /chat/confirm-operation`：取 pending op → 按 opType 调对应 service 写方法 → 清 pending → 返回结果。
- **FR-004**: AgentServices 加 `markUnpaid`（W5，低优先）。
- **FR-005**: FE `ChatCard.tsx` 渲染 operation-confirm：显示 summary + 「确认」按钮 → POST /chat/confirm-operation。
- **FR-006**: 读操作（5 个）不变——直接执行、展示结果。
- **FR-007**: 确认卡在聊天历史中恢复时标记为"已过期"（同 customer-confirm 卡机制——只当前会话最新一张可操作）。
- **FR-008**: 执行结果与卡片预览一致（pending op 存的就是执行参数，执行时用同一套参数）。

## 成功标准

- **SC-001**: 所有 10 个写操作都先出确认卡、用户点确认才落库。
- **SC-002**: 读操作不受影响（直接展示）。
- **SC-003**: 确认卡展示的变更内容与执行结果一致。

## 假设 / deferred

- M1 单操作者，预览→执行之间不处理并发。
- mark_unpaid（W5）低优先，可后做。
- operation-confirm 卡在历史中恢复时只读（FR-007）。
- 不改变 service 层的方法签名（service 仍是"直接执行"；拆 preview/execute 在 tool handler 层）。
