# 数据模型：kith-inn 配送地址选填与自动带出

本功能不新增 collection、字段、枚举或 migration；只确认两个既有可空字段的正确语义。

## Customer

沿用 `customers.address?: string`，表示未来新订单可带出的默认配送地址。

- 可缺失；缺失不阻止保存顾客、创建订单或确认订单。
- 新顾客确认卡输入 trim 后非空时保存；空字符串和纯空白不保存。
- 默认地址变化只影响之后创建的订单，不追溯修改旧订单。

## Order

沿用 `orders.address?: string`，表示本单创建时的配送地址快照。

```text
customer.address missing --创建--> draft.address missing --确认--> confirmed.address missing + fulfillment
customer.address present --创建--> draft.address snapshot --确认--> confirmed.address snapshot + fulfillment
customer.address 改变 ----------------------------> 已有 order.address 不变
```

约束：

- 新订单创建时读取当时的顾客默认地址并复制；输入无需重复携带地址。
- 顾客无默认地址时，新订单快照可空且仍能完整走生命周期。
- 订单创建后不因顾客资料变化或后续接龙覆盖数量而改写地址快照。
- fulfillment 不重复存地址，从 order 快照派生；快照缺失时归入“（无地址）”。

## Reconciliation

- 新顾客候选的 `address?` 只来自桃子在确认卡中的选填输入。
- 同一个归一化新顾客在一批候选中只创建一次；一行填入的地址供该顾客本批次所有新订单使用。
- 既有顾客候选按既有名字归一规则关联 customer，新建订单从 customer 读取默认地址。
- 更新既有 active order 的份数或套餐不改写其地址快照。

## 无地址送餐

无地址 confirmed order 仍有正常 fulfillment。送餐视图把空快照展示为“（无地址）”，让桃子按自己的记录处理；该分组不是错误状态，也不会阻断付款或送达。
