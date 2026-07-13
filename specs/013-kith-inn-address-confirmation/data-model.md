# 数据模型：kith-inn 缺地址确认守卫

本功能不新增 collection、字段、枚举或 migration；只收紧两个现有地址字段的写入与状态语义。

## Customer

沿用 `customers.address?: string`，表示以后新订单默认带出的送餐地址。

- 可缺失；缺失不会阻止保存顾客或 draft。
- 补全某张订单时，显式输入的非空地址成为新的 customer 默认地址。
- 更新默认地址不追溯修改该顾客其他既有订单。

## Order

沿用 `orders.address?: string`，表示本单送餐地址快照。

缺地址判定：`null`、`undefined`、空字符串或 `trim()` 后为空均为缺失。

```text
draft + address missing --补地址--> draft + address present
draft + address missing --确认--> 409 missing-address（零写入）
draft + address present --确认--> confirmed + fulfillment
```

约束：

- 创建 draft 时可以从空 customer 默认地址得到空快照。
- 补地址只允许目标 order 为 draft 且当前快照缺失；它不改变 status、slot、fulfillment、付款或明细。
- `orders.address` 只能经专用补全事务从缺失变为非空；BE/CMS 通用订单 PATCH 均不得接受 address 或其他生命周期/租户字段。
- 快照补齐后，同值请求是幂等读取；不同值请求返回 `address-present`，不把补全端点变成通用改地址入口。
- confirm 只读取 order 快照；即使 customer 默认地址已存在，也不静默替代空快照。
- canceled/confirmed order 不由补全端点修改；历史 confirmed 缺地址数据不迁移。

## AddressCompletion（事务结果）

短生命周期响应对象：

- `orderId`: 目标订单
- `customerId`: 该订单关联顾客
- `address`: trim 后实际写入/已存在的地址
- `alreadyCompleted?`: 相同地址直接重试时为 `true`

事务不变量：

1. seller-scoped 读取目标 draft 和其 customer。
2. 获取与 confirm/reconcile 相同的数据库写锁。
3. 同一事务写 `customers.address` 和目标 `orders.address`。
4. 任一步失败时两者都回到操作前状态。
5. 不读取或更新其他订单、其他 seller 或 kith-inn-v1 collection。

## ReconciliationPreviewRow

沿用既有差异行，增加 `addressMissing?: boolean` 作为展示字段：

- 新生产的 candidate row 必须给出明确 true/false；旧持久化聊天卡可缺省该字段。
- existing active order 以 `order.address` 判定。
- 没有 active order 的 existing customer 以 `customer.address` 判定。
- new customer 以确认卡当前输入判定；该字段不进入 CMS reconcile request。
- cancel row 不需要地址状态，因为不会形成待确认 draft。

## 并发顺序

补地址与确认共用数据库写锁，因此最终只能是：

- confirm 先执行：看到空快照并失败；补地址随后成功，订单仍为 draft。
- completion 先执行：两个地址同时提交；confirm 随后看到非空快照并正常确认。

任何顺序都不能得到 `status=confirmed` 且地址为空的订单。
