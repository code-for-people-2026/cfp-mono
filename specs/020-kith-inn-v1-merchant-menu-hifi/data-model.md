# 视图数据模型：商家本周菜单

本功能不新增持久化实体；以下模型均由现有餐次数据派生。

## WorkWeek（工作周）

| 字段 | 含义 | 规则 |
|------|------|------|
| `start` | 周一业务日期 | 上海业务日期，`YYYY-MM-DD` |
| `end` | 周五业务日期 | `start` 后第 4 个日历日 |
| `days` | 五个 `WorkDay` | 周一至周五，顺序稳定 |
| `selectedDate` | 当前选择 | 必须属于 `days` |

## WorkDay（工作日）

| 字段 | 含义 | 规则 |
|------|------|------|
| `date` | 业务日期 | 上海日期 |
| `weekday` | 周一至周五 | 从周起点派生 |
| `lunch` / `dinner` | `MealPosition` | 每日固定两个位置 |
| `completion` | `empty/partial/complete/open` | 由两个位置和开放状态派生 |

## MealPosition（餐次位置）

- **缺失位置**：没有真实餐次，显示“未排菜单”，可成为单餐或补齐目标。
- **真实餐次**：引用现有餐次快照、价格、截止时间和状态。
- **可编辑性**：所有 `draft` 可编辑菜单；`open`（包括截止后）和 `closed` 只读。
- **展示状态**：`missing`、`needs-config`、`ready-to-open`、`open`、`deadline-passed`、`closed`。空价格表示商家默认价，不单独构成 `needs-config`。

## GenerationIntent（生成意图）

| 类型 | 目标集合 | 是否需要覆盖确认 |
|------|----------|------------------|
| 单餐生成 | 一个缺失位置 | 否 |
| 整周首次生成 | 十个缺失位置 | 否 |
| 补齐本周 | 所有缺失位置 | 否 |
| 单餐重新生成 | 一个可编辑真实餐次 | 是 |
| 整周重新生成 | 所有可编辑草稿餐次 | 是 |

## 页面状态与转换

```text
loading-empty → loaded-empty / loaded-partial / loaded-complete / load-error
loaded-* → refreshing → loaded-*（保留旧数据）
loaded-* → generating-single / generating-week → loaded-* / replace-confirmation / pool-shortage
replace-confirmation → generating-*（确认）/ loaded-*（取消）
loaded-* → swapping → loaded-* / swap-error
```

每个 mutation 只锁定关联目标；切周 revision 与 mutation pending 分开维护。

覆盖确认同时保存原始目标和冲突响应中的已有目标；确认层展示已有目标，确认请求提交原始目标。周切换或刷新后目标不再匹配时确认失效。
