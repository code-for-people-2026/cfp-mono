# Data Model：街坊味 v1 商家核心闭环

## 1. 结论

M1 不新增或修改 collection。它只定义 M0 七个 v1 实体在商家产品中的读写规则、派生值和状态迁移。数据库仍由 `apps/cms` 的 `cms` schema 承载。

```text
kiv1_seller
├── kiv1_operators               # 登录 membership
├── kiv1_offerings               # 菜品池
├── kiv1_meal_slots              # 日期/餐次 + 菜单快照
├── kiv1_customer_profiles       # 商家手动资料，openid 可空
└── kiv1_orders                  # profile + meal slot 的套餐份数订单
```

`kiv1_booking_batches` 在 M0 已存在，但 M1 不创建或修改业务记录；它从 M2 分享预订开始使用。

## 2. 会话模型（不落业务库）

### Operator selection token

| 字段 | 规则 |
|---|---|
| `kind` | 固定 `operator-selection` |
| `choices` | 至少 2 个 `{ operatorId, sellerId }`，来自同一 openid 的 active memberships |
| `iat` | 签发秒时间戳 |
| `exp` | 5 分钟后过期 |

只用于选择 seller，不可调用 merchant/CMS seller-scoped API。FE 只收到 sellerId/sellerName 展示项，不收到 openid。

### Operator token

| 字段 | 规则 |
|---|---|
| `kind` | 固定 `operator` |
| `operatorId` | 当前 membership id |
| `sellerId` | 当前唯一 seller id |
| `role` | M1 固定 `operator` |
| `iat` | 签发秒时间戳 |
| `exp` | 默认 7 天后过期 |

CMS 每次请求必须重查 `operatorId + sellerId + operator.active=true + seller.status=active`；JWT 有效不代表 membership 或 seller 仍有效。

## 3. 菜品与导入

### `kiv1_offerings`

沿用 M0 字段与 `(seller, name)` unique。M1 产品规则：

- list 返回当前 seller 的 active/inactive 全量，支持 UI 筛选。
- create 默认 active。
- update 只允许 name/mainIngredient/category/active。
- deactivate/restore 只是 active 切换，不物理删除。
- 导入 conflict 坐标为当前 seller 下 trim 后的完整 name；不做模糊匹配。

### 导入预览（不持久化）

每行派生：

| 字段 | 说明 |
|---|---|
| `line` | 从 1 开始的原文行号 |
| `raw` | 原行文本 |
| `parsed` | 通过 schema 后的 name/mainIngredient/category |
| `status` | `ready` / `conflict` / `invalid` |
| `existingId` | conflict 时当前 seller 的菜品 id |
| `defaultAction` | ready=`create`，conflict=`skip` |
| `error` | invalid 的短错误码/中文说明 |

commit 结果状态：`created` / `overwritten` / `skipped` / `failed`。不保存 preview session。

## 4. 餐次与菜单快照

### `kiv1_meal_slots`

沿用 `(seller, date, occasion)` unique。M1 写入：

- `menuItems`: 每次生成/换菜后的五项快照。
- `generatedAt`: 成功生成或换菜时间。
- `orderStatus`: M1 默认保持 `draft`，开放/关闭在 M2。
- `priceCents`: 可空；M1 不增加价格设置 UI，手动订单为空时回退 seller default。

### Menu item snapshot

生成时从 offering 复制：`offering`、`nameSnapshot`、`mainIngredientSnapshot`、`categorySnapshot`。之后 offering 编辑/停用不反向更新。

### 生成规则

硬约束：

- 2 `meat` + 2 `veg` + 1 `soup`。
- 只用 active offerings。
- 单餐 offering 不重复。
- 任一分类不足则整次失败，不写入。

软偏好按以下优先级从高到低做字典序最小化：同周同菜、同日同主料、目标日前 7 日同菜、目标日前 7 日同主料。返回实际冲突的 `relaxedRules[]`，不落库；随机源只在评分完全相同的候选之间选择。

## 5. 顾客资料

### `kiv1_customer_profiles`

M1 商家侧可 list/create active profiles：

- 新 profile 需要 displayName + address。
- openid 默认空；M1 不提供手工输入/猜测 openid。
- 订单编辑默认只改 order snapshot，不改 profile。
- M1 不提供 profile disable/edit UI；需要时由后续顾客/profile 切片定义。

## 6. 订单

### `kiv1_orders`

沿用 `(seller, mealSlot, customerProfile)` unique。M1 订单必须有 customerProfile，source 固定 `manual`，customerOpenid 仅在 profile 已有已验证 openid 时复制；M1 新建 profile 默认为空。

派生规则：

- `unitPriceCents = mealSlot.priceCents ?? seller.defaultPriceCents`，创建/重提时存快照。
- `totalCents = quantity * unitPriceCents`，读时派生。
- 汇总只统计 `status=confirmed`；canceled 和 draft 不进入备餐/未付/未送口径。
- 清单只含 confirmed，按 address 再 displayName 排序。

### Business status

```text
draft ──confirm──> confirmed
  │                   │
  └────cancel─────────┴──> canceled

canceled ──explicit resubmit──> draft
```

- confirm：设置 `confirmedAt=now`，清 `canceledAt`。
- cancel：设置 `canceledAt=now`；保留付款/送达历史字段但统计忽略。
- resubmit：必须是 canceled；更新当前快照/份数/单价，设置 draft，清空 `confirmedAt`、`canceledAt`、`paidAt`、`deliveredAt`，重置 unpaid/pending。
- draft/confirmed 可以编辑快照；confirmed 编辑需要调用方显式确认影响。
- canceled 的普通 edit/confirm/payment/delivery 全拒绝。

### Payment status（仅 confirmed）

```text
unpaid ──mark-paid──> paid
paid ──mark-unpaid──> unpaid
```

- paid 设置 `paidAt=now`。
- unpaid 清空 `paidAt`。

### Delivery status（仅 confirmed）

```text
pending ──mark-delivered──> done
done ──mark-pending──> pending
```

- done 设置 `deliveredAt=now`。
- pending 清空 `deliveredAt`。
- bulk mark-delivered 对每个 id 重用同一单条转换；任何 id 不属于 seller/非 confirmed/canceled 时该 id 返回失败，不影响其他 id 的结果。

## 7. Tenant 与关系规则

- 所有 list/find 均含当前 JWT seller filter。
- 所有 create seller 均由 JWT stamp，body 不接收 seller。
- offering、meal slot、profile、order id 在读写前均先按当前 seller 查询；跨 seller 统一表现为 not found。
- order.customerProfile 与 order.mealSlot 必须和 JWT seller 相同；menu item offering 同理。
- login 后 operator membership 被停用或 seller 被暂停时，CMS revalidation 立即拒绝后续操作。

## 8. 不新增的数据

- 不持久化 import preview、menu relaxation、order summary、totalCents 或复制清单。
- 不新增 role、permission、menu plan、order item、fulfillment、audit collection。
- 不为 M1 写 booking batch/customer session 数据。
