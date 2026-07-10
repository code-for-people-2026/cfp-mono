# 数据模型：kith-inn-v1 共享 CMS 骨架与数据层

## 总览

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

M0 只有七个 v1 collection。它们与旧 kith-inn collections 一起装配在 `apps/cms`，全部落入 PostgreSQL `cms` schema；`kiv1_` 前缀同时隔离 Payload slug、REST 路径和数据库表名。

## 通用规则

- Payload 自带 `id`、`createdAt`、`updatedAt`，不重复声明。
- 除 `kiv1_sellers` 外，每个 v1 collection 都有必填 `seller` relationship 和索引。
- 所有 v1 relationship 只能指向 `kiv1_` collection，写入前校验目标 seller 一致。
- Payload Admin 已认证用户是共享 host 的可信运维身份；未认证 collection 请求默认拒绝。
- 共享 Admin 的 v1 全局访问只适用于单 v1 seller 的 M0；第二个 seller 上线前必须引入明确的平台管理员边界或关闭该访问。
- 后续产品 internal route 使用 `overrideAccess` 时，必须从已验证的 v1 JWT 写入 seller/openid，不能信任请求体。
- MVP 的全部 seller 共用一个小程序 AppID；未来接入多个 AppID 时，operator/profile/order 身份坐标必须增加 appId。
- 删除 seller 永远禁止；历史相关实体优先停用或改状态，不做级联物理删除。
- `date` 是合法 `YYYY-MM-DD`，按 Asia/Shanghai 解释；金额使用整数分，份数使用正整数。

## 枚举

```text
sellerStatus: active | paused
occasion: lunch | dinner
offeringCategory: meat | veg | soup
mealSlotOrderStatus: draft | open | closed
bookingBatchStatus: open | closed | archived
orderStatus: draft | confirmed | canceled
orderSource: customer-card | manual | jielong-import
paymentStatus: unpaid | paid
deliveryStatus: pending | done
```

## `kiv1_sellers`

v1 商家/租户根，不复用旧 `sellers`。

| 字段 | 类型 | 约束 |
|---|---|---|
| `name` | text | 必填，trim，1-80 字符 |
| `defaultPriceCents` | number | 必填，非负整数，默认 3000 |
| `status` | select | 必填，默认 `active` |

访问规则：

- 未认证 deny；共享 CMS 已认证 Admin 可读写。
- delete 永远 deny；seed 使用受控 local API 初始化。

## `kiv1_operators`

v1 商家侧产品身份。它不是 Payload Admin user，也不复用旧 `operators` 记录。

| 字段 | 类型 | 约束 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers`，indexed |
| `wechatOpenid` | text | 必填；与 seller 组成复合 unique，Admin 列表不完整展示 |
| `active` | checkbox | 必填，默认 true |

规则：

- 不设置 `auth: true`，不生成 email/password 字段。
- 一条记录表示“某 openid 在某 seller 的成员资格”；同一 openid 可以管理多个 seller。
- 后续 `wx.login` 由 v1 backend 按 wechatOpenid 查询有效 memberships：只有一个 seller 时直接进入，多个 seller 时先选择，再签发只包含该 sellerId 的 v1 JWT。
- 同一 openid 也可以绑定 customer profile；operator/customer 由当前入口和 session role 区分。
- M0 只有 owner 行为，不创建没有权限差异的 role 枚举。

索引：

- unique `(seller, wechatOpenid)`。

## `kiv1_customer_profiles`

一条 profile 是不可拆分的“称呼 + 地址”。

| 字段 | 类型 | 约束 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `openid` | text | 可空，indexed；仅由已验证顾客会话创建/绑定 |
| `displayName` | text | 必填，trim，1-80 字符 |
| `address` | text | 必填，trim，1-240 字符 |
| `active` | checkbox | 必填，默认 true |
| `lastUsedAt` | datetime | 可空，仅用于历史资料排序 |

规则：

- 桃子为私聊顾客创建的 profile 可以没有 openid。
- 顾客 API 只能读取 `seller + 当前 openid + active=true` 的 profile。
- 不按相同称呼或地址自动绑定 openid。
- 无 openid profile 未来只能经显式认领/合并绑定；MVP 允许顾客另建一条 openid-bound profile，旧手动资料继续只在商家侧可见。
- “删除资料”把 active 设为 false；历史订单快照不变。
- M0 不做 profile 去重；同一地址可被多人分别保存。

索引：

- `(seller, openid, active)` 普通查询索引。

## `kiv1_offerings`

菜单候选菜品。

| 字段 | 类型 | 约束 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `name` | text | 必填，trim，1-80 字符 |
| `mainIngredient` | text | 可空，trim，最多 80 字符 |
| `category` | select | 必填：meat / veg / soup |
| `active` | checkbox | 必填，默认 true |

规则：

- 停用菜不参与新菜单生成。
- meal slot 保存菜单快照，后续改名/停用不影响历史显示。
- M0 不存 `lastUsedAt`、`useCount`；生成时从历史 meal slots 查询。

索引：

- unique `(seller, name)`。
- `(seller, active, category)` 普通查询索引。

## `kiv1_meal_slots`

某个日期的午餐或晚餐，同时承载菜单和预订控制。

| 字段 | 类型 | 约束 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `date` | text | 必填，合法 `YYYY-MM-DD` |
| `occasion` | select | 必填：lunch / dinner |
| `menuItems` | array | 可空；每项见下表 |
| `orderStatus` | select | 必填，默认 `draft` |
| `orderDeadline` | datetime | 可空；open 前必须存在且晚于当前时间 |
| `priceCents` | number | 可空；下单时空值回退 seller 默认价 |
| `generatedAt` | datetime | 可空；生成/重新生成菜单时更新 |

`menuItems` 每项：

| 字段 | 类型 | 约束 |
|---|---|---|
| `offering` | relationship | 必填 → `kiv1_offerings` |
| `nameSnapshot` | text | 必填 |
| `mainIngredientSnapshot` | text | 可空 |
| `categorySnapshot` | select | 必填 |

规则：

- unique `(seller, date, occasion)`。
- menuItems 内的 offering 必须与 slot 同 seller；关系守卫必须遍历嵌套数组。
- `open` 才接受顾客新增/修改 draft 订单；`closed` 保留已有订单。
- 已被 batch 引用的 slot 重新生成菜单时，后续业务层必须二次确认。

## `kiv1_booking_batches`

一次分享所选择的一组餐次。

| 字段 | 类型 | 约束 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `publicId` | text | 必填，全局 unique，不可顺序猜测 |
| `title` | text | 必填，1-120 字符 |
| `status` | select | 必填，默认 `open` |
| `mealSlots` | relationship hasMany | 必填，至少 1 个 → `kiv1_meal_slots` |
| `createdBy` | relationship | 必填 → `kiv1_operators` |

规则：

- batch、meal slots、createdBy 必须属于同一 v1 seller。
- `sharePath` 不落库；由固定 route + publicId 生成。
- batch closed/archived 不删除或取消已有订单。
- 任意状态的现存 batch 后续都可用于解析 customer session 的 seller；closed/archived 不接受新订单，但不阻断顾客读取自己的历史订单。
- M0 不实现 publicId 生成和分享动作，只保证字段/唯一约束。

## `kiv1_orders`

一个顾客资料在一个 meal slot 的套餐预订记录；接龙兜底可没有 profile。

| 字段 | 类型 | 约束 |
|---|---|---|
| `seller` | relationship | 必填 → `kiv1_sellers` |
| `mealSlot` | relationship | 必填 → `kiv1_meal_slots` |
| `customerProfile` | relationship | 可空 → `kiv1_customer_profiles`；仅 jielong import 可空 |
| `customerOpenid` | text | 可空，indexed；订单可见身份快照 |
| `status` | select | 必填，默认 `draft` |
| `source` | select | 必填 |
| `displayName` | text | 必填，称呼快照 |
| `address` | text | 可空，地址快照 |
| `quantity` | number | 必填，正整数 |
| `unitPriceCents` | number | 必填，非负整数 |
| `paymentStatus` | select | 必填，默认 `unpaid` |
| `paidAt` | datetime | 可空，与 paymentStatus 一致 |
| `deliveryStatus` | select | 必填，默认 `pending` |
| `deliveredAt` | datetime | 可空，与 deliveryStatus 一致 |
| `confirmedAt` | datetime | 可空，与 confirmed 状态一致 |
| `canceledAt` | datetime | 可空，与 canceled 状态一致 |
| `note` | textarea | 可空，最多 1000 字符 |

规则：

- unique `(seller, mealSlot, customerProfile)`；profile 非空的常规订单复用同一记录。
- 顾客卡片订单必须同时有 customerProfile 和 customerOpenid，且 profile.openid 等于 customerOpenid。
- 桃子手动订单应创建/选择 profile；profile 无 openid 时，订单 customerOpenid 为空且只在商家侧可见。
- jielong import 可以没有 profile/address；导入幂等规则在兜底 milestone 定义。
- `totalCents = quantity * unitPriceCents` 读时派生，不落库。
- 顾客“我的订单”按 `seller + customerOpenid` 查询，不能按名称或地址匹配。

索引：

- unique `(seller, mealSlot, customerProfile)`。
- `(seller, mealSlot, status)`。
- `(seller, customerOpenid)`。

## 状态迁移

### Order

```text
draft ──confirm──> confirmed
  │                   │
  └────cancel─────────┴──> canceled

canceled ──explicit resubmit before deadline──> draft
```

- confirmed 后顾客不可改/取消；M0 只定义状态，不实现动作。
- canceled 重下复用同一 profile + slot 记录，显式重置为 draft，并清理 canceledAt。
- paymentStatus 和 deliveryStatus 是独立轴，但 canceled order 不进入未付/未送统计。
- deliveryStatus 只在 confirmed order 上允许 pending ↔ done。

### Booking batch

```text
open -> closed -> archived
```

### Meal slot

```text
draft -> open -> closed
```

closed 是否允许重新 open 在预订登记 milestone 决定；M0 不提供动作。

## 派生值

- 分享路径：`/pages/booking/index?batchId=<publicId>`。
- 订单总价：`quantity * unitPriceCents`。
- 餐次总份数：confirmed orders 的 quantity 求和。
- 未付：confirmed + unpaid。
- 未送：confirmed + deliveryStatus pending。
- 菜品近期使用：从历史 `kiv1_meal_slots.menuItems` 查询，不在 offering 冗余计数。
