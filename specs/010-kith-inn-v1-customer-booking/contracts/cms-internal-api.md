# CMS Internal API Contract（M2）

## 1. 边界

CMS 继续是唯一数据访问层，所有 route 位于 `/api/internal/kiv1`。operator 读取沿用 M1 operator JWT；包含领域状态决策的商家写入及全部顾客写入同时要求既有 internal service token。CMS 负责 strict 输入、tenant owner 与 relationship guard；BE 负责 batch/slot/deadline/order transition 决策。

## 2. 商家侧扩展

### `PATCH /meal-slots/:id/booking-config`

- 鉴权：operator JWT + internal service token。
- 输入：BE 已验证的 `priceCents/orderDeadline/orderStatus` 白名单，至少一项。
- guard：目标 slot 必须属于 operator seller。
- 不在 CMS 判断菜单是否完整、deadline 是否未来或状态转换是否合法。

### `GET /booking-batches`

- 鉴权：operator JWT。
- query：可选 `status`。
- 强制 seller filter，默认按 createdAt 倒序。

### `POST /booking-batches`

- 鉴权：operator JWT + internal service token。
- 输入：`publicId/title/status=open/mealSlotIds/createdById`。
- seller 由 operator session 注入；CMS relationship guard 验证所有 slot 和 createdBy 同 seller。

### `PATCH /booking-batches/:id`

- 鉴权：operator JWT + internal service token。
- 输入仅允许 `{ status: "closed" }`。
- owner 不匹配统一返回 404。

## 3. 顾客 session/bootstrap

### `POST /auth/customer-session`

- 鉴权：internal service token，不接受 customer JWT。
- 输入：`{ "batchPublicId": "uuid" }`。
- 输出：active seller 的 id/name/default price 与 batch id/publicId/status。
- publicId 不存在或 seller 非 active 时分别返回 404/403。

该 route 只解析入口 seller，不创建 profile、order 或 session。

## 4. Customer scope

M2 新增 CMS customer scope middleware：

1. 验证 customer JWT 签名、`kind=customer`、有效期；
2. 取 claims 中 sellerId/openid，忽略请求中的同名字段；
3. 验证 seller active；
4. 将 `{ sellerId, openid }` 仅放在服务端 request context；
5. owner 不匹配返回 404，避免 tenant 枚举。

BE 调用 customer-scoped CMS route 时转发 customer JWT；写 route 还必须附 internal service token。

## 5. 顾客批次读取

### `GET /customer/booking-batches/:publicId`

- 鉴权：customer JWT。
- 强制 `batch.seller = customer.sellerId`。
- 返回 batch、seller default price 和完整 meal slot 快照；CMS 不计算 `canBook`。
- closed/archived 可读。

## 6. 顾客资料

### `GET /customer/profiles`

强制 filter：`seller=claims.sellerId AND openid=claims.openid AND active=true`。响应不得含 openid。

### `POST /customer/profiles`

- 鉴权：customer JWT + internal service token。
- 输入只含 displayName/address；CMS 注入 seller/openid/active/lastUsedAt。

### `POST /customer/profiles/:id/deactivate`

- 鉴权：customer JWT + internal service token。
- 只更新匹配 `seller + openid` 的 profile 为 `active=false`；重复调用幂等。

### `POST /customer/profiles/:id/touch`

- 鉴权：customer JWT + internal service token。
- BE 在登记成功后更新 `lastUsedAt`；只允许当前 owner 的 active profile。

## 7. 顾客订单

### `GET /customer/orders`

强制 filter：`seller=claims.sellerId AND customerOpenid=claims.openid AND source=customer-card`。关联 meal slot 后返回共享 customer order view 所需字段。

### `GET /customer/orders/by-slot/:mealSlotId?customerProfileId=:id`

供 BE 登记前查重。必须同时匹配 seller、customerOpenid、mealSlot、customerProfile；不得只依赖数据库唯一错误判断 owner。

### `POST /customer/orders`

- 鉴权：customer JWT + internal service token。
- 输入是 BE 解析完成的持久化快照；source 必须为 `customer-card`，customerOpenid 必须等于 claims openid，seller 由 scope 注入。
- CMS 验证 mealSlot/profile 同 seller，且 profile openid 等于 claims openid。

### `PATCH /customer/orders/:id`

- 鉴权：customer JWT + internal service token。
- owner filter 必须同时包含 seller + customerOpenid。
- 只接受 BE 白名单的快照、数量、价格和状态时间字段；CMS 不自行决定 transition。

## 8. 一致性与错误

- 所有关系读取使用 depth 受控的 normalized DTO，不透传 Payload document。
- 对不存在与越权统一 404。
- 关系不一致返回 `409 relationship-owner-mismatch`。
- 唯一约束冲突返回稳定 `409 order-exists`，由 BE 重新读取并映射为逐项结果。
- 未携带 internal service token 的 customer 写入返回 401；有效 customer token 不能直接绕过 BE 写 CMS。
