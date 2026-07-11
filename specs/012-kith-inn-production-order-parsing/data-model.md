# 数据模型：kith-inn 生产接龙解析与订单对账

本功能不新增 collection 或状态字段。它增加两个短生命周期领域对象，并定义它们如何原子地更新现有订单实体。

## ParsedOrderInput（内存对象）

字段：

- `mode`: `snapshot | increment`
- `scope`: 一至多个 `{ date, occasion, dateEvidence }`
- `items`: `{ customerName, date, occasion, quantity, evidence }[]`
- `operation`: increment 时为 `add | set`；snapshot 不使用
- `operationEvidence`: increment 时逐字复制原文中的动作短语；snapshot 不使用
- `unknownSegments`: 疑似订单但无法安全解释的原文片段
- `issues`: 日期缺失/非法、周几冲突、范围歧义等阻断原因

约束：

- 每条 item 必须四字段完整，`quantity` 为正整数，日期为真实 `YYYY-MM-DD`。
- 每条 item 的 `evidence` 必须逐字来自用户原文，并同时包含与解析结果一致的顾客名和份数。
- item 的日期/餐次必须属于 scope。
- snapshot 至少有一个明确 scope；increment 恰好一个 item 与一个 scope。
- `dateEvidence` 必须来自用户原文并同时覆盖日期和餐次；其中多个日期表达必须解析为同一天，周几若出现必须与解析日期一致。
- `operationEvidence` 必须来自用户原文并与 `operation` 一致；模型不得替缺少动作的输入默认 `add` 或 `set`。
- `issues` 或高风险 `unknownSegments` 非空时只能返回补全/纠错消息，不能成为 pending 写操作。

## ReconciliationPreview（内存 pending 对象）

字段：

- `mode`、`scope`
- `rows`: 新增、更新、退出、未变化的差异行
- `expectedFingerprint`: 预览时目标范围所有 active order 的稳定指纹
- `operationKey`: 标识这一次确认操作的不可预测键，用于区分网络重试和另一笔独立操作
- `candidates`: 解析候选及已匹配 customer/套餐/价格信息
- `summary`: 用户确认卡文案

差异行关键字段：`kind`、顾客、日期、餐次、当前数量、动作量/目标总数、最终数量、订单状态、是否影响 confirmed 经营口径。

约束：

- snapshot 对 scope 内全部 active order 做全集差异，不区分此前录入方式；缺席项为退出。
- increment 只允许一个坐标，不生成未提及订单的退出项。
- fingerprint 覆盖 active 集合成员和每张订单的 id/status/paymentStatus/updatedAt/items；顺序归一后比较。
- 同一 operationKey 的重复/并发提交只应用一次；不同 operationKey 命中陈旧 fingerprint 时必须重预览。
- pending 仍按 operator 只保留最新一张卡；fingerprint 另行防数据库陈旧。

## Customer

沿用字段：`id`、`seller`、`displayName`、`address`。

解析先按现有名字归一规则匹配。新名字在确认卡提供地址输入；最终 reconcile 事务可按不可变候选创建 customer 后再创建订单。自动别名与重名消歧不在本功能范围。

## Order

沿用字段：`id`、`seller`、`customer`、`date`、`occasion`、`status`、`source`、`totalCents`、`paymentStatus`、`updatedAt`。

业务唯一坐标：`(seller, customer, date, occasion)`，仅 `draft | confirmed` 占 active 唯一键。

对账状态变化：

```text
无 active --新增--> draft
draft --更新数量--> draft
confirmed --更新数量--> confirmed
draft/confirmed --快照退出--> canceled
canceled 历史 + 新候选 --新增--> 新 draft
```

规则：

- 更新保留原 order id、status、paymentStatus、address snapshot 和既有 source；source 仅是内部创建审计值，不参与覆盖范围、差异或确认卡。新订单按输入模式使用现有来源枚举。
- 每个实际变化的订单写入由 operationKey 派生的坐标级 `idempotencyKey`，用于识别同次确认重试；不增加持久化对账表。
- confirmed 更新不创建第二条 fulfillment，也不退回 draft；确认卡必须预先提示经营影响。
- 快照退出使用 canceled 终态，不物理删除。

## OrderItem

桃子 MVP 每张订单仍只有一个 `combo-meal` item。新增按既有定价生成价格快照；更新原子替换该 item 的 quantity/unitPriceCents 并重算 `order.totalCents`。本功能不从接龙菜单正文创建 component items。

## Fulfillment

confirmed order 更新数量时保留现有 fulfillment 及其 pending/done 状态；订单取消时沿用 #154 原子取消语义把 fulfillment 置为 canceled。每 order 最多一条 fulfillment 的数据库约束保持不变。

## 一致性组合

| 对账结果 | Order | OrderItem | Fulfillment |
|---|---|---|---|
| 新增 | 新 draft | 一条套餐 × 最终份数 | 不存在 |
| 更新 draft | 保持 draft | 原子替换为最终份数 | 不存在 |
| 更新 confirmed | 保持 confirmed | 原子替换为最终份数 | 保持原状态、恰好一条 |
| 退出 draft | canceled | 保留历史明细 | 不存在 |
| 退出 confirmed | canceled | 保留历史明细 | canceled |
| 未变化 | 原样 | 原样 | 原样 |

任一写入、租户校验、fingerprint 校验或价格/商品校验失败时，整次 reconcile 回滚。
