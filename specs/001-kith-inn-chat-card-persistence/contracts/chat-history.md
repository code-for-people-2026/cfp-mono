# 契约：kith-inn Chat API

## `GET /chat`

加载当前已认证 seller/operator 的近期可见聊天历史。

### 响应

```json
{
  "messages": [
    {
      "id": 123,
      "role": "assistant",
      "content": "今天送餐：还差 2 份，看下面分拣卡片。",
      "createdAt": "2026-07-02T08:30:00.000Z",
      "card": {
        "type": "delivery",
        "data": {
          "totalPending": 2,
          "groups": []
        }
      }
    }
  ]
}
```

### 规则

- `card` 是 optional。
- 没有 card 的 messages 保持当前 shape。
- 历史 `card` JSON 不符合当前 `CardPayload` contract 时，response 不返回原始 `card`，而是返回 `cardUnavailable: true`，client 显示“卡片数据已过期”占位。
- 历史 `customer-confirm` card 只表示可见卡片快照，不表示该确认动作仍然 active；client 必须按历史/过期卡处理，除非它来自当前会话最新 assistant response。
- endpoint 不得调用 LLM 或执行 agent tools。
- 继续通过现有 auth path 保持 seller/operator scoping。

## `POST /chat`

发送一条 user message，并返回 assistant reply。

### 响应

```json
{
  "reply": "今天有 3 单，看下面卡片。",
  "card": {
    "type": "orders",
    "data": {
      "orders": [],
      "date": "2026-07-02"
    }
  }
}
```

### 持久化规则

- user message 持久化时不带 card。
- assistant message 有可见 `card` 时，持久化的 card 必须和返回给 client 的 card 一致。
- business side effects 提交后，chat persistence 仍保持 best-effort。
