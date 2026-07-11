# 数据模型：kith-inn 订单写入与生命周期原子性

本功能不新增 collection 或状态字段，只强化既有实体之间的事务与唯一性约束。

## Order

关键字段：`id`、`seller`、`customer`、`date`、`occasion`、`status`、`address`、`totalCents`、`idempotencyKey`。

关系：一张 order 拥有一至多条 order_items；确认后拥有恰好一条 fulfillment；按 `(seller,date,occasion)` 关联 service slot。

约束：

- active 业务坐标 `(seller,customer,date,occasion)` 保持现有 partial unique。
- `status=draft` 时不得因确认流程留下 fulfillment。
- `status=confirmed` 的新数据必须有且仅有一条 fulfillment。
- `status=canceled` 时关联 fulfillment 必须为 `canceled`。

状态迁移：

```text
draft --confirm--> confirmed --cancel--> canceled
  \----------------cancel---------------> canceled
```

`confirmed` 重复 confirm 与 `canceled` 重复 cancel 是幂等读回；不新增中间状态。

## OrderItem

关键字段：`id`、`seller`、`order`、`offering`、`quantity`、`unitPriceCents`、`note`。

约束：创建草稿时，order 与请求中的全部 order_items 在同一事务提交；任一条失败则全部回滚。order_items 的 seller 与 order seller 一致，offering 必须属于当前 seller。

## ServiceSlot

关键字段：`id`、`seller`、`date`、`occasion`、`granularity`、`status`。

约束：`(seller,date,occasion)` 保持唯一；确认时缺失则创建 open，draft 则更新为 open，open 则复用，archived 则拒绝整个确认事务。

## Fulfillment

关键字段：`id`、`seller`、`order`、`serviceDate`、`occasion`、`status`。

新增约束：`(seller,order)` 全状态唯一。

状态规则：确认时创建 `pending`；订单取消时从 `pending` 或 `done` 统一转 `canceled`；重复确认不创建第二条记录。

## 一致性组合

| Order 状态 | ServiceSlot | Fulfillment | 是否允许 |
|---|---|---|---|
| draft | 原样 | 不存在 | 是 |
| confirmed | open | 恰好一条 pending/done | 是 |
| canceled（由 draft 取消） | 原样 | 不存在 | 是 |
| canceled（由 confirmed 取消） | 保持原状 | 恰好一条 canceled | 是 |
| draft | 新增 pending/done | 否 |
| confirmed | 缺失或重复 | 否 |
| canceled | pending/done | 否 |
