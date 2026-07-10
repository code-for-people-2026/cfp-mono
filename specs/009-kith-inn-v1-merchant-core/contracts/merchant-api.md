# Contract：kith-inn-v1 Merchant API

## 1. 通用

- Base URL：v1 BE；本地默认 `http://localhost:3311`。
- JSON 请求/响应；`EntityId = string | number`。
- 除 auth/health 外，header：`Authorization: Bearer <v1-operator-jwt>`。
- seller 不出现在写请求中；响应实体可含 sellerId 供调试/展示，但服务端只信 token。
- 通用错误：`{ "error": "stable-code", "message": "中文可读说明" }`。
- 401：缺失/无效/过期 token；403：membership 已停用；404：记录不存在或属于其他 seller；409：唯一/状态冲突；422：合法 JSON 但字段规则不通过；502：微信或 CMS 边界失败。

## 2. Auth

### `GET /health`

200：`{ "status": "ok" }`。

### `POST /auth/operator/wx-login`

请求：`{ "code": "wx.login code" }`。

单 membership，200：

```json
{
  "status": "authenticated",
  "token": "operator-jwt",
  "session": { "operatorId": 1, "sellerId": 7, "sellerName": "桃子", "role": "operator", "expiresAt": "ISO" }
}
```

多 membership，200：

```json
{
  "status": "seller-selection-required",
  "selectionToken": "5-minute-token",
  "sellers": [
    { "sellerId": 7, "sellerName": "桃子" },
    { "sellerId": 8, "sellerName": "邻居" }
  ]
}
```

0 membership：401 `operator-not-provisioned`。微信交换失败：502 `wechat-login-failed`。

### `POST /auth/operator/select-seller`

请求：`{ "selectionToken": "...", "sellerId": 7 }`。

200：与 authenticated 响应相同。token 过期/卖家不在 choices：401；membership 已停用：403。

### `POST /auth/operator/dev-login`

请求：`{ "openid": "taozi-v1-dev-openid" }`，响应与 wx-login 相同。仅非 production 且 `KITH_INN_V1_ALLOW_DEV_LOGIN=1` 存在，否则 404。weapp 失败不得自动调用它。

## 3. Offerings

### `GET /merchant/offerings?active=all|true|false`

默认 `all`。200：`{ "docs": Offering[] }`，按 active desc、name asc。

### `POST /merchant/offerings`

请求：`{ "name": "番茄牛腩", "mainIngredient": "牛肉", "category": "meat" }`。

201：`{ "doc": Offering }`。同 seller 重名：409 `offering-name-conflict`。

### `PATCH /merchant/offerings/:id`

至少一个字段：`name?`、`mainIngredient?`、`category?`、`active?`。200：`{ "doc": Offering }`。

不提供 DELETE。

### `POST /merchant/offerings/import/preview`

请求：`{ "text": "番茄牛腩 牛肉 荤\n清炒时蔬 青菜 素" }`。

200：

```json
{
  "rows": [
    { "line": 1, "raw": "...", "parsed": { "name": "番茄牛腩", "mainIngredient": "牛肉", "category": "meat" }, "status": "ready", "defaultAction": "create" },
    { "line": 2, "raw": "...", "parsed": { "name": "清炒时蔬", "mainIngredient": "青菜", "category": "veg" }, "status": "conflict", "existingId": 2, "defaultAction": "skip" }
  ],
  "summary": { "ready": 1, "conflict": 1, "invalid": 0 }
}
```

超过 50 个非空行：422 `too-many-import-rows`。

### `POST /merchant/offerings/import/commit`

请求：

```json
{
  "text": "原始多行文本",
  "conflicts": [{ "line": 2, "action": "overwrite" }]
}
```

服务端重新解析并重查冲突；未列出的 conflict 默认 skip。200：

```json
{
  "results": [
    { "line": 1, "status": "created", "id": 10 },
    { "line": 2, "status": "overwritten", "id": 2 }
  ],
  "summary": { "created": 1, "overwritten": 1, "skipped": 0, "failed": 0 }
}
```

单行失败不回滚已完成行；重试仍受 `(seller,name)` unique 保护。

## 4. Meal slots / menus

### `GET /merchant/meal-slots?from=YYYY-MM-DD&to=YYYY-MM-DD`

200：当前 seller 范围内按 date/occasion 排序的 `{ docs: MealSlot[] }`。范围必须有效，跨度最多 31 天。

### `POST /merchant/meal-slots/generate-menus`

请求：

```json
{
  "targets": [{ "date": "2026-07-13", "occasion": "lunch" }],
  "replaceExisting": false
}
```

- 任一 target 已存在且 replaceExisting=false：409 `meal-slots-exist`，返回 `existingTargets`，无写入。
- 分类不足：422 `offering-pool-insufficient`，返回每类 required/available，无写入。
- 成功 200：`{ "docs": MealSlot[], "relaxedRules": string[] }`。
- targets 去重后最多 20；生成器读取最早 target 前 7 天至最晚 target 的历史。

### `POST /merchant/meal-slots/:id/swap-menu-item`

请求：`{ "offeringId": 10 }`，offeringId 是当前菜单中要替换的项。

200：`{ "doc": MealSlot, "relaxedRules": string[] }`。无候选：409 `no-swap-candidate`，原菜单不变。

## 5. Customer profiles（商家侧）

### `GET /merchant/customer-profiles?query=`

200：当前 seller active profiles；query 对 displayName/address 做包含匹配。

### `POST /merchant/customer-profiles`

请求：`{ "displayName": "王阿姨", "address": "3A-1201" }`。M1 不接受 openid。201：`{ "doc": CustomerProfile }`。

## 6. Orders

### `GET /merchant/orders?date=YYYY-MM-DD&occasion=lunch|dinner`

200：

```json
{
  "mealSlot": { "id": 1, "date": "2026-07-13", "occasion": "lunch", "menuItems": [] },
  "docs": [],
  "summary": { "confirmedOrders": 0, "totalQuantity": 0, "unpaid": 0, "pendingDelivery": 0 }
}
```

### `POST /merchant/orders`

请求二选一：

```json
{ "mealSlotId": 1, "customerProfileId": 2, "quantity": 2, "note": "少辣" }
```

```json
{ "mealSlotId": 1, "newProfile": { "displayName": "王阿姨", "address": "3A-1201" }, "quantity": 2, "note": "少辣" }
```

201：`{ "doc": Order, "profile": CustomerProfile }`。同 profile+slot 已存在：409 `order-exists` 或 `canceled-order-exists`，只返回现有 id/status/quantity 摘要。

### `PATCH /merchant/orders/:id`

请求：`{ "quantity"?: 2, "displayName"?: "王阿姨", "address"?: "3A-1202", "note"?: "", "confirmedImpactAccepted"?: true }`。

confirmed 且未显式确认影响：409 `confirmed-impact-confirmation-required`。canceled：409。

### Actions

- `POST /merchant/orders/:id/confirm`
- `POST /merchant/orders/:id/cancel`
- `POST /merchant/orders/:id/resubmit`，body 为 quantity/displayName/address/note 快照
- `POST /merchant/orders/:id/mark-paid`
- `POST /merchant/orders/:id/mark-unpaid`
- `POST /merchant/orders/:id/mark-delivered`
- `POST /merchant/orders/:id/mark-pending-delivery`

成功 200：`{ "doc": Order }`。重复到目标状态幂等返回当前 doc；非法源状态 409 `invalid-order-transition`。

### `POST /merchant/orders/bulk-mark-delivered`

请求：`{ "ids": [1,2,3] }`，最多 100 个去重 id。

200：`{ "results": [{ "id": 1, "status": "updated" }, { "id": 2, "status": "failed", "error": "invalid-order-transition" }] }`。逐 id 处理，不修改未列出的订单。

## 7. FE 行为契约

- 无 token 进入任何 merchant 页时跳登录；401 清 token 并回登录，403 显示“身份已停用”后清 token。
- 多 seller 必须出现选择页/选择态；不默认选第一项。
- 菜品 import 必须先 preview；commit 按行显示最终结果。
- 覆盖现有菜单、修改 confirmed 订单、取消订单、恢复 canceled 订单均需二次确认。
- 清单文本由订单响应在 FE 纯函数中生成并调用平台剪贴板，不新增 API/持久化字段。
