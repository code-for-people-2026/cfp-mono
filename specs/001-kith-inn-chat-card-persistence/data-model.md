# 数据模型：kith-inn 聊天卡片持久化

## 实体：Chat Message

seller/operator 对话中的现有可见消息。

### 现有字段

- `id`
- `operator`
- `content`
- `role`
- `createdAt`
- `seller`

### 新增字段

- `card`：optional nullable JSON value，保存一张可见 assistant card snapshot。

### 校验规则

- `card` 只对 `role = assistant` 有意义。
- 如果存在，`card` 必须匹配共享 `CardPayload` contract 才能作为可渲染 card 返回给 client。
- 不符合当前 `CardPayload` contract 的历史 `card` 数据不得透传给 client；历史接口应返回 `cardUnavailable: true`，由前端显示“卡片数据已过期”占位，而不是让历史加载崩溃。
- user message 不应携带 generated card。

### 状态说明

- `card` 是历史快照，不是 live view。
- 本功能不新增 `cardStatus` 或 action-state 字段。
- 新顾客“全部建档并记单”动作恢复需要后续 data-model 变更；本功能不新增 active/stale action-state 字段。

## 迁移说明

- 给 `cms.chat_messages` 添加 nullable JSON / JSONB column。
- 现有 rows 保持有效，`card = null`。
- 不需要 backfill。
- 本功能不包含 retention 或 pagination schema change。
