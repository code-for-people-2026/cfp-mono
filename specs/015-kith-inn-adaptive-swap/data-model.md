# 数据模型：kith-inn 自适应换菜

本功能不新增持久化实体、不改 Payload collection/schema。以下为一次自动换菜中的逻辑模型。

## EligibleSwapCandidate

- `dish`: 既有 `MenuDish`（id/name/category/mainIngredient?）。
- 资格：上游活跃 component；与目标菜同 category；ID 不等于目标菜；当前餐未使用。
- 生命周期：请求内临时集合，不落库。

## SwapConflictScore

- 四元组：`[sameWeekOffering, sameDayMainIngredient, recentOffering, recentMainIngredient]`。
- 每项是非负冲突次数；按下标顺序字典序比较。
- `sameDayMainIngredient` 同时统计历史同日餐次与当前餐剩余菜。

## RelaxedRule

- 枚举：`same-week-offering`、`same-day-main-ingredient`、`recent-offering`、`recent-main-ingredient`。
- 胜出评分对应分量大于 0 时出现，按枚举固定顺序返回。
- 仅属于本次自动换菜响应，不写入 `menu_plans`。

## SwapHistory

- 由既有 `MenuPlan` 转成 `MenuSlot(day, occasion, dishes)`。
- 查询窗口：`min(target-7d, targetWeekMonday)` 至 `targetWeekSunday`。
- 当前 plan 按 ID 排除；seller 隔离沿用 CMS operator JWT。

## 写入不变量

- `menu_plans.offerings` 数量和顺序不变，仅目标 dish ID 所在位置替换。
- published + force 成功后继续把 `publishText` 清为 null；无 force 不写。
