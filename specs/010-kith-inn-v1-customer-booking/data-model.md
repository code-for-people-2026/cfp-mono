# 数据模型：街坊味 v1 顾客预订登记

## 1. 结论

M2 复用 M0 已建立的七个 `kiv1_` collection，不新增 collection、字段、索引、数据库、进程或 workspace。M2 的持久化需求已经由 `kiv1_meal_slots`、`kiv1_booking_batches`、`kiv1_customer_profiles` 和 `kiv1_orders` 覆盖；本阶段只补 API contract、领域校验和界面。

## 2. 既有持久化实体

### 2.1 MealSlot（餐次）

M2 使用以下既有字段：

| 字段 | 用途 | M2 约束 |
|---|---|---|
| `seller` | tenant owner | 必须等于当前 operator/customer session 的 seller |
| `date`、`occasion` | 餐次标识 | 沿用 `(seller,date,occasion)` 唯一约束 |
| `menuItems` | 五道菜快照 | `open` 前必须恰好五项 |
| `orderStatus` | `draft/open/closed` | 只有 `open` 可接受顾客写入 |
| `orderDeadline` | 截止时间 | `open` 前必须存在且晚于当前时间；截止后拒绝顾客写入 |
| `priceCents` | 餐次单价 | 可空；空时读取 seller 的 `defaultPriceCents` |
| `generatedAt` | 菜单生成时间 | 沿用 M1 语义 |

配置状态转换：

```text
draft ──开放──> open ──关闭──> closed
  └────────────关闭──────────> closed
closed 不在 M2 重新开放
```

`open` 转换由 BE 验证完整菜单、有效截止时间和 seller 归属；CMS 只执行白名单更新及关系 guard。

### 2.2 BookingBatch（预订批次）

| 字段 | 用途 | M2 约束 |
|---|---|---|
| `seller` | tenant owner | 由 operator session 注入 |
| `publicId` | 分享入口稳定标识 | BE 生成 UUID；不接受客户端指定 |
| `title` | 顾客页标题 | 1–120 字；未提供时由 BE 根据餐次生成 |
| `status` | `open/closed/archived` | M2 创建为 `open`，界面只提供 `closed` 动作 |
| `mealSlots` | 分享的餐次集合 | 1–20 个去重餐次；创建时均须 seller-owned、`open` 且未截止 |
| `createdBy` | 创建 operator | 由 operator session 注入 |

关闭 batch 只关闭该分享入口，不修改其中餐次。关闭餐次会让包含它的所有 batch 都不能再对该餐次写入。`archived` 为既有数据状态，M2 可只读兼容但不提供归档动作。

### 2.3 CustomerProfile（顾客资料）

| 字段 | 用途 | M2 约束 |
|---|---|---|
| `seller` | tenant owner | 来自 customer JWT，不接受客户端指定 |
| `openid` | 微信身份 owner | 来自已验证 customer JWT，不返回给 FE |
| `displayName`、`address` | 常用登记资料 | 创建时保存；历史订单不跟随修改 |
| `lastUsedAt` | 最近使用时间 | 成功用于登记后更新 |
| `active` | 可否用于新登记 | 列表只返回 active；停用为软删除 |

同一微信可为同一 seller 保存多份 active profile。编辑某次登记的姓名或地址只改变订单快照；选择“保存为新资料”时创建新 profile，不覆盖旧 profile。

### 2.4 Order（订单）

M2 顾客卡片订单使用既有字段：

| 字段 | 顾客登记语义 |
|---|---|
| `seller` | customer JWT 绑定的 seller |
| `mealSlot` | 当前 open batch 中的餐次 |
| `customerProfile` | 当前微信拥有且 active 的 profile |
| `customerOpenid` | 已验证 customer JWT 的 openid；订单 owner 的唯一依据 |
| `source` | 固定为 `customer-card` |
| `displayName`、`address` | 提交时快照 |
| `quantity` | 正整数 |
| `unitPriceCents` | 提交时解析后的餐次价或 seller 默认价快照 |
| `status` | 首次为 `draft`；顾客只可改 draft、显式重登记 canceled |
| `paymentStatus`、`deliveryStatus` | 首次分别为 `unpaid`、`pending` |
| 时间字段 | 首次均空；重登记 canceled 时清理确认、取消、付款、送达时间 |

既有唯一约束 `(seller,mealSlot,customerProfile)` 定义同一 profile 对同一餐次只有一条订单。批量提交按餐次逐项处理，不做跨项事务：

- 不存在：创建 `draft/customer-card`；
- 已有 `draft`：更新同一 id 的份数、资料和价格快照；
- 已有 `canceled` 且请求显式确认：重置同一 id 为 draft；
- 已有 `confirmed`，或 canceled 未确认：该项失败；
- 一项失败不回滚其他项。

顾客修改或取消前，BE 必须同时验证：订单属于当前 `seller + customerOpenid`、当前入口 batch 为 open 且包含该餐次、餐次为 open、截止时间未到、订单仍为 draft。确认订单永远拒绝顾客写入。

## 3. 非持久化模型

### 3.1 CustomerSessionClaims

```text
kind: "customer"
sellerId: relationship id
openid: non-empty string
role: "customer"
iat: unix seconds
exp: unix seconds (iat + 7 days)
```

customer JWT 不保存 batch id；同一 seller 的另一有效 batch 可复用 session。每次入口读取和写入仍按 `publicId` 校验 batch seller 与状态。

### 3.2 BookingBatchView

由 BE 从 seller、batch 和 slots 派生，不落库：

- `sharePath = /pages/booking/index?batch=<publicId>`；
- seller name、batch title/status；
- 每个 slot 的 `date`、`occasion`、菜单、解析后价格、deadline；
- `canBook` 与不可登记原因（batch closed、slot closed、deadline passed）；
- 不返回 seller id、openid、createdBy 等内部字段。

### 3.3 PublicMealSlotTarget

顾客登记请求与逐项结果共用的非持久化公开坐标：

```text
target.date: YYYY-MM-DD
target.occasion: lunch | dinner
```

同一 seller 的日期 + 餐次受既有唯一约束保护；BE 仍必须把坐标限定在请求的 `batchPublicId` 内唯一解析，并用解析后的内部 meal-slot ID 调用 CMS。客户端不能提交该内部 ID，逐项结果也不能用它作为页面关联字段。

### 3.4 ReservationSubmitResult

每个输入公开 target 返回一个 discriminated result：`created`、`updated`、`resubmitted` 或 `failed`。成功项返回既有鉴权后订单摘要，失败项返回稳定错误码和中文消息；每项顶层回显同一公开 target，响应顺序与去重后的输入顺序一致，UI 不依赖订单摘要中的关系 ID。

## 4. Tenant 与关系不变量

1. operator/customer 均只能读取当前 session seller 的数据。
2. batch 的 `mealSlots`、`createdBy` 必须与 batch 同 seller。
3. order 的 `mealSlot`、`customerProfile` 必须与 order 同 seller。
4. customer profile 必须同时匹配 customer JWT 的 `sellerId + openid`。
5. customer order owner 必须同时匹配 `seller + customerOpenid`；称呼、地址和 profile id 都不能替代 openid owner 判断。
6. 客户端不得提交或覆盖内部 meal-slot ID、seller、openid、source、状态轴或服务端时间戳。

## 5. 数据迁移与兼容

M2 没有 schema migration。旧 M1 手工订单保持 `source=manual` 且 `customerOpenid=null`，不会出现在顾客“我的预订”中；商家订单列表继续同时显示 manual 和 customer-card。现有 seed 只需在测试场景中通过公开 API 创建餐次、batch、profile 和 order，不改变独立幂等的桃子 seller/operator seed。
