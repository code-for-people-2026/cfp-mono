# 功能规格：订单页逐行勾选批量勾销 + 大小写不敏感 + 删语音勾销

**功能分支**: `007-kith-inn-orders-bulk-checkout`

**创建日期**: 2026-07-07

**状态**: 草稿（已设计评审定交互，未开始实现；等 PR #131 合后动）

**输入**: 2026-06-30 端到端 smoke 暴露的「地址片段搜不到（大小写）」+ 用户决策（订单页改逐行勾选批量勾销、删除 agent `mark_delivered` 语音工具）。订单页 filter-bulk 勾销能力本身由 feature 004 早已提供，本 feature 改交互模型 + 修大小写 bug + 下线语音路径。

## 项目作用域

**项目**: kith-inn

**允许触碰**:
- `apps/kith-inn-fe/src/pages/orders/index.tsx`（filter-bulk 改 select-bulk、加 selection state + 批量条）
- `apps/kith-inn-fe/src/logic/ordersLifecycle.ts`（内联 `addressMatches` 大小写归一化 + 新增 selection 纯函数）
- `packages/kith-inn-shared/src/addressMatch.ts`（canonical `addressMatches` 大小写归一化）
- `apps/kith-inn-be/src/routes/delivery.ts`（删 `{address}` 片段模式 + 注释）
- `apps/kith-inn-be/src/agent/tools.ts` / `services.ts` / `run.ts`（删 `mark_delivered` 工具链）
- `apps/kith-inn-be/src/routes/chat.ts`（删 `mark_delivered` dispatch case）
- `apps/kith-inn-be/src/domain/delivery/derivations.ts`（注释更新，去 agent mark_delivered 字样）
- 各对应 `*.test.ts`

**不触碰**: be `{ids}` 端点契约、订单付款/确认流程、today 页 / 菜单 tab / 菜品池 tab、collection schema、agent 其余 9 个写工具。

## Clarifications

- **Q: 批量勾销交互用哪种？** → A: **逐行勾选 + 顶部「批量送达」按钮**（非现状的 filter→modal→confirm）。过滤输入框保留，但语义从「提交片段」降级为「缩候选集」。现状的 `batchDeliver`（modal 全选命中集）改成 select-bulk。
- **Q: 地址片段大小写？** → A: **大小写不敏感**。`3a` 要匹到 `3A-1201`。canonical（shared）+ FE 内联副本两处同步 `toLowerCase`，纯数字分支（楼栋边界）不受影响。
- **Q: agent `mark_delivered` 语音工具去留？** → A: **删**。UI 确定性勾销已够（feature 004 的 `PATCH /delivery/fulfillments {ids}`），语音路径（DeepSeek tool-calling 实测不稳）下线。整链移除：tool 定义 + AgentServices 类型 + service 方法 + prompt + dispatch + 测试。
- **Q: `delivery.ts` 的 `{address}` 片段模式去留？** → A: **删**。已确认 FE 三个调用方（`today/index.tsx:193`、`orders/index.tsx:99`/`:171`）全用 `{ids}`，`{address}` 模式无 FE 调用方，原本只服务 agent 的 service 路径；agent 工具删后彻底死代码。
- **Q: 每行「标送达」按钮保留吗？** → A: **保留**。单条快速勾销仍有用，与批量并存。
- **Q: 勾选状态持久吗？跨餐次吗？** → A: **不持久、不跨餐次**。M1 单操作者，选择是 ephemeral（组件 state）；切餐次 tab 或改过滤时清空选择，避免跨集误操作。

## 用户场景

### US1 — 搜 + 逐行勾选 + 批量送达
桃子在订单页午餐 tab，地址框输 `3a` → 列表缩到 3A 开头的几行（大小写修好后能匹到）→ 逐行点勾其中 2 行 → 顶部「已选 2 · 批量送达」→ 点 → 这 2 单送✓，其余不动。

### US2 — 不搜，直接勾
桃子不输片段，当前餐次列表里直接勾几行 → 批量送达。

### US3 — 单条快速勾销（保留现状）
某行点「标送达」按钮 → 单条 done（per-row 按钮不变）。

## 需求

- **FR-001**: `packages/kith-inn-shared/src/addressMatch.ts` 的 `addressMatches`：字母分支改为 `address.toLowerCase().startsWith(a.toLowerCase())`；纯数字分支（楼栋边界）不动。补单测覆盖 `3a↔3A`、`3A↔3a`、纯数字行为不变、前缀不退化为 substring。
- **FR-002**: `apps/kith-inn-fe/src/logic/ordersLifecycle.ts` 内联副本 `addressMatches` 同步改（keep-in-sync 注释已要求）；补 ordersLifecycle 单测。
- **FR-003**: `ordersLifecycle.ts` 新增 selection 纯函数（如 `toggleSelection`、`selectableRows(rows, occasion)`=当前餐次+未取消+待送），单测覆盖。
- **FR-004**: `apps/kith-inn-fe/src/pages/orders/index.tsx`：加 `selected: Set<id>` state；selectable 行可点 toggle（整行或勾选格）；顶部条「已选 N · [批量送达]」（N=0 禁用）；批量送达 PATCH `{ids:[...selected], set:{status:"done"}}` 复用 `markDeliveredUrl()`，成功后清选择 + reload；切餐次/改过滤清空选择。过滤输入保留作缩候选集。per-row「标送达」按钮保留。
- **FR-005**: 删 agent `mark_delivered`：`tools.ts`（工具 def+execute、`AgentServices.markDelivered`、`previewDelivered` 类型）、`services.ts`（`markDelivered`、`previewDelivered`）、`run.ts`（prompt 能力清单 + 纪律列举）、`chat.ts`（`case "mark_delivered"`）、相关 `*.test.ts`（`services.test.ts`、`chat.test.ts`）。
- **FR-006**: 删 `delivery.ts` `{address}` 片段模式（grep 复确认零 FE 调用后）+ 更新 :19-23 注释（去「agent/语音用」）；`derivations.ts:58` 注释去「agent's mark_delivered」字样。
- **FR-007**: 不引入新依赖做勾选框——FE 无 NutUI Checkbox 用法，用自定义 tap-toggle（复用 `送○/付○` Tag/View 样式）。

## 成功标准

- **SC-001**: 地址框输 `3a` 能过滤出地址以 `3a`/`3A` 开头的待送行（修大小写 bug）。
- **SC-002**: 逐行勾选 N 行 → 「批量送达」→ 恰好这 N 单变 done，未选行不动；切餐次/改过滤清空选择。
- **SC-003**: agent 不再有 `mark_delivered` 能力——语音「3a 送了」不会触发送达标记（桃子改走 UI）。
- **SC-004**: `pnpm verify` 全绿（FE 100% 覆盖含新 selection 逻辑；be 删除后覆盖仍 100%）。

## 假设 / deferred

- M1 单操作者，不处理并发勾销（两人同时标同一单）。
- 选择状态 ephemeral：不持久化、不跨页/跨餐次。
- 不改 be `{ids}` 端点契约（只删并存的 `{address}` 模式）。
- 「全选当前过滤集」按钮 deferred（M1 逐行够用，可后加）。
- 跨日 / 跨餐次批量勾销 deferred。
- 语音勾销能力本 feature 删除（如将来要恢复，走确定性路由而非 DeepSeek tool-call）。
