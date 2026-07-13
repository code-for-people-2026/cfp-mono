# 契约：自动换菜响应与历史语义

## `POST /menu/plans/:id/swap`

认证、请求体和既有错误状态不变：

```json
{ "dishId": 12, "dishIndex": 1, "replacementId": 19, "force": true }
```

- `replacementId` 缺失：自动换菜。
- `replacementId` 存在：指定换菜，继续返回既有 `warning?`，不进入自动评分。
- `dishIndex` 是可选零起始位置；提供时该位置必须是 `dishId`，省略时只选择第一个匹配项。它保证重复 offering 场景也只改用户点击的位置。
- published 且无 `force:true`：`409 {"error":"plan-published"}`。

### 自动换菜成功

```json
{
  "plan": { "planId": 501, "date": "2026-07-13", "occasion": "lunch", "status": "draft", "dishes": [] },
  "relaxedRules": ["same-day-main-ingredient", "recent-main-ingredient"]
}
```

- `relaxedRules` 必须存在；无放宽时为 `[]`。
- 数组仅含以下值且保持固定顺序：
  1. `same-week-offering`
  2. `same-day-main-ingredient`
  3. `recent-offering`
  4. `recent-main-ingredient`
- `plan.dishes` 只在解析后的目标位置变化；不得用按 ID 的全量 `map` 同时替换重复项。

### 指定换菜成功

```json
{
  "plan": { "planId": 501, "date": "2026-07-13", "occasion": "lunch", "status": "draft", "dishes": [] },
  "warning": "会和近期主料重复，仍要换吗？"
}
```

指定分支保持兼容：`warning` 可省略，不要求返回 `relaxedRules`。

### 自动换菜失败

- `409 {"error":"no-alternative"}`：且仅当启用同类菜中没有当前餐未使用的候选。
- 既有 `slot-not-found` / `dish-not-in-slot` 与 CMS 404/5xx 语义不变。

## 历史读取契约

menu route 与 chat agent 的自动分支都通过既有 seller-scoped `listMenuPlans(jwt,{from,to})` 读取：

- `from = min(targetDate - 7 calendar days, Monday(targetDate))`
- `to = Sunday(targetDate)`
- 按 `MenuPlan.id !== currentPlan.id` 排除当前 plan。
- draft/published plan 均参与评分；CMS 已按 JWT seller 限定，禁止跨 seller 拼接历史。

## 菜单页解释

FE 必须先使用共享 success-response schema 做 runtime parse，再把 `RelaxedRule` 映射中文。非空时提示以“菜品池较小，本次允许”开头并列出全部原因；空数组不显示放宽提示；未知值由 schema 拒绝并进入换菜失败处理，不静默显示错误文案。chat preview/确认卡使用同一有序规则集合生成提示。
