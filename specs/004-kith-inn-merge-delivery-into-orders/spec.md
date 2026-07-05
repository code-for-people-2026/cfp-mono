# 功能规格：kith-inn 合并配送进订单（订单全生命周期）

**功能分支**: `004-kith-inn-merge-delivery-into-orders`

**创建日期**: 2026-07-05

**状态**: 草稿（设计评审中，未开始实现）

**输入**: PRD §5.5（详情 tab）、§6.3（送餐）、§6.5（收款）。用户描述：“配送 tab 砍掉，订单 tab 做全生命周期（下单→付款→送达）+ 按地址聚拢 + 地址前缀批量勾销；每单两个独立状态图标（履约/付款）一眼看出组合；默认聚焦最近未完成餐次、可滑动。”

## 项目作用域

**项目**: kith-inn

**允许触碰的源码路径**:

- `apps/kith-inn-fe/**`（订单页重写、删配送页、TabBar 3 tab、订单生命周期逻辑）
- `apps/kith-inn-be/**`（**预期零改动**——orders/delivery 端点都已有；如必须，仅微调）
- `docs/kith-inn/PRD.md`（§5.5 四 tab → 三 tab）、`docs/kith-inn/DATA-MODEL.md`（送餐 tab 并入订单）

**不触碰**: `menu_plans`/`orders`/`fulfillments` collection schema、be 路由契约（既有 `GET /orders`、`GET /delivery`、`PATCH /fulfillments`、`PATCH /orders` 全复用）。

## Clarifications

### Session 2026-07-05

- **Q: 配送 tab 留还是并？** → A: **并进订单，4 tab → 3 tab**。配送 tab 当年的"按楼栋结构化分拣"前提（PRD v1.9 已弃）本就不成立——桃子地址是松散速记（`3a27b`/`隔壁小区`），不可 geocode、app 无法也不该规划路线（路线在她脑子里）。app 只做按地址字符串排序 + 前缀批量勾销。

- **Q: 勾销怎么对松散地址批量？** → A: **地址前缀匹配**（`fulfillmentsMatchingAddress`，feature ① 已修：前缀 + 纯数字楼栋边界）。桃子输 `3a` → 列今天本餐次所有地址前缀含 `3a` 的待送 → 确认 → 全标送达 = "送完一栋勾一次"。

- **Q: 缺口（X 单未送）基于天还是餐次？** → A: **当前餐次**（今天午餐还差几单）。order = 顾客+日期+餐次，送餐按餐次（午一批、晚一批），不跨餐合计。

- **Q: 订单页默认看什么？** → A: **最近的未完成餐次**——今天午餐有 pending → 落午餐；午餐全履约 → 落晚餐；都完成 → 落晚餐供回看。可左右滑前一餐/后一餐（M1 限今天午/晚；跨日翻看 deferred）。

- **Q: 状态怎么一眼看出？** → A: **双轴独立图标**（类 Slack PR 的 emoji reaction）——每行两个并行小指示：**履**（履约 pending○/done✓）+ **付**（付款 unpaid○/paid✓），各上各的色。组合一眼可见：`履✓付○`（已送未付·注意）、`履○付✓`（已付待送）、`履○付○`（待送待付）、`履✓付✓`（全完成·淡）。order.status（draft/confirmed/canceled）作底色。

- **Q: be 改什么？** → A: **零契约改动**。FE 拉 `GET /orders?date=` + `GET /delivery?date=`（fulfillments）在前端 join（order.id == fulfillment.order.id）。收款用既有 `PATCH /orders`（payment）。地址前缀勾销走 **前端 preview + `PATCH /fulfillments {ids}` 精确勾**（见下条）。唯一 be 改动：`addressMatches` 抽到 shared、`derivations.ts` import（纯 helper 重定位、非契约/行为变更）。

- **Q: 地址前缀勾销怎么"先确认再勾"？** → A: **前端 preview，不调 be 的 `{address}` 批量端点**（Codex #118 P1：那个端点立刻勾销、不分餐次、只返 `{ok,count}`，没法 preview/撤）。FE 用已加载的 fulfillments + `previewAddressMatch`（当前餐次 + 非 canceled + pending + shared `addressMatches` 前缀+边界）列候选 → 确认卡 → `PATCH /fulfillments {ids}` 精确勾。`addressMatches` 抽 shared，FE 与 be `fulfillmentsMatchingAddress` 共用同一逻辑防漂移。

## 用户场景与测试

### 用户故事 1 — 一个订单的全生命周期一眼可见（优先级：P1）

桃子进订单 tab，默认落在最近没送完的那餐；每行订单两个小图标（履约/付款）独立显示，她一眼看出"这单送了没、付了没"——包括"已送但没付"这种组合。

**验收**:
1. 午餐有未送单 → 进 tab 默认落午餐；午餐全送完 → 默认落晚餐。
2. 每行有**两个独立**状态指示（履/付），各自染色；`履✓付○`（已送未付）视觉上与 `履○付✓`（已付待送）、`履✓付✓`（全完成）明显区分。
3. order.status：draft 淡/虚、confirmed 实、canceled 划线灰。

### 用户故事 2 — 按地址聚拢 + 前缀批量勾销（优先级：P1）

桃子送完 3栋A → 订单页输 `3a` → 列出今天本餐次地址前缀含 `3a` 的待送单 → 确认 → 一次全标送达。也能单条点勾销。

**验收**:
1. 列表按地址字符串排序（`3a18b`、`3a27a` 挨一起）。
2. 输 `3a` → 匹配今天本餐次所有地址 startsWith `3a` 的 pending 履约（用 ① 修好的前缀+边界逻辑）→ 确认卡列出 → 标 done。
3. 输 `3a` **不**误命中 `2d03a`（前缀）；输 `2` **不**误命中 `26B-301`（楼栋边界）。
4. tap 单行 → 标该单送达。
5. 缺口："本餐次 X 单未送"实时更新。

### 用户故事 3 — 收款仍在订单页（优先级：P1）

桃子在订单行标已付（复用既有 `PATCH /orders paymentStatus`）；付图标变 ✓。

**验收**:
1. 单行「标已付」→ paymentStatus unpaid→paid → 付图标 ✓；履约状态不动。
2. 已付可回退 unpaid（误操作）。

### 用户故事 4 — 滑动看前一餐/后一餐（优先级：P2）

桃子送完晚餐，滑回午餐确认"都履约了，但有没有没付款的"。

**验收**:
1. 左右滑切午餐/晚餐；切走再回来状态保持。
2. M1 限今天午/晚；跨日翻看 deferred。

### 边界情况

- **无订单**：空状态"今天还没有订单"。
- **draft 订单**：显示但淡（未确认、未物化履约）。
- **canceled**：划线灰、不计入缺口、不进待送。
- **多地址命中前缀**：确认卡列全部，她可全选/取消个别。
- **地址前缀 0 命中**：提示"没匹配到"。
- **时区**：今天/餐次按 Asia/Shanghai。

## 需求

- **FR-001**: TabBar 改三 tab（今天 / 菜单 / 订单）；删 `pages/delivery`。
- **FR-002**: 订单 tab 默认聚焦**最近的未完成餐次**（今天最早一个有 pending 履约的餐次；都完成则最新餐次供回看）；可左右滑切午/晚。
- **FR-003**: 每行订单显示**双轴独立状态**：履（fulfillment.status pending/done）+ 付（paymentStatus unpaid/paid），各图标各色；order.status 作底色。组合一眼可辨（含 `履✓付○` 已送未付）。
- **FR-004**: 列表按地址字符串排序（同/近楼栋挨一起）。
- **FR-005**: **地址前缀批量勾销**——输片段 → **前端 preview**（`previewAddressMatch`：当前餐次 + 非 canceled + pending + shared `addressMatches` 前缀+边界，**不落库**）→ 多命中给确认卡 → 确认后 `PATCH /fulfillments {ids}` 精确勾；0 命中提示。**不**用 be 的 `{address}` 批量端点（它立刻勾销、不分餐次）。
- **FR-006**: 单行勾销 → `PATCH /fulfillments {ids:[...]}`；单行标已付/回退 → `PATCH /orders {paymentStatus}`。
- **FR-007**: 缺口——当前餐次**非 canceled** 行里 `fulfillment.status=pending` 的计数，顶部展示。
- **FR-008**: be 端**零契约改动**（orders/delivery/fulfillments 端点全复用；FE join orders+fulfillments）。唯一 be 改动：`addressMatches` 抽到 shared、`derivations.ts` import（纯 helper 重定位、非契约/行为变更），FE preview 与 be 共用前缀+边界逻辑防漂移。
- **FR-009**: 同 PR 更新 `docs/kith-inn/PRD.md` §5.5（4 tab → 3 tab）+ `DATA-MODEL.md`（送餐并入订单）。

## 成功标准

- **SC-001**: 桃子在订单 tab 一眼看出每单"送了没、付了没"（双轴图标，含已送未付组合）。
- **SC-002**: 送完一栋输 `3a` 一次勾掉该栋全部（前缀+边界，不误勾别栋）。
- **SC-003**: 默认落在最近没送完的餐次，送完自动让位下一餐；可滑回确认。
- **SC-004**: be 端零改动；TabBar 3 tab。

## 假设 / deferred

- M1 餐次滑动限今天午/晚；跨日翻看（昨日/明日）deferred（可后加日期选择）。
- 地址聚拢用字符串排序（不调相似度 fuzzy；她扫眼自识别楼栋）。
- 美团式自动路线规划 **永不做**（地址不可 geocode；路线在桃子脑子）。
- 「今天」agent 的 `mark_delivered` 工具不受影响（复用同一 `fulfillmentsMatchingAddress`，① 已修）。
- 收款催收提醒、reconciled（已核对入账）的专门 UI 属 M2，本 feature 只把 paid/unpaid 两态做进双轴。
