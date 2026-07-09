# 数据模型：街坊味 v1（kith-inn-v1）

> 状态：草稿 v0.1
>
> 日期：2026-07-09
>
> 原则：参考旧 `kith-inn` 的建模经验，但 v1 使用自己的 collection、schema、hooks、类型和业务代码。禁止从旧 `@cfp/kith-inn-*` 包 import。

## 1. 命名

v1 collections 使用 `kiv1_` 前缀，避免和旧 `kith-inn` 在共享 `apps/cms` host 里撞 slug。

```text
kiv1_sellers
kiv1_operators
kiv1_customer_profiles
kiv1_offerings
kiv1_menu_plans
kiv1_meal_slots
kiv1_booking_batches
kiv1_booking_batch_slots
kiv1_orders
kiv1_order_items
kiv1_fulfillments
```

每个业务集合都有 `seller` 字段。商家侧按 `seller` 隔离；顾客侧按 `seller + openid` 隔离。

## 2. 关系总览

```text
seller
  ├─ operators
  ├─ offerings
  ├─ menu_plans
  ├─ meal_slots ── menu_plan
  │    └─ booking_batch_slots ── booking_batch
  ├─ customer_profiles (openid + 称呼 + 地址)
  └─ orders ── customer_profile
       ├─ order_items
       └─ fulfillment
```

核心流：

1. 桃子维护 `offerings`。
2. 系统生成 `menu_plans`。
3. 某天某餐开放为 `meal_slots`。
4. 桃子选择多个 `meal_slots` 生成 `booking_batch` 分享。
5. 顾客用 openid 选择/新增 `customer_profile`，提交 `orders`。
6. 桃子确认 order 后进入备餐/收款/送达口径。

## 3. 枚举

### `occasion`

```text
lunch
dinner
```

MVP 只做午餐/晚餐。

### `offering.category`

```text
meat
veg
soup
staple
```

### `order.status`

```text
draft      # 顾客已提交/桃子手动补单，桃子未确认
confirmed  # 桃子已确认，锁单，进入经营口径
canceled   # 取消，历史保留，退出经营口径
```

### `paymentStatus`

```text
unpaid
paid
```

MVP 不做 `reconciled`，先省掉。

### `fulfillment.status`

```text
pending
done
canceled
```

### `bookingBatch.status`

```text
open
closed
archived
```

### `mealSlot.orderStatus`

```text
draft
open
closed
```

`draft` = 还没分享；`open` = 可预订登记；`closed` = 不再接受新增。

## 4. Collections

### `kiv1_sellers`

商家/租户根。MVP 只有桃子。

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | text | 商家名，例如“桃子家” |
| `serviceArea?` | text | 服务范围 |
| `defaultPriceCents` | number | 默认套餐价，桃子=3000 |
| `menuStructure` | json | 默认 `{meat:2, veg:2, soup:1}` |
| `status` | select | active / paused / archived |

索引：

- `status`

### `kiv1_operators`

商家侧登录主体。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `wechatOpenid` | text | operator 的小程序 openid |
| `role` | select | owner / helper |
| `active` | checkbox | 是否可登录 |

索引：

- unique `wechatOpenid`
- `seller`

### `kiv1_customer_profiles`

顾客资料。一条 profile = 一个 openid 下的“称呼 + 地址”绑定资料。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `openid` | text | 顾客在当前小程序下的 openid |
| `displayName` | text | 顾客填的称呼 |
| `address` | text | 送餐地址文本 |
| `label?` | text | 可选标签，如“家”“妈妈家” |
| `lastUsedAt?` | datetime | 最近使用时间 |
| `active` | checkbox | 删除资料时软停用 |

规则：

- 不拆称呼表和地址表，不做自由组合。
- 同一 openid 可有多条 profile。
- 同一地址多人下单也存多条 profile。

索引：

- `(seller, openid, active)`

### `kiv1_offerings`

菜品池。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `name` | text | 菜名 |
| `mainIngredient?` | text | 主料 |
| `category` | select | meat / veg / soup / staple |
| `active` | checkbox | 是否参与菜单生成 |
| `lastUsedAt?` | date | 最近使用 |
| `useCount?` | number | 使用次数 |

规则：

- MVP 不维护口味、配方、采购用量、忌口。
- 停用菜不参与新菜单生成，但历史菜单可继续显示快照。

索引：

- `(seller, active)`
- `(seller, category)`

### `kiv1_menu_plans`

某日期某餐的菜单。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `date` | date | 餐次日期 |
| `occasion` | select | lunch / dinner |
| `items` | array/json | 菜品快照：`offeringId,name,mainIngredient,category` |
| `status` | select | draft / published |
| `generatedAt?` | datetime | 生成时间 |

规则：

- `items` 保存快照，避免菜品改名影响历史菜单。
- `published` 只表示已用于预订登记/分享，不等于微信群已发。

索引：

- unique `(seller, date, occasion)`

### `kiv1_meal_slots`

可预订登记的餐次。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `date` | date | 餐次日期 |
| `occasion` | select | lunch / dinner |
| `menuPlan` | relationship | → `kiv1_menu_plans` |
| `orderStatus` | select | draft / open / closed |
| `orderDeadline?` | datetime | 截止时间 |
| `priceCents?` | number | 本餐价格；空则用 seller 默认价 |

规则：

- `open` 才允许顾客新增/修改 draft 订单。
- `closed` 后不能新增，已有订单保留。

索引：

- unique `(seller, date, occasion)`
- `(seller, orderStatus)`

### `kiv1_booking_batches`

一次分享卡片对应的批次。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `publicId` | text | 分享链接用的随机 id，不用数据库 id |
| `title` | text | 分享标题，例如“7月9日 周四 午餐/晚餐预订” |
| `status` | select | open / closed / archived |
| `sharePath` | text | `/pages/booking/index?batchId=<publicId>` |
| `createdBy` | relationship | → `kiv1_operators` |
| `createdAt` | datetime | 创建时间 |

规则：

- 关闭 batch = 这张分享卡片整体不接受新增订单。
- batch 关闭不取消已有订单。

索引：

- unique `publicId`
- `(seller, status)`

### `kiv1_booking_batch_slots`

批次和餐次的连接表。Payload 里也可以做 batch 内 array，但连接表更好查。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `batch` | relationship | → `kiv1_booking_batches` |
| `mealSlot` | relationship | → `kiv1_meal_slots` |
| `sortOrder?` | number | 展示顺序 |

索引：

- unique `(batch, mealSlot)`
- `(seller, batch)`

### `kiv1_orders`

一个顾客资料 + 一个日期 + 一个餐次的订单。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `customerProfile?` | relationship | → `kiv1_customer_profiles` |
| `openid?` | text | 顾客 openid；手动补单可为空 |
| `date` | date | 餐次日期 |
| `occasion` | select | lunch / dinner |
| `status` | select | draft / confirmed / canceled |
| `source` | select | customer-card / manual / jielong-import |
| `displayName` | text | 称呼快照 |
| `address?` | text | 地址快照，可为空 |
| `quantity` | number | MVP 套餐份数 |
| `unitPriceCents` | number | 单价快照 |
| `totalCents` | number | `quantity * unitPriceCents` |
| `paymentStatus` | select | unpaid / paid |
| `paidAt?` | datetime | 标已付时间 |
| `confirmedAt?` | datetime | 桃子确认时间 |
| `note?` | textarea | 商家备注 |

规则：

- 顾客提交/桃子补单默认 `draft`。
- 桃子确认后 `confirmed`，顾客不能自助改/取消。
- 顾客只能改自己的 `draft` 订单，且 meal slot 未截止/未关闭。
- `confirmed` 才进入备餐总份数、未付、未送口径。
- `canceled` 保留历史，退出经营口径。
- 手动补单可无 openid/customerProfile，但必须有 displayName。
- 接龙导入订单可无 address。

索引：

- `(seller, date, occasion, status)`
- `(seller, openid)`
- unique active 坐标：`seller + customerProfile + date + occasion + status!=canceled`

Payload 不支持 partial unique 时，用 beforeChange hook 检查 active 坐标。

### `kiv1_order_items`

MVP 可以没有独立 items 表，直接在 `orders.quantity` 表示套餐份数。保留本集合是为了以后扩展单品。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `order` | relationship | → `kiv1_orders` |
| `offering?` | relationship | → `kiv1_offerings` |
| `nameSnapshot` | text | 商品名快照，MVP 可为“套餐” |
| `quantity` | number | 数量 |
| `unitPriceCents` | number | 单价快照 |

MVP 若想更懒，可以先不建这张表；但如果 Payload schema 一开始建好，前端仍只用 `orders.quantity`。

### `kiv1_fulfillments`

送达状态。每个 confirmed order 一条。

| 字段 | 类型 | 说明 |
|---|---|---|
| `seller` | relationship | → `kiv1_sellers` |
| `order` | relationship | → `kiv1_orders` |
| `date` | date | 冗余自 order |
| `occasion` | select | 冗余自 order |
| `status` | select | pending / done / canceled |
| `doneAt?` | datetime | 送达时间 |

规则：

- order confirmed 时创建 fulfillment。
- order canceled 时 fulfillment → canceled。
- 缺口只统计 pending。

索引：

- unique `order`
- `(seller, date, occasion, status)`

## 5. 写侧状态机

### 顾客提交

```text
customer submits profile + meal quantities
  → upsert customer_profile
  → upsert draft order per selected meal slot
```

守卫：

- batch 必须 open。
- meal slot 必须 open。
- 未过 deadline。
- 只能写当前 openid 的 profile/order。

### 顾客修改

```text
draft order + slot open + before deadline
  → update quantity
```

数量改为 0 走 cancel，必须二次确认。

### 商家确认

```text
draft order
  → confirmed
  → create fulfillment pending
```

确认后锁单，顾客不能自助改/取消。

### 商家取消

```text
order
  → canceled
  → fulfillment canceled
```

### 标已付

```text
paymentStatus unpaid ↔ paid
```

不影响订单状态和送达状态。

### 标已送

```text
fulfillment pending ↔ done
```

不影响付款状态。

## 6. 读侧派生

不落表，后端/前端按需派生：

- 餐次总份数：confirmed orders 的 `quantity` 求和。
- 未付数：confirmed + unpaid。
- 未送数：fulfillment pending。
- 顾客“我的订单”：`seller + openid`。
- 商家订单列表：`seller + date + occasion`，按 address 字符串排序。

## 7. Access 规则

### 商家 operator

- 读写自己 `seller` 下全部 v1 业务数据。
- 不允许跨 seller。

### 顾客 customer session

- 可读 open batch/slot/menu 的必要公开字段。
- 可读写自己 `seller + openid` 下的 profiles。
- 可读自己 `seller + openid` 下的 orders。
- 只能改 draft 且未截止/未关闭的自己的 order。
- 不能确认、标已付、标已送。

### 未登录/无 session

- 只能访问健康检查。
- 分享页面启动后必须先换 customer session。

## 8. 审核兜底：接龙导入

如果顾客侧预订登记审核不可行，启用老板侧接龙导入。

临时数据不用单独落表：

1. `POST /merchant/jielong/preview` 返回解析结果。
2. 桃子确认。
3. `POST /merchant/jielong/commit` 写 `orders`，source=`jielong-import`。

规则：

- 解析日期、餐次、顾客名、份数。
- 地址可为空。
- 地址为空不创建/更新 customer_profile。
- 订单仍是 `draft`，桃子确认后锁单。

## 9. 最小索引清单

- `kiv1_operators.wechatOpenid` unique
- `kiv1_customer_profiles (seller, openid, active)`
- `kiv1_offerings (seller, active, category)`
- `kiv1_menu_plans (seller, date, occasion)` unique
- `kiv1_meal_slots (seller, date, occasion)` unique
- `kiv1_booking_batch_slots (batch, mealSlot)` unique
- `kiv1_orders (seller, date, occasion, status)`
- `kiv1_orders (seller, openid)`
- `kiv1_fulfillments.order` unique
- `kiv1_fulfillments (seller, date, occasion, status)`
