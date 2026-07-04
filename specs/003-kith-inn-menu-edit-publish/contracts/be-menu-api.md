# 契约：kith-inn Menu API（FE ↔ BE）

菜单编辑 + 接龙发布。全部 `sellerAuth`；JWT 经 `Authorization: Bearer`；BE 转发 cms 用 `x-kith-inn-operator`。既有 `GET /menu/week`（生成建议预览，FE 周视图/校验池大小用）保留。

## `GET /menu/plans?date=YYYY-MM-DD`

读某天（或 `?from=&to=` 范围）的 menu_plans。seller-scoped。

### 响应（200）

```json
{ "plans": [{ "planId": 501, "date": "2026-07-08", "occasion": "lunch", "status": "draft", "dishes": [{ "id": 12, "name": "红烧牛肉", "category": "meat", "mainIngredient": "牛肉" }], "publishText": null }] }
```

## `POST /menu/generate`

按 targets 算建议 + upsert **draft** plan（覆写现有 draft；ensure slot 存在）。

### 请求

```json
{ "targets": [{ "date": "2026-07-08", "occasion": "lunch" }], "force": false }
```

### 响应（200）

```json
{ "plans": [/* menuPlanView[]，新建/覆写的 draft */] }
```

### 规则

- 对每个 target：取池子（`findOfferings` 过滤 active+component）+ 历史 lookback（当周已 draft/published plan 的菜）→ `generateWeekMenu` 算 → cms upsert draft plan + ensure slot（draft-if-missing）。
- target 已是 **published** 且无 `force` → 409 `{error:"plan-published", date, occasion}`（caller 二次确认后带 `force:true` 重试）。
- 池太小（`generateWeekMenu` ok:false）→ 200 `{ok:false, reason:"pool-too-small", missing:{...}}`，不写 plan。
- 401 无 token。

## `POST /menu/plans/:id/swap`

换一道菜（auto / 指定）。

### 请求

```json
{ "dishId": 12, "replacementId": 19, "force": false }
```

（`replacementId` 省略 → auto；给定 → 指定 + 主料避重 warning）

### 响应（200）

```json
{ "plan": { /* menuPlanView，换菜后 */ }, "warning": "会和近期主料重复，仍要换吗？" }
```

`warning` 仅指定换且破坏避重时出现。

### 规则

- plan 为 **published** 且无 `force` → 409 `{error:"plan-published"}`。
- published plan 换菜（带 force）→ **清空 publishText**（接龙过期）。
- auto=`swapDish`；指定=`swapDishSpecified`（校验 replacementId 在池、非同菜、算 warning）。
- 失败（slot-not-found/dish-not-in-slot/no-alternative/replacement-not-in-pool/replacement-same-as-target）→ 200 `{ok:false, reason}`。
- 跨租户 id → 404。

## `POST /menu/plans/:id/publish`

一键发布：draft→published + 生成（或返缓存）接龙文案 + 复制。

### 响应（200）

```json
{ "publishText": "【街坊味】7月8日 周三 午餐\n红烧牛肉、…\n30元/份 · 上午10点接龙截止 · 送餐到门口\n接龙：\n1." }
```

### 规则

- 加载 plan（跨租户→404）；若 status==draft → cms PATCH status=published。
- 若 publishText 缺失 → `buildJielongMenuText(plan, seller)` 生成 → cms PATCH publishText。
- 若 publishText 已存 → 直接返回缓存（不重生成）。
- **不调 DeepSeek**；不真发微信群。
- FE 拿到 publishText → `Taro.setClipboardData` 复制 + toast"去群粘贴"。
- 401 无 token。

## 错误

- 401 缺/无效 token。
- 404 `swap`/`publish` 的 plan id 不属当前 seller。
- 409 改 published plan 无 `force`。
