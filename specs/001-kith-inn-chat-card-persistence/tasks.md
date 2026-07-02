---
description: "kith-inn 聊天卡片持久化实现任务"
---

# Tasks：kith-inn 聊天卡片持久化

**输入**: `specs/001-kith-inn-chat-card-persistence/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**测试策略**: 本功能改动跨 shared schema、Payload/CMS、backend route 和 frontend 渲染；每个用户故事都包含最小自动化测试任务。实现前先写对应失败测试。

**组织方式**: 任务按用户故事分组；US1 是 MVP，完成后应能独立验证“带 card 的 assistant 历史消息重开后可恢复”。

## Format：`[ID] [P?] [Story] Description`

- **[P]**: 可并行，前提是文件不同且不依赖未完成任务。
- **[Story]**: 只用于用户故事阶段，例如 `[US1]`。
- 每个任务都写明精确文件路径。

## Phase 1：准备与基线测试

**目的**: 先固定当前缺口，避免实现时只改一端。

- [x] T001 [P] 在 `packages/kith-inn-shared/src/schemas.test.ts` 增加 chat message 可携带符合 `CardPayload` contract 的 `card`、user message 不携带 card、不符合 contract 的 card 被拒绝的测试，覆盖 FR-001、FR-006、FR-008。
- [x] T002 [P] 在 `apps/kith-inn-be/src/lib/cms/chat.test.ts` 增加 `createChatMessage()` 会把 optional `card` 序列化进 POST body、`listChatMessages()` 能保留 CMS 返回 card 的测试，覆盖 FR-001、FR-002。
- [x] T003 在 `apps/kith-inn-be/src/routes/chat.test.ts` 增加 `POST /chat` 持久化 assistant `card` 且 user message 不带 card 的测试，覆盖 FR-001、FR-006。
- [x] T004 在 `apps/kith-inn-be/src/routes/chat.test.ts` 增加 `GET /chat` 返回符合 `CardPayload` contract 的历史 card、遇到不符合 contract 的历史 card 时返回 `cardUnavailable: true` 的测试，覆盖 FR-002、FR-008。
- [x] T005 [P] 在 `apps/kith-inn-fe/src/logic/chatCards.test.ts` 新增前端纯逻辑测试，覆盖历史/过期 `customer-confirm` 卡只读、最后一张 active 确认卡可操作、文案为“全部建档并记单”，覆盖 FR-003、FR-009。

## Phase 2：基础数据与契约

**目的**: 打通所有用户故事共用的 card 数据承载能力；完成前不要开始 UI 集成。

- [x] T006 在 `packages/kith-inn-shared/src/schemas.ts` 给 `chatMessageSchema` 增加 optional `card: cardPayloadSchema`，并确保 `role = "user"` 时不接受 generated card，覆盖 FR-001、FR-006。
- [x] T007 在 `packages/kith-inn-shared/src/types.ts` 确认 `ChatMessage` 由更新后的 `chatMessageSchema` 推导出 optional `card`，不新增平行手写类型，覆盖 DATA-MODEL `Chat Message.card`。
- [x] T008 在 `packages/kith-inn-payload/src/payload/collections/ChatMessages.ts` 增加 nullable JSON `card` 字段，并限制它只作为可见 assistant card snapshot 使用，覆盖 DATA-MODEL `card`。
- [x] T009 创建 `apps/cms/src/payload/migrations/20260703_000000_kith_inn_chat_message_card.ts` 和 `apps/cms/src/payload/migrations/20260703_000000_kith_inn_chat_message_card.json`，给 `cms.chat_messages` 添加 nullable `card jsonb` column，现有 rows 保持 `null`，覆盖 DATA-MODEL migration notes。
- [x] T010 在 `apps/cms/src/payload/migrations/index.ts` 注册 `20260703_000000_kith_inn_chat_message_card` migration，确保 Payload migration runner 能发现它。
- [x] T011 在 `apps/cms/src/app/api/internal/chat_messages/route.ts` 的 POST body 处理中接受 optional `card`，用共享 `cardPayloadSchema` 校验后再传给 Payload；不符合 contract 的 card 返回 400，user message 不保存 card，覆盖 FR-001、FR-006、CMS contract。

**Checkpoint**: shared schema、Payload collection、CMS internal API 都能承载 optional card；旧消息不需要 backfill。

## Phase 3：User Story 1 - 重开后恢复 assistant 卡片（P1，MVP）

**目标**: assistant 带 card 回复后，card 随 assistant chat message 持久化；重开 Today page 后，历史消息内恢复同一张 card，且新顾客确认历史卡只读。

**独立测试**: 产生一条带 orders 或 delivery card 的 assistant 回复，刷新 Today page；不发送新消息、不调用 LLM，也能在历史位置看到同一张 card。恢复的 `customer-confirm` card 显示历史/过期提示，不提供可执行动作。

### Tests for User Story 1

- [x] T012 [US1] 运行并确认 `apps/kith-inn-be/src/lib/cms/chat.test.ts`、`apps/kith-inn-be/src/routes/chat.test.ts`、`apps/kith-inn-fe/src/logic/chatCards.test.ts` 中 US1 相关测试在实现前失败，测试目标覆盖 FR-001、FR-002、FR-003、FR-005、FR-008、FR-009。

### Implementation for User Story 1

- [x] T013 [US1] 在 `apps/kith-inn-be/src/lib/cms/chat.ts` 扩展 `createChatMessage()` 输入类型为 `{ content; role; card? }`，保持 `listChatMessages()` 返回 `ChatMessage[]`，覆盖 backend/CMS contract。
- [x] T014 [US1] 在 `apps/kith-inn-be/src/routes/chat.ts` 的 `POST /chat` 中把 `runAgent()` 返回的 assistant `card` 和 assistant message 一起传给 `createChatMessage()`，user message 仍不带 card，覆盖 FR-001、FR-006。
- [x] T015 [US1] 在 `apps/kith-inn-be/src/routes/chat.ts` 的 `GET /chat` projection 中用 `cardPayloadSchema.safeParse()` 返回符合 contract 的 `card`；不符合 contract 的历史 card 不透传原始 JSON，改返回 `cardUnavailable: true` 且不让 history load 失败，覆盖 FR-002、FR-008。
- [x] T016 [US1] 在 `apps/kith-inn-fe/src/logic/chatCards.ts` 新增最小纯函数，判断每条消息的 `customer-confirm` action state：历史加载消息只读；当前会话只有最后一张未 acted 的 `customer-confirm` 卡 active；其他显示 stale 提示，覆盖 FR-009。
- [x] T017 [US1] 在 `apps/kith-inn-fe/src/components/ChatCard.tsx` 把按钮文案从「都建」改为“全部建档并记单”，并支持只读/过期状态文案“这张确认卡已过期，请重新识别接龙生成新的确认卡”，覆盖 FR-003、FR-009。
- [x] T018 [US1] 在 `apps/kith-inn-fe/src/pages/today/index.tsx` 标记 `GET /chat` 恢复的消息为历史消息，调用 `apps/kith-inn-fe/src/logic/chatCards.ts` 决定 `ChatCard` 是否可操作；`POST /chat` 当轮返回的最新 `customer-confirm` 卡仍可操作，覆盖 FR-003、FR-009。
- [x] T019 [US1] 在 `apps/kith-inn-fe/src/pages/today/index.tsx` 保持 orders/delivery 历史 card 渲染路径不变，不因 `customer-confirm` 只读逻辑影响 orders 的确认/标已付和 delivery 的送达按钮，覆盖 FR-003。

**Checkpoint**: US1 可以单独演示：历史 assistant card 恢复；恢复的 customer-confirm 卡不误导用户继续执行过期动作。

## Phase 4：User Story 2 - 保持普通聊天历史（P2）

**目标**: 纯文本消息、带 card 消息、旧格式无 card 消息继续按原时间顺序混排展示。

**独立测试**: 准备混合历史记录：user 文本、assistant 文本、assistant+card、旧格式无 card；加载 Today page 后顺序和内容保持从旧到新。

### Tests for User Story 2

- [x] T020 [US2] 在 `apps/kith-inn-be/src/routes/chat.test.ts` 增加混合历史测试：`GET /chat` 返回 user message、assistant text-only message、assistant card message 时都按 CMS 返回 projection 保持可渲染 shape，覆盖 FR-004、FR-007。
- [x] T021 [P] [US2] 在 `apps/kith-inn-fe/src/logic/chatCards.test.ts` 增加 text-only message 和 missing-card message 不产生 action state、不改变消息顺序的测试，覆盖 FR-004、FR-007。

### Implementation for User Story 2

- [x] T022 [US2] 在 `apps/kith-inn-be/src/routes/chat.ts` 保持 `GET /chat` 对无 card 消息的 response shape 不变，只在符合 `CardPayload` contract 的 card 存在时附加 `card`，覆盖 FR-004、FR-007。
- [x] T023 [US2] 在 `apps/kith-inn-fe/src/pages/today/index.tsx` 继续对 `GET /chat` 结果执行 newest-first 到 oldest-first 的 reverse，不因为新增历史标记或 card 字段改变消息顺序，覆盖 FR-004。

**Checkpoint**: US1 和 US2 都可独立工作；旧文本历史没有用户可见退化。

## Phase 5：User Story 3 - 只持久化用户可见的对话产物（P3）

**目标**: 历史只保存和恢复用户看见过的 assistant text 和 visible card snapshot，不保存 raw tool calls、system prompt 或 LLM trace。

**独立测试**: 模拟一次带 tool card 的 agent reply；持久化的 assistant message 只有 `content` 和符合 `CardPayload` contract 的 `card`，没有工具参数、系统提示词或 raw LLM 消息。

### Tests for User Story 3

- [x] T024 [US3] 在 `apps/kith-inn-be/src/routes/chat.test.ts` 增加断言：`POST /chat` 持久化 assistant message 时只包含 `{ content, role, card? }`，不包含 history、services、tool calls 或 raw LLM trace，覆盖 FR-006。
- [x] T025 [P] [US3] 在 `apps/kith-inn-be/src/lib/cms/chat.test.ts` 增加 `createChatMessage()` 只序列化允许字段 `{ content, role, card? }` 的测试，覆盖 FR-006。

### Implementation for User Story 3

- [x] T026 [US3] 在 `apps/kith-inn-be/src/lib/cms/chat.ts` 保持 `createChatMessage()` 入参白名单为 `{ content, role, card? }`，不要接受或透传 raw tool calls、system prompts、LLM traces，覆盖 FR-006。
- [x] T027 [US3] 在 `apps/cms/src/app/api/internal/chat_messages/route.ts` 保持 POST data 白名单为 `{ content, role, operator, seller, card? }`，忽略或拒绝其他内部 trace 字段，覆盖 FR-006。

**Checkpoint**: 历史消息恢复不会变成调试日志。

## Phase 6：Polish & Cross-Cutting

**目的**: 收尾文案、注释、验证和文档同步。

- [x] T028 [P] 在 `apps/kith-inn-be/src/agent/tools.ts`、`apps/kith-inn-be/src/agent/pendingState.ts`、`apps/kith-inn-fe/src/pages/today/index.tsx`、`apps/kith-inn-fe/src/components/ChatCard.tsx` 更新注释和用户可见文案，把「都建」统一替换为“全部建档并记单”或“新顾客确认动作”。
- [x] T029 [P] 更新 `specs/001-kith-inn-chat-card-persistence/quickstart.md` 的自动化检查结果备注，确认实际覆盖的 package tests 与手动冒烟步骤一致。
- [x] T030 按 `specs/001-kith-inn-chat-card-persistence/quickstart.md` 运行窄检查：`pnpm --filter @cfp/kith-inn-shared test`、`pnpm --filter @cfp/kith-inn-payload test`、`pnpm --filter @cfp/kith-inn-be test`、`pnpm --filter @cfp/kith-inn-fe test`。
- [x] T031 运行仓库质量门禁 `pnpm verify`，并在 PR 描述中记录结果，遵守 `AGENTS.md` 的 PR/review 规则。

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 准备与基线测试**: 无依赖，先写失败测试。
- **Phase 2 基础数据与契约**: 依赖 Phase 1 测试任务明确失败；完成后才开始用户故事实现。
- **Phase 3 US1**: 依赖 Phase 2，是 MVP。
- **Phase 4 US2**: 依赖 Phase 2；可在 US1 后顺序做，也可和 US1 后端 projection 任务并行协调。
- **Phase 5 US3**: 依赖 Phase 2；主要收紧字段白名单，可和 US2 并行但要避免同时改 `apps/kith-inn-be/src/routes/chat.ts`。
- **Phase 6 Polish**: 依赖目标用户故事完成。

### User Story Dependencies

- **US1 (P1)**: MVP；完成后即可验证 card persistence + restore。
- **US2 (P2)**: 依赖同一 GET projection，但必须保持 text-only 历史独立可用。
- **US3 (P3)**: 依赖同一 POST persistence path，目标是防止内部 trace 泄漏。

### Parallel Opportunities

- T001、T002、T005 可并行，因为文件不同。
- T008、T009 可并行准备，但 T010 必须等 T009 文件存在。
- T016、T017 可并行设计，但 T018 集成依赖两者。
- T021、T025、T028 可在对应实现完成后并行收尾。

## Parallel Example：User Story 1

```text
Task: "T013 [US1] 在 apps/kith-inn-be/src/lib/cms/chat.ts 扩展 createChatMessage() 输入类型"
Task: "T016 [US1] 在 apps/kith-inn-fe/src/logic/chatCards.ts 新增最小纯函数"
Task: "T017 [US1] 在 apps/kith-inn-fe/src/components/ChatCard.tsx 更新文案和只读/过期状态"
```

## Implementation Strategy

### MVP First

1. 完成 Phase 1 和 Phase 2。
2. 完成 US1 的 T012-T019。
3. 跑 quickstart 中 shared/payload/be/fe 的窄测试。
4. 手动验证 orders/delivery card reload 后恢复，customer-confirm 历史卡只读。

### Incremental Delivery

1. US1：card 可持久化并恢复。
2. US2：旧文本历史和混合历史无退化。
3. US3：确认只持久化用户可见产物。
4. Phase 6：统一文案、跑完整质量门禁、发 PR。
