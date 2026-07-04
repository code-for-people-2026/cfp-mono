# 契约：kith-inn Menu API（FE ↔ BE）

菜单 换菜 / 发布 / 回看 / 复制文案。所有端点 `sellerAuth` 保护，operator JWT 经 `Authorization: Bearer <token>`；BE 转发 cms 用 `x-kith-inn-operator`（seller-token 透传，无 admin key）。既有 `GET /menu/week` 不变。

## `POST /menu/swap`

无状态换菜（发布前 in-session）。BE 取菜品池、调确定性换菜，返回替换菜；FE 用 `applySwap` 应用到本地 menu。

### 请求体

```json
{
  "menu": [{ "day": "mon", "occasion": "lunch", "dishes": [{ "id": 12, "name": "红烧牛肉", "category": "meat", "mainIngredient": "牛肉" }] }],
  "target": { "day": "mon", "occasion": "lunch", "dishId": 12 },
  "replacementId": 19
}
```

- `replacementId` 省略 → auto（`swapDish`，确定性选替代、自带避重）。
- `replacementId` 给定 → 指定换（`swapDishSpecified`，校验在池内 + 主料避重 warning）。

### 响应（200）

```json
{ "ok": true, "replacement": { "id": 19, "name": "香菇滑鸡", "category": "meat", "mainIngredient": "鸡" }, "warning": "会和近期主料重复，仍要换吗？" }
```

成功必带 `ok:true`（与失败 `{ok:false,reason}` 共用 `ok` 判别 union）。`warning` 仅指定换且破坏主料避重时出现；auto 模式无 warning。

### 失败（200 `{ok:false}` —— 业务可恢复，非 HTTP 错误）

```json
{ "ok": false, "reason": "no-alternative" }
```

`reason` ∈ `slot-not-found` | `dish-not-in-slot` | `no-alternative` | `replacement-not-in-pool` | `replacement-same-as-target`。

### 规则

- BE 从 `GET /api/internal/offerings`（过滤 `active && component`）取池子。
- 不落库、不持久化；纯函数。
- 401 无 token。

## `POST /menu/publish`

把周菜单（mon-fri）发布：解析成 Asia/Shanghai 当周具体日期 → 每餐次 upsert service_slot→open + upsert menu_plan(published)。

### 请求体

```json
{
  "menu": [
    { "day": "mon", "occasion": "lunch", "dishes": [{ "id": 12, "name": "红烧牛肉", "category": "meat", "mainIngredient": "牛肉" }] }
  ]
}
```

（完整 mon-fri × 午晚；每道 dish 带 id）

### 响应（200）

```json
{ "plans": [{ "id": 501, "slot": 91, "offerings": [12, 13], "status": "published", "publishText": null, "seller": 7 }] }
```

### 规则

- BE 用 `resolveWeekDates(todayShanghai, ["mon".."fri"])` 把 day→date。
- 每餐次：先 cms `POST /api/internal/service-slots/upsert` [{date, occasion, granularity:"occasion"}] → open（**archived→409 上抛**）；再 cms `POST /api/internal/menu-plans/upsert` [{slot, offerings: dishIds, status:"published"}]。
- 不调 LLM。
- archived slot → 409 `{error:"slot-archived", date, occasion}`（force/二次确认 M1 不做）。
- 重复发布 upsert（更新现有 plan，不重复建）。
- 401 无 token；502 cms 失败。

## `GET /menu/published?date=`

回看当周已发布菜单。`date` 缺省 today（Asia/Shanghai）。

### 响应（200）

```json
{
  "published": [
    { "date": "2026-07-06", "occasion": "lunch", "planId": 501, "dishes": [{ "id": 12, "name": "红烧牛肉", "category": "meat", "mainIngredient": "牛肉" }], "publishText": null }
  ]
}
```

### 规则

- BE `resolveWeekDates(date, ...)` → [from,to]；cms `GET /api/internal/menu-plans?from=&to=`（depth: slot+offerings，seller-scoped）。
- `published` 空数组 → FE 退回 `GET /menu/week` 建议页。
- 401 无 token。

## `POST /menu/plans/:id/publish-text`

对单个已发布 plan 生成发群文案（LLM），写回 publishText，返回。

### 响应（200）

```json
{ "publishText": "街坊们～明天周一午餐红烧牛肉+…，30 元/份，上午 10 点前接单截止哈，明天送达～" }
```

### 规则

- BE `getMenuPlan(id)`（cms `GET /api/internal/menu-plans/:id`，seller-scoped + depth）加载 plan；plan 已有 publishText → 直接返回缓存（不重复调 LLM）。
- 否则构建 `MenuSlotText{day(由 slot.date 推), occasion, dishes[name]}` → `publishMenuText({sellerName, priceCents})`（sellerName/priceCents 从 `GET /api/internal/seller`）→ cms `PATCH /api/internal/menu-plans/:id {publishText}`。
- 跨租户 plan id → 404。
- LLM 失败 → 502 `{error:"publish-text failed"}`（不阻塞已发布的菜单）。
- 401 无 token。

## 错误

- 401：缺/无效 token。
- 404：`publish-text` 的 plan id 不属当前 seller。
- 409：`publish` 遇 archived slot。
- 502：cms / LLM 失败。
