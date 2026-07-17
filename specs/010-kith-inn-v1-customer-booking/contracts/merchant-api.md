# 商家 API Contract（M2～M4）

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

## 6. 接龙导入兜底

### `POST /merchant/jielong/preview`

请求只接受 `{ "text": string }`。首个非空行必须为 `YYYY-MM-DD 午餐|晚餐`，其余非空行必须为可选列表序号加“称呼 正整数份数”；必须有 1～100 个数据行，只有标题和空白行也属于非法文本，原文最多 10,000 字符。非法文本返回 `422 invalid-jielong-text`，餐次不存在返回 `404 meal-slot-not-found`，无法在当前 seller 下唯一匹配返回 `409 meal-slot-ambiguous`；三者写入数均为 0。

成功响应不含内部 meal-slot id：

```json
{
  "previewHash": "64-char-lowercase-hex",
  "target": { "date": "2026-07-20", "occasion": "lunch" },
  "lines": [
    { "lineNumber": 2, "displayName": "王阿姨", "quantity": 2, "unitPriceCents": 3000, "totalCents": 6000 }
  ],
  "totalCents": 6000
}
```

### `POST /merchant/jielong/commit`

```json
{ "text": "2026-07-20 午餐\n1. 王阿姨 2份", "previewHash": "64-char-lowercase-hex", "confirmed": true }
```

preview hash 是 seller、餐次身份、当前单价和 canonical input 的 SHA-256。BE commit 必须重新解析原文并重查同一 seller/meal slot。它先按请求中的 `previewHash + 数据行原始行号` 查询内部标记；只有全部数据行都已存在，并且既有订单的 seller、meal slot、原始行号、称呼和份数逐行等于本次解析结果时，才在读取当前单价和重算 hash 前返回 `existing`，保证首次提交成功但响应丢失后，即使单价已变化，原请求仍可幂等重试。旧 hash 搭配改过称呼、份数、目标或行号的文本必须返回 `409 preview-hash-mismatch`，不得误报 `existing`。只要有数据行尚不存在，才重读当前单价并重算 hash，单价变化或 hash 不匹配时整批拒绝且不新增订单。匹配餐次只需是当前 seller 下已有且能取得有效服务端单价的 meal slot，不复用顾客登记的 batch、open/closed 或 deadline 门禁；无法取得有效单价返回 `409 meal-slot-unavailable`。`confirmed` 非 true 同样不得写入。每个数据行写入 draft `jielong-import` 订单，profile/openid/address 固定为空。

CMS 内部幂等标记固定编码为 `__kiv1_jielong:<64 位 previewHash>:<5 位零填充原始行号>\n`，长度 86 个 ASCII 字符。`kiv1_orders.note` 总上限保持 1,000，因此 `jielong-import` 的可见备注最多 914 个字符；manual/customer-card 的可见备注上限仍为 1,000。CMS 只为 `jielong-import` 构造/识别该前缀，对外 DTO 剥离它；商家后续编辑导入订单 note 时保留前缀，并在 914/915 字符边界验证。该标记只保证顺序重试，不声明并发唯一性。

```json
{
  "previewHash": "64-char-lowercase-hex",
  "results": [
    { "lineNumber": 2, "status": "created", "orderId": 301 }
  ]
}
```

稳定状态为 `created|existing`。主要错误：`422 invalid-jielong-text`、`404 meal-slot-not-found`、`409 meal-slot-ambiguous`、`409 meal-slot-unavailable`、`409 preview-hash-mismatch`。其中 `meal-slot-unavailable` 只表示唯一匹配的 seller-owned meal slot 无有效服务端单价，不表示顾客登记已关闭或过期。
