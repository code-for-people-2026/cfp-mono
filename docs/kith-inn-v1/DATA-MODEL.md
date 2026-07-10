# 数据模型：街坊味 v1（kith-inn-v1）

> 状态：草稿 v0.2
>
> 日期：2026-07-10
>
> 原则：参考旧 `kith-inn` 的建模经验，但 v1 使用自己的 collection、schema、hooks、类型和业务代码。禁止从旧 `@cfp/kith-inn-*` 包 import。

## 1. 运行与命名边界

v1 与旧 kith-inn 共用 `apps/cms` Payload 实例和 PostgreSQL `cms` schema，以减少 ECS 常驻进程。隔离依靠 `kiv1_` collection/table/API slug 前缀。

```text
kiv1_sellers
kiv1_operators
kiv1_customer_profiles
kiv1_offerings
kiv1_meal_slots
kiv1_booking_batches
kiv1_orders
```

MVP 只维护以上七个业务 collection。Payload 为 array/relationship 自动生成的底层关系表不视为业务 collection，也不由业务代码直接读写。

v1 collection 不引用旧 `sellers/operators/customers/...`。共享 Payload Admin 继续由旧 `operators` 登录；`kiv1_operators` 仅表示 v1 产品身份。

## 2. 关系总览

```text
kiv1_seller
├── kiv1_operators
├── kiv1_customer_profiles
├── kiv1_offerings
├── kiv1_meal_slots
├── kiv1_booking_batches ── has many kiv1_meal_slots
└── kiv1_orders ── kiv1_meal_slot
                  └── kiv1_customer_profile (接龙兜底时可空)
```

核心流：

1. 桃子维护 `kiv1_offerings`。
2. 系统把某日某餐的菜单快照写进 `kiv1_meal_slots.menuItems`。
3. 桃子选择多个 meal slots 生成 `kiv1_booking_batches` 并分享。
4. 顾客选择/新增 profile，按 meal slot 提交 order。
5. 桃子确认 order 后进入备餐、收款、送达口径。

## 3. 通用规则

- Payload 自带 `id`、`createdAt`、`updatedAt`，不重复声明。
- 除 `kiv1_sellers` 外，每个 collection 都有必填 `seller` relationship 和索引。
- 所有 v1 relationship 只能指向 `kiv1_` collection。
- 关系写入时，以 `data.seller` 或更新前原记录 seller 作为有效 seller，逐项校验目标记录属于同一 seller。
- 共享 Payload Admin 是可信运维面；未认证请求直接访问 v1 collection 时默认 deny。
- 后续产品 internal route 使用 `overrideAccess` 时，必须从已验证 v1 JWT 推导 seller/openid，并显式做 owner、状态机和关系校验。
- MVP 所有 seller 共用一个小程序 AppID；若未来接入多个 AppID，operator/profile/order 身份坐标必须增加 appId。
- 日历日保存为合法 `YYYY-MM-DD` 文本并按 Asia/Shanghai 解释；真实时刻保存带时区 datetime。
- 金额统一为整数分；份数统一为正整数。
- seller 永不物理删除；历史相关实体优先停用或改状态。

## 4. 枚举

### `sellerStatus`

```text
active
paused
```

### `occasion`

```text
lunch
dinner
```

### `offeringCategory`

```text
meat
veg
soup
```

MVP 菜单结构为 2 荤 2 素 1 汤，不预建未使用的 staple 类别。

### `mealSlotOrderStatus`

```text
draft
open
closed
```

### `bookingBatchStatus`

```text
open
closed
archived
```

### `orderStatus`

```text
draft
confirmed
canceled
```

### `orderSource`

```text
customer-card
manual
jielong-import
```

### `paymentStatus`

```text
unpaid
paid
```

### `deliveryStatus`

```text
pending
done
```

order canceled 已表达履约作废，不再给 deliveryStatus 增加 canceled 状态。

## 5. Collections

### `kiv1_sellers`

v1 商家/租户根。MVP 只有桃子，但不复用旧 seller。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `name` | text | 必填，trim，1-80 字符 |
| `defaultPriceCents` | number | 必填，非负整数，默认 3000 |
| `status` | select | 必填，默认 active |

访问：

- 未认证 deny；共享 CMS 已认证 Admin 可读写。
- delete 永远 deny；seed 使用受控 local API 初始化。

索引：

- `status`

### `kiv1_operators`

v1 商家侧产品身份，不是 Payload Admin user。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `wechatOpenid` | text | 必填；与 seller 组成复合 unique，Admin 列表不完整展示 |
| `active` | checkbox | 必填，默认 true |

规则：

- 不设置 `auth: true`，不生成 email/password。
- 一条 operator 记录表示“某 openid 在某 seller 的成员资格”；同一 openid 可以管理多个 seller。
- 后续 v1 backend 用 code2Session 得到 openid：只命中一个 seller 时直接签发 JWT，命中多个时先选择 seller。
- 同一 openid 也可以绑定 customer profile；operator/customer 由 session role 区分。
- MVP 只有 owner 行为，不维护尚无权限差异的 role 字段。

索引：

- unique `(seller, wechatOpenid)`
- `seller`

### `kiv1_customer_profiles`

一条 profile = 一个不可拆分的“称呼 + 地址”。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `openid` | text | 可空，indexed；只由已验证顾客会话写入/绑定 |
| `displayName` | text | 必填，trim，1-80 字符 |
| `address` | text | 必填，trim，1-240 字符 |
| `lastUsedAt` | datetime | 可空，用于历史资料排序 |
| `active` | checkbox | 必填，默认 true；删除资料时软停用 |

规则：

- 顾客自己创建 profile 时 openid 必须等于 customer JWT openid。
- 桃子为私聊顾客创建 profile 时 openid 可以为空。
- 顾客只能读取 `seller + 当前 openid + active=true` 的 profile。
- 不按相同称呼或地址自动绑定 openid。
- 无 openid profile 未来只能经显式认领/合并绑定；MVP 允许顾客新建一条自己的 profile，旧手动资料继续只在商家侧可见。
- 同一 openid 可有多条 profile；同一地址可被多人分别保存。
- profile 修改/停用不影响历史订单快照。

索引：

- `(seller, openid, active)`

### `kiv1_offerings`

菜单候选菜品。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `name` | text | 必填，trim，1-80 字符 |
| `mainIngredient` | text | 可空，trim，最多 80 字符 |
| `category` | select | 必填：meat / veg / soup |
| `active` | checkbox | 必填，默认 true |

规则：

- 停用菜不参与新菜单生成。
- meal slot 保存菜品快照，后续菜品改名/停用不影响历史菜单。
- 不存 `lastUsedAt/useCount`；生成菜单时从历史 meal slots 查询实际使用记录。

索引：

- unique `(seller, name)`
- `(seller, active, category)`

### `kiv1_meal_slots`

某个上海日历日的午餐或晚餐，同时承载菜单快照和预订控制。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `date` | text | 必填，合法 `YYYY-MM-DD` |
| `occasion` | select | 必填：lunch / dinner |
| `menuItems` | array | 可空；菜单快照，结构见下表 |
| `orderStatus` | select | 必填，默认 draft |
| `orderDeadline` | datetime | 可空；open 前必须设置且晚于当前时间 |
| `priceCents` | number | 可空；下单时为空则用 seller 默认价格 |
| `generatedAt` | datetime | 可空；生成/重新生成菜单时更新 |

`menuItems` 每项：

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `offering` | relationship | 必填 → `kiv1_offerings` |
| `nameSnapshot` | text | 必填 |
| `mainIngredientSnapshot` | text | 可空 |
| `categorySnapshot` | select | 必填 |

规则：

- unique `(seller, date, occasion)`。
- menuItems offering 必须与 slot 同 seller；关系守卫必须遍历嵌套数组。
- open 才接受顾客新增/修改 draft order；closed 保留已有订单。
- 被任一 batch 引用后重新生成菜单，业务层必须二次确认。

索引：

- unique `(seller, date, occasion)`
- `(seller, orderStatus)`

### `kiv1_booking_batches`

一次分享卡片选择的一组餐次。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `publicId` | text | 必填，全局 unique，不可顺序猜测 |
| `title` | text | 必填，1-120 字符 |
| `status` | select | 必填，默认 open |
| `mealSlots` | relationship hasMany | 必填，至少 1 个 → `kiv1_meal_slots` |
| `createdBy` | relationship | 必填 → `kiv1_operators` |

规则：

- batch、mealSlots、createdBy 必须属于同一 seller。
- `sharePath` 不落库；由 `/pages/booking/index?batchId=<publicId>` 派生。
- batch closed/archived 不取消已有订单。
- 关闭 batch 只关闭该分享入口；关闭 meal slot 会影响引用它的所有 batch。

索引：

- unique `publicId`
- `(seller, status)`

### `kiv1_orders`

一个顾客资料在一个 meal slot 的套餐预订记录；接龙兜底可没有 profile。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `mealSlot` | relationship | 必填 → `kiv1_meal_slots` |
| `customerProfile` | relationship | 可空 → `kiv1_customer_profiles`；仅 jielong import 可空 |
| `customerOpenid` | text | 可空，indexed；订单顾客可见身份快照 |
| `status` | select | 必填，默认 draft |
| `source` | select | 必填 |
| `displayName` | text | 必填，称呼快照 |
| `address` | text | 可空，地址快照 |
| `quantity` | number | 必填，正整数 |
| `unitPriceCents` | number | 必填，非负整数 |
| `paymentStatus` | select | 必填，默认 unpaid |
| `paidAt` | datetime | 可空，与 paymentStatus 一致 |
| `deliveryStatus` | select | 必填，默认 pending |
| `deliveredAt` | datetime | 可空，与 deliveryStatus 一致 |
| `confirmedAt` | datetime | 可空，与 confirmed 状态一致 |
| `canceledAt` | datetime | 可空，与 canceled 状态一致 |
| `note` | textarea | 可空，最多 1000 字符 |

规则：

- unique `(seller, mealSlot, customerProfile)`；PostgreSQL 对 null 的语义允许多条无 profile 接龙记录。
- profile 非空的常规订单永远复用同一记录，避免重复提交和并发重复。
- canceled 后重新登记时复用记录，显式回到 draft 并清理 canceledAt。
- 顾客卡片订单必须同时有 customerProfile 和 customerOpenid，且 profile.openid 等于 customerOpenid。
- 手动订单应创建/选择 profile；profile 无 openid 时 customerOpenid 为空，订单只在商家侧可见。
- jielong import 可以没有 profile/address；其幂等规则在兜底 milestone 定义。
- `totalCents = quantity * unitPriceCents` 读时派生，不落库。
- 顾客“我的订单”只按 `seller + customerOpenid` 查询，不按名称或地址匹配。

索引：

- unique `(seller, mealSlot, customerProfile)`
- `(seller, mealSlot, status)`
- `(seller, customerOpenid)`

## 6. 写侧状态机

### 顾客提交

```text
verified customer JWT
  + open booking batch
  + open meal slot before deadline
  + profile.openid == JWT.openid
  → upsert one draft order by seller + mealSlot + customerProfile
```

数量改为 0 走 cancel，必须二次确认。

### 顾客修改/取消

```text
own draft order + slot open + before deadline
  → update quantity | canceled
```

confirmed、canceled、slot closed 或已过 deadline 都拒绝顾客修改。

### 商家确认

```text
draft → confirmed
confirmedAt = now
deliveryStatus = pending
```

确认后顾客锁单；订单进入备餐、未付、未送口径。

### 商家取消

```text
draft | confirmed → canceled
canceledAt = now
```

canceled 退出经营口径；付款/送达历史字段保留供查看。

### 标已付

```text
unpaid → paid + paidAt
paid → unpaid + paidAt=null
```

不影响订单确认和送达状态。

### 标已送

```text
confirmed + pending → done + deliveredAt
confirmed + done → pending + deliveredAt=null
```

不影响付款状态；draft/canceled 不允许标已送。

## 7. 读侧派生

不落表：

- 分享路径：固定 booking route + batch publicId。
- 订单总价：quantity × unitPriceCents。
- 餐次总份数：confirmed orders 的 quantity 求和。
- 未付：confirmed + unpaid。
- 未送：confirmed + deliveryStatus pending。
- 顾客“我的订单”：seller + customerOpenid。
- 商家订单列表：先按 date/occasion 找 meal slot，再按 seller + mealSlot 查询，按 address 字符串排序。
- 菜品近期使用：从历史 mealSlots.menuItems 查询。

## 8. Access 与共享 CMS 边界

### 共享 Payload Admin

- `apps/cms.admin.user` 仍是旧 `operators`。
- 已认证 Admin 是可信运维身份，可检查所有 v1 seller 数据。
- 上一条只适用于单 v1 seller 的 M0；第二个 seller 上线前必须引入明确的平台管理员边界或关闭共享 Admin 的 v1 全局访问。
- 未认证 Payload collection 请求默认 deny。
- `kiv1_operators` 不提供 Payload 登录，不与旧 operator 建 relationship。

### V1 operator session

- v1 backend 验证微信 code 后按 `kiv1_operators.wechatOpenid` 查询 seller memberships；多条时先选择 seller。
- operator JWT 只能访问 claims.sellerId。
- CMS internal route 使用 `overrideAccess` 时必须重新验证 JWT、目标 seller 和关系 owner。

### V1 customer session

- customer JWT 只含由 batch 解析的 sellerId 和 code2Session 得到的 openid。
- profile 读写按 seller + openid；order 读取按 seller + customerOpenid。
- 只能修改自己的 draft order，且 slot open、未截止。
- 不能确认、标已付、标已送。

### 未登录

- 只能访问健康检查和换取 session 所需的受限入口。
- 分享页必须先建立 customer session，再拉取 batch/profile/order 数据。

## 9. 审核兜底：接龙导入

如果顾客侧预订登记无法上线，启用老板侧接龙导入：

1. preview 解析日期、餐次、顾客名、份数，不落库。
2. 桃子确认后写 `kiv1_orders`，source=`jielong-import`。
3. 地址可空；地址为空时不创建/更新 customer profile。
4. order 仍为 draft，桃子确认后锁单。
5. 无 profile 订单的导入幂等键在该 milestone 定义，不在 M0 预建字段。

## 10. 最小索引清单

- `kiv1_operators (seller, wechatOpenid)` unique
- `kiv1_customer_profiles (seller, openid, active)`
- `kiv1_offerings (seller, name)` unique
- `kiv1_offerings (seller, active, category)`
- `kiv1_meal_slots (seller, date, occasion)` unique
- `kiv1_meal_slots (seller, orderStatus)`
- `kiv1_booking_batches.publicId` unique
- `kiv1_booking_batches (seller, status)`
- `kiv1_orders (seller, mealSlot, customerProfile)` unique
- `kiv1_orders (seller, mealSlot, status)`
- `kiv1_orders (seller, customerOpenid)`

这些都是普通复合索引，不需要 partial predicate；优先用 Payload collection indexes 表达，不给共享 `apps/cms.onInit` 增加 v1 SQL。
