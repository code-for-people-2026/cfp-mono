# 数据模型：街坊味 v1 顾客预订登记与 MVP 收口

## 1. 结论

M2～M4 复用 M0 已建立的七个 `kiv1_` collection，不新增 collection、字段、索引、数据库、进程或 workspace。接龙兜底使用 `kiv1_orders` 已预留的 nullable profile/address 与 `jielong-import` source；顾客数据控制复用 profile 软停用和 own-order 读取。

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

M3 接龙订单沿用同一实体，但使用以下受限组合：

| 字段 | 接龙导入语义 |
|---|---|
| `seller`、`mealSlot` | 来自 operator session 与服务端日期/餐次唯一解析 |
| `customerProfile`、`customerOpenid`、`address` | 固定为空；不得创建或更新 profile |
| `source` | 固定为 `jielong-import` |
| `displayName`、`quantity`、价格 | 来自 strict parser 与服务端餐次价格快照 |
| `note` | CMS 保存 86 字符内部导入标记与最多 914 字符可见备注；对外 DTO 必须剥离内部标记 |

内部导入标记固定为 `__kiv1_jielong:<64 位 previewHash>:<5 位零填充原始行号>\n`，共 86 个 ASCII 字符。CMS create 在写入前按 seller、mealSlot 与标记查找既有订单；顺序网络重试返回既有记录。`kiv1_orders.note` 的总上限仍为 1,000，故导入订单可见备注最多 914 字符，CMS 必须覆盖 914 接受、915 拒绝；manual/customer-card 仍可使用 1,000 字符。商家修改导入订单 note 时必须保留内部前缀，normalize 只对 `jielong-import` 剥离它。该方案不提供并发唯一约束；若需要并发导入或强唯一性，必须新增独立迁移设计。

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

### 3.5 JielongPreview

接龙 parser 输出不落库的 canonical model：日期、午餐/晚餐、按原始数据行排序的 `lineNumber/displayName/quantity`，且至少包含一个、最多一百个数据行。BE 在当前 seller 下唯一解析 meal slot、补服务端价格，以 seller、餐次身份、当前单价和 canonical input 的 SHA-256 作为 `previewHash`。commit 重新执行同一解析并先检查 supplied hash 的全部行标记；只有全部 marker 命中且既有 seller/slot/lineNumber/displayName/quantity 快照逐行等于本次解析结果，才直接返回 `existing`，不一致则按 hash mismatch 拒绝。存在 marker 缺口时才读取当前价格和重算 hash，价格变化则零新增并要求重新预览。不保存 preview session，也不把顾客登记的 batch/status/deadline 当作接龙导入门禁。

## 4. Tenant 与关系不变量

1. operator/customer 均只能读取当前 session seller 的数据。
2. batch 的 `mealSlots`、`createdBy` 必须与 batch 同 seller。
3. order 的 `mealSlot`、`customerProfile` 必须与 order 同 seller。
4. customer profile 必须同时匹配 customer JWT 的 `sellerId + openid`。
5. customer order owner 必须同时匹配 `seller + customerOpenid`；称呼、地址和 profile id 都不能替代 openid owner 判断。
6. 顾客 reservation 请求不得提交内部 meal-slot ID；所有顾客请求均不得提交或覆盖 seller、openid、source、状态轴或服务端时间戳。商家 batch/manual-order 继续使用各自既有的 owner-scoped `mealSlotId` contract。

## 5. 数据迁移与兼容

M2～M4 不新增业务 schema migration。旧 M1 手工订单保持 `source=manual` 且 `customerOpenid=null`；M3 导入订单为 `source=jielong-import` 且 profile/openid/address 为空，只出现在商家侧。共享 CMS production migration baseline 已在 `main` 独立建立，本目标只读验收，不修改授权范围外的 migration/runtime 文件。
