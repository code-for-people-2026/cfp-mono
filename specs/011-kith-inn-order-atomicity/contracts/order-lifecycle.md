# 内部 API 契约：订单原子生命周期

所有端点继续要求 `x-kith-inn-operator`，seller 与 operator 只从已验证 JWT 推导。以下是 kith-inn-be → CMS 的内部契约，不面向 FE 直接开放。

## 创建完整草稿

`POST /api/internal/orders`

请求体保持现有 `CreateDraftInput`。成功 `201`：

```json
{
  "order": { "id": 90, "status": "draft" },
  "items": [{ "id": 201, "order": 90, "quantity": 1 }]
}
```

原子性：order 与全部 items 同时提交；任一校验或写入失败时均不可见。

## 原子确认

`POST /api/internal/orders/{id}/confirm`

无请求体。成功或安全重试均返回 `200`：

```json
{
  "slots": [{ "id": 30, "status": "open" }],
  "fulfillments": [{ "id": 40, "order": 90, "status": "pending" }],
  "alreadyConfirmed": false
}
```

已确认重试返回同一语义数据，`alreadyConfirmed=true`，不得创建新 fulfillment。

错误：

- `404 {"error":"not-found"}`：当前 seller 下无此订单。
- `409 {"error":"empty-order"}`：草稿无明细。
- `409 {"error":"slot-archived"}`：目标餐次已归档，整次确认不写入。
- `409 {"error":"not-draft"}`：订单为 canceled 或其他不可确认状态。
- `5xx`：事务未完成或结果未知；调用方可用相同 id 重试。

## 原子取消

`POST /api/internal/orders/{id}/cancel`

无请求体。成功或安全重试均返回 `200`：

```json
{
  "ok": true,
  "alreadyCanceled": false
}
```

首次取消在一个事务内把该 order 的所有 fulfillment 与 order 置为 canceled。已取消重试返回 `alreadyCanceled=true`。

错误：

- `404 {"error":"not-found"}`：当前 seller 下无此订单。
- `5xx`：事务未完成或结果未知；调用方可用相同 id 重试。

## BE 对外兼容

- `POST /orders` 成功仍为 201。
- `POST /orders/{id}/confirm` 成功与已完成重试均为 200，body 仍至少包含 `slots`、`fulfillments`。
- `POST /orders/{id}/cancel` 成功与已完成重试均为 `200 {"ok":true}`。
- 业务规则拒绝继续由 BE 映射为 409；基础设施或未知错误映射为 502。
