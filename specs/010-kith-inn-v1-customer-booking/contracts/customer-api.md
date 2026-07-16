# 顾客 API Contract（M2）

## 1. 通用约定

- 顾客 route 位于 BE；除登录外均使用 `Authorization: Bearer <customer-jwt>`。
- customer JWT 只绑定单一 seller 与已验证 openid，有效期 7 天。
- 请求体和响应体使用 `@cfp/kith-inn-v1-shared` strict Zod schema；客户端不能提交 seller/openid/source/状态轴。
- 稳定错误形态：`{ "error": "stable-code", "message": "中文说明" }`。

## 2. 静默登录

### `POST /auth/customer/wx-session`

```json
{ "code": "wx.login temporary code", "batchPublicId": "72b8..." }
```

BE 先通过 CMS 解析 batch 的 seller，再通过微信 `code2Session` 验证 code 并签发 customer JWT。一个临时 code 只使用一次，不记录、不输出到日志。

成功：

```json
{
  "token": "jwt",
  "session": {
    "sellerName": "桃子",
    "role": "customer",
    "expiresAt": "2026-07-18T10:00:00.000Z"
  }
}
```

主要错误：`404 booking-batch-not-found`、`401 invalid-wechat-code`、`403 seller-inactive`、`502 wechat-unavailable`。

### `POST /auth/customer/dev-session`

仅在既有开发登录开关显式启用时可用：

```json
{ "openid": "dev-customer-openid", "batchPublicId": "72b8..." }
```

生产环境必须返回 404；响应与微信登录一致。

## 3. 分享入口读取

### `GET /public/booking-batches/:publicId`

需要 customer JWT，且 batch seller 必须与 token seller 一致。返回 `BookingBatchView`：seller 名称、batch 标题/状态、分享 path、餐次日期与午/晚餐、菜单、解析后价格、截止时间、`canBook` 和不可登记原因。每个餐次的 `{date, occasion}` 是后续写入使用的公开坐标；响应不含内部 meal-slot ID。

open/closed/archived batch 都可以读取；只有 open batch 中仍 open 且未截止的 slot 可登记。跨 seller token 返回 404，避免泄露 tenant 存在性。

## 4. 顾客资料

### `GET /customer/profiles`

返回当前 `seller + openid` 的 active profile，按 `lastUsedAt` 倒序；响应不含 openid。

### `POST /customer/profiles`

```json
{ "displayName": "王阿姨", "address": "3A-1201" }
```

服务端注入 seller/openid/active。成功：`201 { "doc": CustomerProfile }`。

### `POST /customer/profiles/:id/deactivate`

空请求体。只允许停用当前 openid 的 profile；重复调用幂等。历史订单及其快照不变。

## 5. 多餐次登记

### `POST /customer/reservations`

```json
{
  "batchPublicId": "72b8...",
  "profile": { "customerProfileId": 21 },
  "displayName": "王阿姨",
  "address": "3A-1201 门口",
  "items": [
    { "target": { "date": "2026-07-13", "occasion": "lunch" }, "quantity": 2 },
    { "target": { "date": "2026-07-13", "occasion": "dinner" }, "quantity": 1, "resubmitCanceled": true }
  ]
}
```

`profile` 必须且只能为以下之一：

```json
{ "customerProfileId": 21 }
```

```json
{ "newProfile": { "displayName": "王阿姨", "address": "3A-1201" } }
```

约束：

- `items` 去重后 1–20 项，quantity 为正整数。`target` 只接受页面已公开的 `date` 与 `occasion=lunch|dinner`，请求中出现 `mealSlotId` 或其他字段即按 strict schema 拒绝。
- 相同 target、quantity 和规范化 `resubmitCanceled`（省略视为 false）的重复项按首次位置处理一次；同一 target 的 quantity 或 `resubmitCanceled` 冲突时返回 422，且不写入任何项。
- `displayName/address` 是本次订单快照；使用已有 profile 时允许与 profile 不同，且不覆盖 profile。
- 需要保存编辑后的资料时，客户端使用 `newProfile`。
- BE 先在 `batchPublicId` 对应批次内唯一解析每个 target，再对每项验证 batch、slot、deadline、owner 和订单状态；内部 meal-slot ID 只用于 BE→CMS 调用。
- 各项独立写入，不承诺全局事务。

响应：

```json
{
  "profile": { "id": 21, "displayName": "王阿姨", "address": "3A-1201", "active": true },
  "results": [
    { "target": { "date": "2026-07-13", "occasion": "lunch" }, "status": "created", "doc": {} },
    { "target": { "date": "2026-07-13", "occasion": "dinner" }, "status": "failed", "error": "confirmed-order-locked", "message": "商家已确认，不能修改" }
  ]
}
```

成功 discriminator 为 `created/updated/resubmitted`；失败为 `failed`。每项顶层用原公开 target 而非 `mealSlotId` 关联页面餐次；成功项的鉴权后订单摘要保持既有 contract，FE 不得用其中关系 ID 做页面关联。HTTP 200 表示批次已处理，即使部分项失败；请求整体无效或鉴权失败时返回 4xx 且不写入。

## 6. 我的预订

### `GET /customer/orders`

只按 customer JWT 的 `seller + openid` 返回 customer-card 订单，按餐次日期倒序。读取不受 batch/slot 关闭影响；每项返回餐次、菜单、快照价格、数量、总价及业务/付款/送达三条状态轴。

### `PATCH /customer/orders/:id`

```json
{ "batchPublicId": "72b8...", "quantity": 3 }
```

只允许修改当前 open batch 所含餐次的自有 draft；成功保持同一 order id。确认、取消、截止或关闭后返回 409。

### `POST /customer/orders/:id/cancel`

```json
{ "batchPublicId": "72b8...", "confirmed": true }
```

只允许取消自有 draft；显式 `confirmed:true` 防止误触。成功设置 `status=canceled` 与 `canceledAt`，不删除记录。

## 7. 稳定错误码

至少包含：`invalid-customer-session`、`booking-batch-not-found`、`booking-batch-closed`、`meal-slot-not-in-batch`、`meal-slot-closed`、`order-deadline-passed`、`customer-profile-not-found`、`customer-profile-inactive`、`order-not-found`、`confirmed-order-locked`、`canceled-order-confirmation-required`、`invalid-reservation-request`。
