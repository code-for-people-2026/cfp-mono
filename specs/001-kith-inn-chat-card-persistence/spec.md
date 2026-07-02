# Feature Specification: kith-inn Chat Card Persistence

**Feature Branch**: `001-kith-inn-chat-card-persistence`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Persist assistant chat cards in kith-inn chat history so cards survive reload and render with the original conversation."

## Project Scope

**Project**: kith-inn

**Allowed source paths**:

- `docs/kith-inn/**`
- `apps/kith-inn-be/**`
- `apps/kith-inn-fe/**`
- `packages/kith-inn-shared/**`
- `packages/kith-inn-payload/**`
- `apps/cms/**` only for kith-inn Payload collections, migrations, seed, auth, or internal APIs

**Source material**:

- `docs/kith-inn/PRD.md` sections 5.5, 6.1, 6.3, 7.1
- `docs/kith-inn/USER-STORIES.md` stories US-T02, US-T03, US-T06, US-O03, US-O04, US-D02
- `docs/kith-inn/TECH-SPEC.md` section 4.1
- `docs/kith-inn/DATA-MODEL.md` sections 3, 5, 6

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Restore Assistant Cards After Reopen (Priority: P1)

桃子问了一个会返回结构化卡片的问题，例如今天有哪些订单、还差哪些送餐、或刚粘贴的接龙里有哪些待确认新顾客。她退出并重新打开小程序后，历史消息里仍能看到 assistant 当时回复的文字和对应卡片。

**Why this priority**: 当前聊天页已经能在当轮展示卡片，但重开后卡片消失，只剩文字。这会让聊天历史不像真实聊天记录，也让老板需要重复提问。

**Independent Test**: 先产生一条带卡片的 assistant 回复，再重新加载聊天页；不发送新消息、不重新调用 AI，历史里仍出现同一张卡片。

**Acceptance Scenarios**:

1. **Given** 一条 assistant 历史消息带有订单卡片，**When** 桃子重新打开今天页，**Then** 这条 assistant 消息仍显示订单卡片。
2. **Given** 一条 assistant 历史消息带有送餐卡片，**When** 桃子重新打开今天页，**Then** 这条 assistant 消息仍显示送餐卡片。
3. **Given** 一条 assistant 历史消息带有新顾客确认卡片，**When** 桃子重新打开今天页，**Then** 这条 assistant 消息仍显示确认卡片内容；可恢复执行「都建」不属于本 feature。

---

### User Story 2 - Preserve Normal Chat History (Priority: P2)

桃子打开今天页时，普通用户消息、普通 assistant 文字回复、带卡片的 assistant 回复按原有时间顺序混排显示；没有卡片的老消息不能因为本 feature 发生展示退化。

**Why this priority**: 卡片只是 assistant 消息的附加展示，不应该破坏已有聊天历史。

**Independent Test**: 准备同时包含纯文本消息和带卡片消息的历史记录；加载今天页后检查顺序和内容。

**Acceptance Scenarios**:

1. **Given** 历史记录里既有纯文本 assistant 回复也有带卡片回复，**When** 桃子打开今天页，**Then** 所有消息按从旧到新的顺序展示。
2. **Given** 历史记录里有旧格式消息没有卡片，**When** 桃子打开今天页，**Then** 这些消息继续按文本消息展示。

---

### User Story 3 - Persist Only Visible Conversation Artifacts (Priority: P3)

系统只恢复用户实际看见过的 assistant 文本和结构化卡片，不把 tool calls、system prompt、raw LLM trace 或内部服务结果显示到历史聊天里。

**Why this priority**: 聊天历史是展示层，不是调试日志；保存过多内部内容会增加噪音和隐私风险。

**Independent Test**: 产生一次带工具调用的 assistant 回复；历史恢复时只能看到最终 assistant 文本和可见卡片。

**Acceptance Scenarios**:

1. **Given** 一轮聊天内部调用过工具，**When** 桃子重新打开今天页，**Then** 历史里不出现工具调用参数、系统提示词或 raw LLM 消息。

### Edge Cases

- 历史消息没有卡片字段：继续按普通文本消息展示。
- 历史消息带有未知或无效卡片：展示文本消息，不让页面崩溃。
- 历史加载失败：保留现有错误提示，不发送新消息，不自动重试 AI。
- 旧卡片里的订单或送餐状态可能已经变化：本 feature 恢复的是历史快照，不保证卡片内容实时刷新。
- 新顾客确认卡片重开后能看到历史内容，但「都建」动作的可恢复状态另起 feature 处理。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist the visible assistant card payload whenever an assistant reply includes a card.
- **FR-002**: System MUST return the persisted card with the corresponding assistant message when chat history is loaded.
- **FR-003**: Users MUST see restored assistant cards inline with their original assistant messages after reopening the app.
- **FR-004**: System MUST preserve existing chronological message display: user messages, assistant text messages, and assistant card messages appear in conversation order.
- **FR-005**: System MUST NOT call the LLM or re-run tools merely to restore historical cards.
- **FR-006**: System MUST NOT persist or display raw tool calls, system prompts, raw LLM traces, or internal service-only data as chat history.
- **FR-007**: System MUST handle older text-only messages without migration-visible user impact.
- **FR-008**: System MUST degrade safely for unknown or invalid historical card payloads by showing the assistant text and omitting the broken card.
- **FR-009**: System MUST make it clear that restored new-customer confirmation cards are historical unless their action state is implemented by a later feature.

### Key Entities *(include if feature involves data)*

- **Chat Message**: A visible message in the seller/operator conversation; has a role, text content, timestamp, and optionally one visible assistant card.
- **Assistant Card**: A structured visual artifact attached to an assistant message. Current card types include customer confirmation, orders, and delivery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can reopen the app after receiving an orders or delivery card and see the same card in history without asking again.
- **SC-002**: Existing text-only chat history remains visible with no user-facing format change.
- **SC-003**: Loading history never depends on an LLM response or tool execution.
- **SC-004**: Invalid or unknown historical card payloads do not crash the chat page.

## Assumptions

- One assistant message has at most one visible card; supporting multiple cards per assistant message is out of scope.
- This feature stores a historical snapshot of the card, not a live query view.
- Persistent, reload-safe execution for the new-customer「都建」action is out of scope and should be handled by a later feature.
- Chat history pagination, retention, and garbage collection are out of scope for this feature.
- The existing kith-inn authentication and seller/operator scoping continue to apply.
