# 数据模型参考：街坊味（kith-inn）

> 本文是 [`PRD.md`](./PRD.md) §7 的解释版，按 v1.11 目标模型描述。代码层已按本文同步；数据库结构迁移清单见文末。

## 0. 当前代码同步状态

我检查并同步了现有集合、shared schema 和 be/fe 调用层，当前状态是：

- 地址已经改过：代码里没有 `customer_addresses` 集合，`customers.address` 和 `orders.address` 都是自由文本 string。
- 订单粒度已改：`orders.occasion` 是餐次；一个 order = 一个顾客 + 一天 + 一餐。
- 自家单特殊标识已移除：不再有 `customers.kind = self`、`FULFILLMENT_MODES = onsite`。
- 履约已改：`fulfillments` 挂 `order`，状态收口为 `pending/done/canceled`，不再有 `handed-off`、`assignee`。
- 菜品字段：底层仍保留 `category`、`tags`、`recipe` 等历史/菜单内核字段；按最新口径，M1 UI 只让桃子维护菜名 + 主料，`recipe` 可保留给以后采购聚合但现阶段不用。

## 1. 订单粒度

常见订餐软件里，“订单”通常对应一次 checkout：一个顾客、一个商家、一个送达/自取时间、一个地址、一组商品、一笔收款。只要送达时间不同，系统通常会拆成不同订单或至少拆成不同 fulfillment。

街坊味 M1 采用：

> **一个 order = 一个顾客 + 一个用餐日期 + 一个餐次。**

理由：

- 午餐和晚餐的菜单、备餐、送餐、缺口对账都按餐次运转。
- “王阿姨 1 份晚餐 2 份午餐”虽然来自同一条接龙，但运营上是两餐承诺，应拆成两条 order。
- 这样 `order.status`、`paymentStatus`、`fulfillment.status` 都不用跨餐解释。
- 如果以后顾客端真的有购物车/合并支付，再加一个轻量 `order_batch` 或 `checkoutId` 归组即可；M1 不需要先建。

## 2. 总览关系

```text
sellers
 ├─ operators
 ├─ customers
 ├─ offerings
 ├─ service_slots
 │    └─ menu_plans
 ├─ orders ──< order_items >── offerings
 │    └─ fulfillment
 ├─ subscriptions (V1)
 └─ chat_messages
```

关键关系：

- 每张业务表都有 `seller` 租户键。
- `orders` 按 `(seller, customer, date, occasion)` 形成 active 业务唯一坐标；`canceled` 历史单不占坑。
- `order_items` 不承载午/晚，只表达这餐买了什么和多少。
- `fulfillment` 挂 `order`；地址从 `order.address` 读取，不在 fulfillment 里重复存。
- 地址是订单快照 string，不拆楼栋/单元/房号。

## 3. 主干实体

### `sellers`

商家/灶台。MVP 手动 seed 桃子一条。

| 字段 | 业务意义 |
|---|---|
| `name` | 商家名 |
| `serviceArea?` | 服务区域自由文本 |
| `defaultPriceCents?` | 默认单价 |
| `status` | active / paused / archived |
| `enabledModules?` | menu-planning / delivery / purchasing / booking |
| `moduleSettings?` | 模块配置 json |
| `profileFreeText?` | 自由文本经营画像，非 M1 必需 |

### `operators`

登录主体。MVP 只有桃子。

| 字段 | 业务意义 |
|---|---|
| `seller` | 租户 |
| `wechatOpenid` | 微信登录标识 |
| `role` | owner / helper |
| `active` | 软停用 |

### `customers`

顾客轻档案。自家单不设特殊类型，按普通顾客处理。

| 字段 | 业务意义 |
|---|---|
| `displayName` | 接龙里的称呼；不唯一，MVP 靠名字归一 + 人工合并 |
| `address?` | 默认送餐地址 string |
| `defaultServings?` | 默认份数 |
| `defaultOccasion?` | 默认餐次 |
| `note?` | 轻备注；不做忌口/喜好/二次加热系统 |

不需要 `customer_addresses` 表，不需要 `kind=self`。

### `offerings`

菜/SKU/套餐/课时的共享枢纽。对桃子的菜品池，M1 表单只维护菜名和主料。

| 字段 | 业务意义 |
|---|---|
| `name` | 菜名 / 套餐名 |
| `kind` | combo-meal / single-item / service-session / component |
| `mainIngredient?` | 主料；菜单避重的默认依据 |
| `parentOfferings?` | combo-meal 指向 component |
| `unitLabel?` | 份 / 杯 / 课时 |
| `priceCents?` | 单价 |
| `recipe?` | 预留给以后采购聚合；M1 UI 不展示，M1 逻辑不使用 |
| `active` | 是否启用 |

不再给菜维护口味、费工、喜好、忌口等标签。`recipe` 可以留字段，但现在不是桃子的维护负担。

### `service_slots`

时间桶：哪天、哪餐/时段。

| 字段 | 业务意义 |
|---|---|
| `date` | 服务日 |
| `granularity` | occasion / time-slot |
| `occasion?` | breakfast / brunch / lunch / dinner / all-day |
| `startAt?` / `endAt?` | time-slot 商家以后使用 |
| `status` | draft / open / archived |

桃子 M1 基本走 `granularity=occasion`。

### `orders`

一个顾客在某一天某一餐的下单承诺。

| 字段 | 业务意义 |
|---|---|
| `customer` | 顾客 |
| `date` | 用餐日 |
| `occasion` | 餐次 |
| `status` | draft / confirmed / canceled |
| `source` | chat-paste / chat-voice / manual / subscription / import |
| `placedAt` | 录入时间 |
| `address?` | 本单地址 string 快照 |
| `totalCents` | 派生总价 |
| `paymentStatus` | unpaid / paid / reconciled |
| `paymentMethod?` / `paidAt?` | 手动收款记录 |
| `idempotencyKey?` | 技术幂等键，主要防网络重试/重复提交 |
| `createdBy?` | 操作者 |

active 业务唯一坐标：`(seller, customer, date, occasion)`。再次粘贴同一天同餐时更新已有 draft/confirmed order，不新增重复 order；canceled 历史单不阻止重下。

### `order_items`

订单明细行。桃子 M1 通常每餐只有一个套餐 item。

| 字段 | 业务意义 |
|---|---|
| `order` | 所属订单 |
| `offering` | 套餐或单品 |
| `quantity` | 份数 |
| `unitPriceCents?` | 确认时价格快照 |
| `note?` | 明细备注 |

不需要 `mealOccasion`；餐次在 `orders.occasion`。

### `fulfillments`

送餐履约薄表。M1 只表达“这条 order 送没送到”。

| 字段 | 业务意义 |
|---|---|
| `order` | 所属订单 |
| `serviceDate` | 反范式日期，来自 order |
| `occasion` | 反范式餐次，来自 order |
| `status` | pending / done / canceled |
不做奶奶协同，不建 `assignee` / `handoff` / `handed-off`。送餐清单通过 `order.address` 按地址 string 相似度/自然排序。

## 4. 模块表

### `menu_plans`

某天某餐做什么。

| 字段 | 业务意义 |
|---|---|
| `slot` | 对应 service slot |
| `offerings[]` | 选中的菜/套餐内容 |
| `publishText?` | 群通知文案 |
| `status` | draft / published |

自动排菜默认主料避重；用户指定替换时允许打破避重，只需确认。

### `subscriptions` (V1)

订阅/固定客预订是后续能力，M1 不实现。

### `delivery` / `purchasing`

- delivery 无自有表，只读写 `fulfillments.status`，地址从 `orders.address` 派生。
- purchasing 暂不启用；以后可以从 `orders × offerings.recipe` 聚合采购清单。

## 5. 重复写入与幂等

原来的“撞键返回现存 draft”意思是：

> 创建订单时带一个 `idempotencyKey`。如果数据库里已经有同 key 的订单，就不再新建，而是返回那条已有 draft，避免重复粘贴或网络重试生成两条单。

这个机制适合技术防重，但不适合作为桃子能理解的交互。

推荐交互：

- 接龙粘贴后先解析成确认卡。
- 确认卡逐行标明：新增 / 更新 / 跳过。
- 命中同一天同餐同顾客的现有 order 时，展示改前/改后数量。
- 现有订单已 confirmed 时，必须二次确认，因为会影响送餐和收款口径。
- `idempotencyKey` 只在后台防“同一次提交重复发送”，不要把“撞键”暴露给用户。

## 6. 几条硬规则

- 一个 order = 一个顾客 + 一个日期 + 一个餐次。
- 午餐、晚餐是不同 order，即使来自同一接龙。
- 自家单没有特殊标识。
- 地址是 string。
- 菜品池 M1 只让用户维护菜名 + 主料。
- 采购字段可预留，采购功能后置。
- 数据操作类对话必须先确认，再写库。

## 7. 目标 schema 落地方式（未部署 → push，不走 migration）

项目尚未部署、无真实数据要保，**不维护 migration 文件**：collection 定义即 source of truth，靠 drizzle push（`payload.config.ts` 写死 `push: true`）同步到 DB。上线前（有真实数据时）才用 `payload migrate:create` 生成 baseline，之后增量；**原 migration 里的 partial unique（service_slots `(seller,date,occasion)`、orders active 业务唯一坐标、orders `idempotency_key`）+ 复合查找索引（`orders (seller,date,occasion,status,paymentStatus)` 等）drizzle push 都不会从 collection 重建，统一由 cms `onInit` 的 `ensureConstraints` 每次启动幂等重建**（`CREATE [UNIQUE] INDEX IF NOT EXISTS`，见 `apps/cms/src/db/ensureConstraints.ts`）。

当前代码已同步到下面这套目标 schema（`customers.address` / `orders.address` 均已是 string，无需再迁 `customer_addresses`）：

1. `orders` 增加 `occasion` 字段，枚举同 `OCCASIONS`，最终 required + index。
2. 为 `orders` 加 active 业务唯一约束/索引：`(seller, customer, date, occasion) WHERE status IN ('draft','confirmed')`。
3. `order_items` 删除 `mealOccasion`、`timeWindow` 字段；餐次只看 `orders.occasion`。
4. `fulfillments` 增加 `order` relationship。
5. `fulfillments.status` 枚举收口为 `pending/done/canceled`。
6. `fulfillments` 删除 `orderItem`、`mode`、`assignee`、`timeWindow` 字段；地址从 `orders.address` 读。
7. `customers` 删除 `kind` 字段。
8. 清理不再使用的 select enum 类型（如 fulfillment mode、customer kind、旧 fulfillment status）——改 collection 后 push 同步。

已同步实现点：

- shared enums/schema/types 同步上述字段和枚举。
- order confirm 从“每个 item 建 fulfillment”改为“每个 order 建一条 fulfillment”。
- delivery view 从 `fulfillment.orderItem.order.address` 改为 `fulfillment.order.address`。
- 送达勾销从 orderItem ids 改为 fulfillment ids 或 order ids。
