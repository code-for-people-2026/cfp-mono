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
| `menuCompletion` | `empty/partial/complete` | 只由午、晚餐菜单是否存在派生 |
| `bookingSignals` | 预订生命周期信号集合 | 独立布尔值：存在尚未截止的 `open` 餐次时 `hasOpen`；存在 `orderStatus=open` 且截止时间已到的餐次时 `hasDeadlinePassed`；存在 `closed` 餐次时 `hasClosed`。`draft` 即使截止时间已过也不产生截止信号；这些信号可与任意菜单完成度同时存在 |

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

页面从当前工作周所有尚未截止的 `open` 餐次派生 `nextDeadlineAt`；挂载、周数据变化或时钟触发后重新计算。到点只推进本地业务时钟 revision 并重建视图状态，不伪造服务端状态写入；切周和卸载时清理旧计时器。

## MutationContext（写操作上下文）

| 字段 | 含义 | 规则 |
|------|------|------|
| `mutationRevisions` | `targetKey → revision` 的单调写操作版本 | 每个生成或换菜目标发出时只推进对应目标；不同目标互不使对方失效 |
| `viewRevision` | 当前周读写协调版本 | mutation 发出和提交时推进，使此前或提交前发出的同周读取失效 |
| `weekStart` | 请求目标工作周 | 响应合并、错误提示和刷新都必须匹配 |
| `targetKeys` | 目标日期与餐次 | 只锁定和合并对应餐次 |

每次周读取捕获 `weekStart`、load revision 与 `viewRevision`；mutation 开始和提交时都推进目标周的 `viewRevision`，因此 mutation 之前或进行中读到旧数据的同周响应不能在提交后回滚菜单。成功写响应必须逐一匹配 `weekStart`、`targetKey` 及该目标 revision 后才可合并或清除当前确认；不同目标的并行响应均可独立合并，旧响应不得修改新工作周。非菜品池错误按原 `weekStart` 发起新的受版本约束读取，但用户已经切周时只允许缓存或丢弃结果，不能覆盖当前视图。

## 持久化菜单只读不变量

菜单变更只允许在餐次最新 `orderStatus=draft` 时提交。业务服务的预检查用于尽早反馈；CMS 在 `payload.config.ts` 组合导入的 `MealSlots` collection 时追加 app-local `beforeChange` 保护，使 local API、REST 和 admin 共同进入该边界。保护在 Payload 已建立的同一数据库事务中工作：Postgres 对目标餐次执行 `SELECT … FOR UPDATE` 并持锁至提交，SQLite 复用其即时写事务，随后在该事务内重新读取状态并拒绝非草稿菜单变更，CMS internal route 再把稳定冲突传给 backend。事务或锁会话不可用时必须拒绝写入。Payload 包保持 adapter-neutral，不导入 CMS app-local 模块；只依赖 hook 的 `originalDoc`、在 internal route 做条件更新，或读取后再执行无条件 PATCH，都不满足该不变量。

覆盖确认同时保存原始目标和冲突响应中的已有目标；确认层展示已有目标，确认请求提交原始目标。周切换或刷新后目标不再匹配时确认失效。
