# 商家 API Contract（M2）

## 1. 通用约定

- 前缀：BE `/merchant`。
- 鉴权：沿用 M1 operator Bearer JWT 与 seller selection；请求 seller 只能来自 session。
- JSON schema：在 `@cfp/kith-inn-v1-shared` 中定义为 strict Zod schema。
- 错误形态：`{ "error": "stable-code", "message": "中文说明" }`。

## 2. 餐次预订配置

### `PATCH /merchant/meal-slots/:id/booking-config`

请求（至少一个字段）：

```json
{
  "priceCents": 2800,
  "orderDeadline": "2026-07-12T09:00:00.000+08:00",
  "orderStatus": "open"
}
```

- `priceCents` 是非负整数或 `null`；空值表示使用 seller 默认价。
- `orderDeadline` 是带时区时间或 `null`。
- `orderStatus` 只接受 `draft/open/closed`。
- 转为 `open` 时必须已有五项菜单、deadline 非空且晚于当前时间。
- M2 不支持从 `closed` 重新开放。

成功：`200 { "doc": MealSlot }`。`MealSlot` 在 M2 增加 `orderDeadline` 字段。

主要错误：`404 meal-slot-not-found`、`409 invalid-meal-slot-transition`、`422 meal-slot-not-ready`。

## 3. 预订批次

### `GET /merchant/booking-batches?status=open|closed|archived`

返回当前 seller 的批次，按创建时间倒序：

```json
{ "docs": [BookingBatchSummary] }
```

### `POST /merchant/booking-batches`

```json
{
  "title": "7 月 13–15 日预订",
  "mealSlotIds": [101, 102]
}
```

- `title` 可省略；BE 生成可读默认标题。
- `mealSlotIds` 去重后须为 1–20 个。
- 每个 slot 必须属于当前 seller、为 open 且未截止。
- `publicId` 使用服务端 UUID，`createdBy` 使用当前 operator，初始状态固定为 open。

成功：

```json
{
  "doc": BookingBatch,
  "share": {
    "title": "7 月 13–15 日预订",
    "path": "/pages/booking/index?batch=72b8..."
  }
}
```

主要错误：`404 meal-slot-not-found`、`409 meal-slot-unavailable`、`422 invalid-booking-batch`。

### `PATCH /merchant/booking-batches/:id`

M2 请求仅允许关闭：

```json
{ "status": "closed" }
```

成功：`200 { "doc": BookingBatch }`。重复关闭返回同一 closed 表示，保证幂等。M2 不提供 archive 或 reopen。

主要错误：`404 booking-batch-not-found`、`409 invalid-booking-batch-transition`。

## 4. 分享 UI 约定

M2-A 的商家页先显示并复制 `share.title/path`，但不发出指向尚未注册顾客页的真实卡片。M2-B 注册真实只读目标页后，同一商家页才调用微信小程序原生分享能力；H5 继续只显示/复制 path。不得构造永久域名，也不得把 operator token 放入 path。分享入口即使 closed 仍可建立顾客 session 和读取历史状态，但界面必须明确只读。

## 5. M1 兼容

M1 的 offering、菜单生成、换菜、手工订单和状态动作 contract 不变。餐次菜单 PATCH 仍只接受菜单快照；预订配置使用独立 endpoint，避免扩大原菜单写入 contract。
