# 契约：kith-inn 配送地址选填与自动带出

本功能不新增端点或响应字段；以下记录既有输入和生命周期契约，防止未来误改为必填。

## 接龙确认卡输入

`record_orders` 的确认请求可为新顾客候选携带按 candidate index 对齐的可选地址：

```json
{
  "items": [
    {},
    { "address": "3A-2701" }
  ]
}
```

- `items`、单项对象或 `address` 均可缺省。
- Chat 确认入口把 `address` trim 后为空归一为未填写，不返回校验错误。
- 只有 `newCustomer` 候选读取客户端地址；既有顾客候选不能借此改顾客资料或订单快照。

CMS 内部 reconciliation request 仍使用严格 schema：可选地址应省略；直接发送纯空白字符串返回 `400 invalid-reconciliation`。这不改变桃子端的选填行为，而是要求内部调用者先完成归一化。

## Reconciliation 写入

- 新顾客地址未填写：创建可空地址的 customer 和 order。
- 新顾客地址已填写：创建 customer 时保存默认地址，并复制到本批次该顾客的新 order。
- 既有顾客的新 order：读取 `customers.address`，复制到 `orders.address`；candidate 不需要地址。
- 已有 active order：数量或套餐 reconciliation 不改写既有 `orders.address`。

## 确认订单

既有端点不变：

- BE：`POST /orders/{id}/confirm`，Bearer operator JWT
- CMS：`POST /api/internal/orders/{id}/confirm`，`x-kith-inn-operator` JWT

地址不是请求字段或前置条件。只要订单满足既有 draft、明细和餐次规则，`address` 缺失也返回正常确认结果，创建 fulfillment 并转为 confirmed；不得返回 `missing-address`。

## 通用订单更新

既有 BE `PATCH /orders/{id}` 与 CMS `PATCH /api/internal/orders/{id}` 只接受 `paymentStatus`、`paymentMethod`、`paidAt`、`date`、`occasion`、`note`。`address`、`status`、`customer`、`seller` 和未知字段不得传给 Payload；仅含禁用/未知字段时返回 `400 no updatable fields`，混合请求只应用白名单字段。

## 送餐展示

fulfillment 从关联 order 读取地址：

- 非空地址：按地址字符串分组和排序。
- 缺失或 trim 后为空：进入“（无地址）”分组。

两种情况都保留在待送、送达和统计口径中。

## 快照不变量

- customer 默认地址只作为未来新订单的复制来源。
- order 地址在创建时冻结；更新 customer 或后续修改订单数量不追溯改变它。
- 不读取或修改其他 seller、其他顾客或 kith-inn-v1 数据。
