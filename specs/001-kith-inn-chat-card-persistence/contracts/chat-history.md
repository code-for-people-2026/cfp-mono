# Contract: kith-inn Chat API

## `GET /chat`

Loads recent visible chat history for the authenticated seller/operator.

### Response

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

### Rules

- `card` is optional.
- Messages without cards keep the current shape.
- Invalid card payloads are omitted from the response.
- The endpoint must not call an LLM or run agent tools.
- Seller/operator scoping remains enforced by the existing auth path.

## `POST /chat`

Sends one user message and returns the assistant reply.

### Response

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

### Persistence Rules

- Persist the user message without a card.
- Persist the assistant message with the same visible `card` returned to the client when a card exists.
- Chat persistence remains best-effort after business side effects have committed.
