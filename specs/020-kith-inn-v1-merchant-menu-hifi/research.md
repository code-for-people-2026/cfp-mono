# 研究结论：商家本周菜单高保真工作区

## 决策 1：上海业务日期使用固定 UTC+8 日历算术

- **Decision**：把当前时间先平移到 UTC+8 后取业务日期；所有周一、五日范围和前后周使用 UTC 日历方法处理纯 `YYYY-MM-DD`。
- **Rationale**：中国标准时间无夏令时；该方法不依赖设备时区或运行时 `Intl` 完整度，H5 与微信小程序行为一致。
- **Alternatives considered**：本地 `Date` 会随设备时区偏日；额外日期库扩大依赖；只靠格式化 API 在小程序运行时兼容性不稳定。

## 决策 2：缺失餐次是视图位置，不创建占位数据

- **Decision**：把五个工作日与真实餐次组合成十个视图位置；缺失位置只用于呈现和生成目标计算。
- **Rationale**：现有服务只在真实生成时创建餐次；提前写占位记录会改变数据语义和唯一约束。
- **Alternatives considered**：后端预建十个空餐次会扩大契约；页面只渲染已有餐次则无法稳定表达缺失午晚餐。

## 决策 3：菜单可编辑性由预订状态决定，截止时刻决定展示状态

- **Decision**：`draft` 始终可重新生成和换菜；`open`（包括截止后）与 `closed` 只读。截止时间为空或已过的 `draft` 显示待配置，但不锁定菜单。
- **Rationale**：已经开放的菜单可能已有顾客看到或预订，必须保护；尚未开放的草稿需要允许经营者修正菜单和过期配置。
- **Alternatives considered**：把所有过期截止时间视为只读会让未开放草稿无法修复；只在前端隐藏入口无法阻止陈旧页面或直接请求修改开放菜单。

## 决策 4：周读取与 mutation 共享 view revision

- **Decision**：每次周加载捕获 load revision、目标周和该周的 view revision；mutation 发出与提交时都推进 view revision，使更早或提交前发出的同周读取失效。只有三者仍匹配时读取才可写入，刷新期间保留旧数据。
- **Rationale**：仅比较 load-vs-load 无法阻止“刷新先读旧值、mutation 后提交、刷新最后返回”回滚新菜单；共享协调版本同时覆盖快速切周和同周读写乱序。
- **Alternatives considered**：全局 loading 清空列表会闪白；取消请求依赖跨端能力且不能保证回调不执行；读取和写入完全分离的 revision 无法处理同周旧快照。

## 决策 5：mutation 响应必须同时匹配目标周和操作 revision

- **Decision**：生成和换菜发出时捕获目标工作周和单调 revision；只有上下文仍匹配时才按稳定标识合并成功响应、提示或确认状态。非菜品池错误可能已部分持久化，必须重载原目标周；若用户已切周，重载结果不得写入当前周。预订配置返回时重新查询当前周。
- **Rationale**：mutation 响应虽有完整快照，但用户可在请求期间切周；仅靠 pending 无法阻止 A 周延迟响应污染 B 周。失败时重新查询又能对齐逐餐次写入的真实结果。
- **Alternatives considered**：每次写入后无条件整周重载会增加延迟且仍可能污染新周；只按餐次标识合并无法约束跨周提示和确认状态；只保留本地配置会与另一页面真实写入分叉。

## 决策 6：预订配置只增加 query 预填

- **Decision**：菜单页携带工作周起始日期和可选目标餐次，现有配置页读取后自动加载；不复制配置表单或新增服务端接口。
- **Rationale**：价格、截止时间、开放和分享已有真实工作区，最小衔接能保持单一职责。
- **Alternatives considered**：在菜单页复制完整表单会重复状态机；新增后端聚合接口没有数据缺口。

## 决策 7：菜单只读保护下沉到 CMS/Payload 原子写入边界

- **Decision**：业务服务在生成、覆盖和换菜前执行快速预检查；Payload `MealSlots` 的公共写入入口进入数据库事务，Postgres 以 `SELECT … FOR UPDATE` 锁定目标餐次直至提交，SQLite 复用 `BEGIN IMMEDIATE`，并在同一事务内重新读取最新 `orderStatus`。只有最新状态仍为 `draft` 才允许改变菜单；事务或锁会话不可用时 fail closed。CMS route/backend 稳定传递锁定冲突，前端刷新目标周。
- **Rationale**：两个请求可能都先读到 `draft`，随后开放请求先提交；只有菜单请求取得锁后在同一事务内重读并持锁到自身提交，才能关闭 TOCTOU 窗口并保护顾客已经看到或预订的菜单。并发测试必须显式覆盖“两次更新都曾看到 draft，开放先提交，菜单后取锁重读”的交错顺序。
- **Alternatives considered**：hook 的 `originalDoc` 只是写入前快照，不能证明提交时状态未变化；只做前端或业务路由预检查仍有竞态；仅在 CMS internal route 保护会被 Payload admin/REST/local API 绕过；CMS 再次普通读取后更新也不是原子保护。

## 决策 8：行为与视觉分开收口

- **Decision**：先让周视图和全部真实 mutation 通过自动化，再在最终 PR 集中 Page 3 CSS；独立 PNG 先入库，Prompt 永不提交。
- **Rationale**：行为 review 与像素 review 可独立进行，最终视觉 PR 有仓库内稳定参考且不混入业务改动。
- **Alternatives considered**：一次提交 JSX、竞态、E2E 和全量 CSS 会超过审查预算且难以定位回归。
