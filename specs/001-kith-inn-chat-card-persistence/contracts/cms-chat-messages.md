# Contract: CMS Internal Chat Messages

## `GET /api/internal/chat_messages`

Returns recent Payload `chat_messages` documents.

### Relevant document fields

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

Creates one visible chat message.

### Request body

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

### Rules

- `card` is optional and nullable.
- `card` should only be sent for visible assistant messages.
- The internal API must continue applying existing seller/operator stamping and tenant access controls.
