# 调研记录：kith-inn 聊天卡片持久化

## 当前完成度快照

项目已经不是骨架。核心 Payload collections、seller scoping helpers、订单生命周期、送餐派生、菜单生成、手动收款状态、agent tools、当轮聊天卡片和 Today 页 card 渲染都已经实现，并且在 `@cfp/kith-inn-be`、`@cfp/kith-inn-payload` 和 `@cfp/kith-inn-shared` 中已有测试覆盖。

本功能的缺口很窄：当前 turn 可以产生并渲染 card，但持久化的 chat message 只存文本。reload 后，`GET /chat` 无法返回 card，因为 CMS collection 和 backend projection 都没有承载 card。

## 决策：把可见 card 快照存到 `chat_messages`

**理由**: card 是 assistant reply 的可见组成部分。随 assistant message 一起保存，才能在不重新调用 AI / tools 的情况下恢复聊天历史。

**考虑过的替代方案**:

- 历史加载时根据当前 orders/delivery 重新计算 card：拒绝，因为这会改变历史，而且接近重新执行 tool 行为。
- 新建独立 card table：拒绝，因为当前产品里一条 assistant message 最多只有一张可见 card。
- 存 raw tool calls 再重建 card：拒绝，因为会持久化内部 trace，违反展示历史边界。

## 决策：复用现有 `CardPayload` 形态

**理由**: `cardPayloadSchema` 已经定义了 backend 和 frontend 共享的可见 card contract。复用它可以避免平行形态。

**考虑过的替代方案**:

- 使用更松的 untyped JSON contract：拒绝，因为无效历史 card 应该能安全降级。
- 现在就给每种 card 加版本机制：暂缓，等真的出现 card shape migration 痛点再做。

## 决策：`customer-confirm` 动作恢复不放进本功能

**理由**: 当前确认动作依赖进程内 `pendingState`。让「都建」reload-safe 需要持久化 action state 和 stale/completed 状态转换，这是另一个状态机功能。

**考虑过的替代方案**:

- 现在一起做 persisted confirmation state：拒绝，因为会让第一个 Spec Kit 试点超过一个最小可交付切片。
- 历史里完全隐藏 customer-confirm card：拒绝，因为用户仍会丢失重要对话上下文。

## 决策：不改 retention 和 pagination

**理由**: 现有历史加载使用 latest-message limit。card persistence 不要求同时解决旧历史分页或 GC。

**考虑过的替代方案**:

- 现在加入 cursor pagination：拒绝，作为独立展示历史功能处理。
- 现在重写 retention policy：拒绝，因为和恢复 card payload 无直接关系。
