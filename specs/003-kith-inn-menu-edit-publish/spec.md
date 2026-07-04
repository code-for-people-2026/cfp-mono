# 功能规格：kith-inn 菜单换菜 + 发群文案（持久化）

**功能分支**: `003-kith-inn-menu-edit-publish`

**创建日期**: 2026-07-04

**状态**: 草稿（设计评审中，未开始实现）

**输入**: PRD §6.2（菜单生成 · 一键随机换菜 / 用户指定换菜 / 一键发布文案）、US-M04 / US-M05 / US-M07。用户描述：“菜单 tab 现在只能看不能改；让桃子能换菜、一键生成发群文案，并且发布后的菜单在 app 里留存可回看。”

## 项目作用域

**项目**: kith-inn

**允许触碰的源码路径**:

- `apps/kith-inn-be/**`（menu 路由 + menu_plans cms 客户端 + 周日期解析纯函数）
- `apps/kith-inn-fe/**`（menu 页 换菜 / 发布 / 复制文案 UI + 逻辑）
- `packages/kith-inn-shared/**`（swap / published 契约 schema + 类型）
- `apps/cms/**` 中 `src/app/api/internal/menu-plans/**`（新增 menu_plans 读写 internal route）
- `docs/kith-inn/DATA-MODEL.md`（§4 menu_plans M1 行为说明同步）

**不触碰**:

- `apps/cms/**` 的 Payload collection 定义、access/hooks、ensureConstraints、seed、migrations（`menu_plans` / `service_slots` collection 已就绪，本 feature 不改 schema）。
- `apps/kith-inn-be/src/domain/menu/core.ts` 的 `generateWeekMenu`（生成内核不动；只**新增** `swapDishSpecified` 与周日期解析纯函数）。

**来源材料**:

- `docs/kith-inn/PRD.md` §6.2、§5.5（详情 tab 通则）、§7.1（菜单发布=开餐）、§7.2 menu_plans
- `docs/kith-inn/USER-STORIES.md` US-M04（随机换一道）/ US-M05（指定换菜）/ US-M07（发群文案）
- `docs/kith-inn/TECH-SPEC.md` §2（写经 cms internal）、§3.1（租户隔离）、§3.3（确认/发布物化、archived→force 守卫）
- `docs/kith-inn/DATA-MODEL.md` §3 service_slots、§4 menu_plans

## Clarifications

### Session 2026-07-04

- **Q: 换菜结果要不要持久化？** → A（评审拍板，选「乙 全套持久化」）: **发布时落 `menu_plans`**。换菜本身在发布前是 in-session（前端持有周菜单、调纯 `POST /menu/swap` 拿替换菜）；点「发布」才 upsert `menu_plans`（每餐次一条，status=published）+ upsert `service_slots`→open（PRD §7.1 菜单发布=开餐）。app 内可回看发布过的菜单。

- **Q: publishText（发群文案）什么粒度、何时生成？** → A: **每餐次 plan、按需生成**。桃子是「前一晚发**次日**菜单」（PRD §1.2），不是整周一坨；`POST /menu/plans/:id/publish-text` 对单个 plan 调 `publishMenuText`（LLM）→ 存进 `menu_plan.publishText` → 返回。发布本身不调 LLM（省 token）。

- **Q: menu_plan 的 draft 状态用吗？** → A: **M1 不用 draft，发布直接 `published`**。`menu_plans.status` 字段保留（collection 已有 draft/published 枚举），但 M1 只写 published；draft 持久化 defer（桃子要么没发要么发了，无"草稿菜单"中间态）。

- **Q: 发布后还能换菜吗？** → A: **M1 不做发布后换菜**。换菜只在发布前（in-session menu 上）。发布后改 = 编辑 published plan + 二次确认（PRD §5.5「改归档内容要二次确认」），defer 到后续。重新发布（upsert）覆盖即可。

- **Q: 菜单 tab 默认显示什么？** → A: **当周有 published → 显示 published（只读 + 每餐次「复制文案」）；无 → 显示生成建议（带「换一道」「选别的」「发布」）**。published 是 system of record，优先显示。

- **Q: 周菜单的 mon-fri 怎么落具体日期？** → A: be 纯函数按 **Asia/Shanghai 当周**（含 today 的周一至周五）把 MenuSlot 的 day（mon-fri）解析成具体 date；用于 publish 写 slot、published 回看过滤。

- **Q: US-M05「指定换菜」M1 做到哪？** → A: **be 端点支持（`POST /menu/swap` 带 `replacementId`）+ FE 菜品选择器**。FE 在菜单建议页每道菜给「换一道」（auto，调 `swapDish`）和「选别的」（弹池子选择器，选定 → 指定换，主料避重冲突时提示确认）。两模式都做。

## 用户场景与测试

### 用户故事 1 — 在生成的菜单上一键换菜（优先级：P1）

桃子在菜单 tab 看到本周建议菜单，某道菜她不想做，点「换一道」就换成池子里另一道（默认尽量避开近期主料重复）；或点「选别的」从池子里挑一道指定的。

**优先级理由**: PRD §6.2「一键随机换菜 / 用户指定优先」；US-M04/US-M05。当前菜单 tab 只读，她没法改。

**独立测试**: 菜单建议页对某道菜点「换一道」→ 该道被替换、其它不变、菜单仍 5 天×2 餐结构完整；点「选别的」选了另一道 → 替换为指定菜；选了破坏主料避重的 → 提示、确认后才换。

**验收场景**:

1. **假设** 桃子在建议页对周一午餐的「红烧牛肉」点「换一道」，**当** 拿到替换菜，**则** 周一午餐那道换成新菜，其余 9 餐不变。
2. **假设** 替换菜默认尽量不与近期主料重复（`swapDish` 的避重约束生效）。
3. **假设** 桃子点「选别的」并从池子选了「香菇滑鸡」，**当** 提交，**则** 该道换成「香菇滑鸡」。
4. **假设** 指定替换会破坏主料避重（如与昨天主料重复），**当** 提交，**则** 提示「会和近期主料重复，仍要换吗？」，确认后才换（PRD §6.2 用户强制指定优先、但提示）。
5. **假设** 桃子没点发布就刷新页面，**则** 换菜结果**不保留**（in-session；只有「发布」才落库）。

---

### 用户故事 2 — 一键发布本周菜单（持久化 + 开餐）（优先级：P1）

桃子改完菜单点「发布」，菜单写进 app（menu_plans）、对应餐次开餐（service_slots→open）；之后打开菜单 tab 看到的是发布过的菜单，不是新生成建议。

**优先级理由**: PRD §6.2「一周一次性排好，每天直接执行」+ §7.1「菜单发布同样开餐」；评审选「乙」就是要 app 内留存。

**独立测试**: 建议页点发布 → 当周 10 个 menu_plan 建好（status=published）、对应 service_slots 变 open；刷新 / 重开菜单 tab → 显示 published 菜单（不再重新生成建议）。

**验收场景**:

1. **假设** 桃子发布本周菜单，**当** 成功，**则** 当周每个餐次（周一至五 × 午晚）有一条 menu_plan（status=published，offerings=该餐 dishes），对应 service_slot 状态 open。
2. **假设** 桃子再次发布（改了菜再发），**当** 成功，**则** 已存在的 menu_plan 被 upsert 更新（不重复建），slot 仍 open。
3. **假设** 某餐次的 slot 已 archived，**当** 发布，**则** 返回错误（archived 不自动重开，需 force / 二次确认——M1 直接报错，force 守卫复用订单确认那条 cms 路径）。
4. **假设** 桃子重开菜单 tab，**当** 当周已有 published，**则** 显示 published 菜单（只读），不再生成新建议。

---

### 用户故事 3 — 每天一键复制次日发群文案（优先级：P1）

桃子在已发布菜单上，对某餐次点「复制文案」，拿到一段她本人语气的微信群通知（菜名+价格+截止），复制贴群。

**优先级理由**: PRD §6.2「一键发布文案」、US-M07；这是她 #1 痛点（§1.3「发菜单是最头疼」）的直接解药。

**独立测试**: 已发布菜单对周一午餐点「复制文案」→ 拿到文案字符串（含菜名+价格+截止提醒），文案存进该 plan；再点直接复制已存文案（不重复调 LLM）。

**验收场景**:

1. **假设** 桃子对某已发布餐次点「复制文案」，**当** 成功，**则** 返回一段群通知文案（菜名、¥X/份、10 点截止提醒），并写入该 menu_plan.publishText；FE 自动复制到剪贴板。
2. **假设** 该餐次已生成过 publishText，**当** 再点「复制文案」，**则** 直接返回已存的（不重复调 LLM）。
3. **假设** LLM 超时/失败，**当** 调用，**则** 返回错误提示（不阻塞菜单本身——菜单已保存，文案可重试）。

### 边界情况

- **菜品池太小**：发布不阻塞（发布的是已有建议/手改菜单）；若建议页就 pool-too-small（`GET /menu/week` 返回 `{ok:false}`），FE 不展示换菜/发布，提示「菜品池不够」。
- **重复发布**：upsert，更新现有 menu_plan（不重复建）。
- **archived slot**：发布报错（409 上抛），不自动重开。
- **跨租户**：所有 cms 写/读经 operatorScope + ownedBy 钉 seller；PATCH publishText find-then-update 跨租户 404。
- **publishText 失败**：菜单已存，文案可重试；不回滚发布。
- **刷新丢换菜**：未发布的换菜是 in-session，刷新即失（设计如此；只有发布落库）。
- **时区**：周解析、slot 日期一律 Asia/Shanghai。

## 需求

### 功能需求

- **FR-001**: 系统必须提供 `POST /menu/swap`（无状态）：前端传入当前 menu + target{day,occasion,dishId}（+ 可选 replacementId），后端取菜品池、调用确定性换菜，返回替换菜；不带 replacementId 走 `swapDish`（auto），带 replacementId 走指定换菜（校验在池内、非同菜、返回主料避重 warning）。
- **FR-002**: 系统必须在菜单建议页让桃子对每道菜「换一道」（auto）和「选别的」（指定，弹池子选择器）。
- **FR-003**: 「选别的」指定替换若破坏主料避重，系统必须先提示（warning），桃子确认后才换（US-M05）。
- **FR-004**: 系统必须提供 `POST /menu/publish`：把周菜单（MenuSlot[]，mon-fri）按 Asia/Shanghai 当周解析成具体日期，每餐次 upsert `service_slots`→open + upsert `menu_plans`(offerings[], status=published)，返回 plans；不调 LLM。
- **FR-005**: `POST /menu/publish` 遇 archived slot 必须 409 上抛（复用 cms `service-slots/upsert` 的 archived 守卫），不自动重开；force/二次确认 M1 不做。**写入按餐次原子**（slot + plan 配对逐餐次写，遇 archived 立即停，不留「开餐但无菜单」半发布；已写餐次保持一致，重新发布 upsert 续上）。
- **FR-006**: 重复发布必须 upsert（更新现有 menu_plan，不重复建）。
- **FR-007**: 系统必须提供 `GET /menu/published?date=`：按 Asia/Shanghai 当周（date 默认 today）回读已发布的 menu_plans（depth: slot + offerings，含 publishText），按餐次结构返回。
- **FR-008**: 系统必须提供 `POST /menu/plans/:id/publish-text`：加载该 plan、调 `publishMenuText`（LLM）、把文案写进 `menu_plan.publishText`、返回文案；已存 publishText 时直接返回（不重复调 LLM）。
- **FR-009**: 菜单 tab 必须按「当周是否有 published」决定视图：有 → 只读 published + 每餐次「复制文案」；无 → 生成建议 + 「换一道」/「选别的」/「发布」。
- **FR-010**: 所有写（publish、publish-text）经 cms internal API（让 Payload hooks/租户 access 生效），BE 不直连 DB 写裸 SQL。
- **FR-011**: 所有写以操作者 JWT 的 sellerId 钉租户；publish-text 的 PATCH find-then-update 跨租户 404。
- **FR-012**: 本 feature 不改 `generateWeekMenu` / `swapDish` 既有签名；只**新增** `swapDishSpecified`（指定换 + warning）与周日期解析纯函数。
- **FR-013**: `publishMenuText` 失败不得阻塞发布（菜单已存，文案可重试）。

### 关键实体

- **MenuPlan（已发布菜单项）**：`menu_plans` 里 status=published 的记录；M1 用户面只读 offerings（菜）+ publishText（文案，按需）。slot→当餐次 service_slot。
- **Swap 输入/输出（M1 契约）**：`{ menu, target: {day, occasion, dishId}, replacementId? }` → `{ ok:true, replacement: MenuDish, warning? } | { ok:false, reason }`（`ok` 判别 union）。由 shared schema 定义，FE↔BE 共享。
- **Published 菜单视图**：`GET /menu/published` 返回的按餐次结构（date/occasion/planId/dishes/publishText?），FE 直接渲染。

## 成功标准

### 可衡量结果

- **SC-001**: 桃子能在菜单建议页对任意菜「换一道」（auto，避重）或「选别的」（指定，冲突提示确认）。
- **SC-002**: 桃子点「发布」后，当周菜单进 app（menu_plans=published、slots=open），重开页面看到的是发布过的菜单。
- **SC-003**: 桃子能在已发布菜单上对任意餐次「复制文案」，拿到她语气的群通知；二次复制不重复调 LLM。
- **SC-004**: 发布与 publish-text 全程不绕过 Payload 租户隔离/hooks。
- **SC-005**: `generateWeekMenu` / `swapDish` 内核零改动。

## 假设

- M1 菜单 tab 默认视图按「当周是否有 published」二分（无日期选择器 / 切周——defer）。
- M1 不做发布后换菜（重新发布 upsert 覆盖即可）。
- M1 不做 menu_plan draft 持久化（只 published）。
- M1 publishText 每餐次按需生成（不做整周一坨文案）。
- 「今天」主对话 agent 口头改菜单 / 口头发布（US-M06）defer（本 feature 只做确定性菜单 tab；agent menu 工具注册属另一 feature，但本 feature 的 be 端点已为它备好）。
- 仓库未部署、无 prod 数据；schema 走 drizzle push（collection 已就绪，本 feature 不改 schema、不加 ensureConstraints 索引）。
- 继续沿用现有 kith-inn 鉴权与 seller/operator scoping。
