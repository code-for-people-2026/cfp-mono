# 契约：kith-inn 缺地址确认与补全

## 统一缺地址规则

服务端权威判定为 `!address?.trim()`。FE 的展示与按钮状态使用同一语义，但不能替代 CMS 守卫。

## 确认订单

既有端点不变：

- BE：`POST /orders/{id}/confirm`，Bearer operator JWT
- CMS：`POST /api/internal/orders/{id}/confirm`，`x-kith-inn-operator` JWT

缺地址时 CMS 返回：

```json
HTTP 409
{ "error": "missing-address" }
```

BE 对点击入口返回：

```json
HTTP 409
{ "error": "missing-address", "message": "请先补地址再确认订单" }
```

Agent 口头确认返回同义文案。拒绝前后订单 status、slot 和 fulfillment 完全一致。

## 补齐订单地址

### BE → 桃子端

`PATCH /orders/{id}/address`

Headers：`Authorization: Bearer <operator-jwt>`、`Content-Type: application/json`

### BE → CMS

`PATCH /api/internal/orders/{id}/address`

Headers：`x-kith-inn-operator: <operator-jwt>`、`Content-Type: application/json`

两层请求 body 相同：

```json
{ "address": "3A-2701" }
```

成功 `200`：

```json
{
  "orderId": 90,
  "customerId": 5,
  "address": "3A-2701",
  "alreadyCompleted": false
}
```

`alreadyCompleted` 可省略或为 false；相同地址直接重试时为 true。服务端先 trim，再把同一值原子写入目标 order 快照和 customer 默认地址。

既有 BE `PATCH /orders/{id}` 与 CMS `PATCH /api/internal/orders/{id}` 只接受既定普通字段白名单（付款、日期、餐次、备注）；不得接受 `address`、`status`、`customer`、`seller` 等快照、生命周期或归属字段。请求仅含禁用/未知字段时返回 `400 no updatable fields`，混合请求也不得把禁用字段传给 Payload。

错误：

- `400 invalid-address`：body 缺失、非字符串或 trim 后为空。
- `404 not-found`：订单不存在或不属于当前 seller；不泄露其他租户资源。
- `409 not-draft`：目标订单不是 draft。
- `409 address-present`：快照已有不同的非空地址；需另走未来明确的改地址能力。
- `5xx`：事务失败；customer 与 order 均不得留下部分写入。相同请求可直接重试。

## 确认卡展示字段

`OrderReconciliationRow` 增加：

```json
{ "addressMissing": true }
```

该字段可选以兼容旧聊天卡，但新生成的 create/update/unchanged/add/set candidate row 必须提供 boolean。它只存在于 preview `rows`，构造 CMS reconcile request 时不传递；FE 为 true 的候选显示“待补地址”，仍允许保存 draft。

## 原子性与并发

- 地址补全与 confirm/reconcile 使用同一个 PostgreSQL 写锁和事务。
- 补全写 customer 失败或写 order 失败时整体回滚。
- completion 与 confirm 并发时，confirm 要么先因缺地址失败，要么在补全提交后成功；禁止 confirmed+空地址。
- 其他既有订单地址快照始终不在补全事务的写集合中。
- 通用订单 PATCH 的 BE 与 CMS 测试必须证明 `{address: ...}` 无法改变空或非空快照。
