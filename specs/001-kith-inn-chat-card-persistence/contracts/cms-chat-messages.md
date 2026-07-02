# 契约：CMS Internal Chat Messages

## `GET /api/internal/chat_messages`

返回近期 Payload `chat_messages` documents。

### 相关 document 字段

```json
{
  "id": 123,
  "operator": 1,
  "content": "今天有 3 单，看下面卡片。",
  "role": "assistant",
  "createdAt": "2026-07-02T08:30:00.000Z",
  "seller": 7,
  "card": {
    "type": "orders",
    "data": {
      "orders": [],
      "date": "2026-07-02"
    }
  }
}
```

## `POST /api/internal/chat_messages`

创建一条可见聊天消息。

### 请求体

```json
{
  "content": "今天有 3 单，看下面卡片。",
  "role": "assistant",
  "card": {
    "type": "orders",
    "data": {
      "orders": [],
      "date": "2026-07-02"
    }
  }
}
```

### 规则

- `card` 是 optional 且 nullable。
- `card` 只应随可见 assistant message 发送。
- `card` 是可见结果快照；CMS 不存储也不推导 `customer-confirm` 的 active/stale/completed action state。
- internal API 必须继续应用现有 seller/operator stamping 和 tenant access controls。
