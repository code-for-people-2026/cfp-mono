# 功能规格：kith-inn 菜单编辑 + 接龙发布

**功能分支**: `003-kith-inn-menu-edit-publish`

**创建日期**: 2026-07-04

**状态**: 草稿（设计评审中，未开始实现）

**输入**: PRD §6.2（菜单生成 / 一键发布文案）、US-M04/M05/M07。用户描述（5 轮讨论收敛）：“菜单按餐次为单位、date-driven；日/周双视图；生成写 draft（暂定）、一键发布转 published（已发出）并按桃子的**接龙格式**生成文案供复制；编辑 published 菜单要二次确认。”

## 项目作用域

**项目**: kith-inn

**允许触碰的源码路径**:

- `apps/kith-inn-be/**`（menu 路由 + menu_plans cms 客户端 + 接龙文案纯函数）
- `apps/kith-inn-fe/**`（menu 页 日/周双视图 + 接龙文案复制 + 逻辑）
- `packages/kith-inn-shared/**`（menu plan / 接龙文案契约 schema + 类型）
- `apps/cms/**` 中 `src/app/api/internal/menu-plans/**`（新增 menu_plans 读写 internal route）
- `docs/kith-inn/DATA-MODEL.md`（§4 menu_plans M1 行为同步）

**不触碰**:

- `apps/cms/**` 的 Payload collection 定义、access/hooks、ensureConstraints、seed、migrations（`menu_plans`/`service_slots` collection 已就绪，本 feature 不改 schema）。
- `apps/kith-inn-be/src/domain/menu/core.ts` 的 `generateWeekMenu`/`swapDish` 既有**算法**（只新增按 date-targets 的薄包装 + 指定换菜 `swapDishSpecified`）。
- 「今天」agent 工具注册（US-M06）→ feature 004（本 feature 的 be 端点为它备好）。

**来源材料**: PRD §6.1（接龙）、§6.2、§5.5、§7.1/§7.2；USER-STORIES US-M04/M05/M07；TECH-SPEC §2/§3.1/§3.3。

## Clarifications（6 条，5 轮讨论 + 接龙）

### Session 2026-07-04

1. **单位 = 餐次，date-driven，砍"周"硬骨架**。`menu_plan` 本就按 (date, occasion) 一条；"周"不是实体、是周视图的一个日期范围 preset。`MenuSlot` 用**具体 date**（非抽象 mon-fri）；砍 `resolveWeekDates`。
2. **生成直接写 draft（暂定）**。`POST /menu/generate {targets}` 算建议 + upsert **draft** plan（覆写现有）。draft 可随意改。无"先建议后保存"两段式（draft 自由编辑即等价 review）。
3. **状态机 draft/published（请回 draft，之前 defer 是错的）**：
   - `draft`（暂定）：未发给顾客；随意换菜/重排。
   - `published`（已发出）：通过「一键发布」标记；颜色提示。
   - 编辑 published plan → **二次确认**（panel modal / 004 agent 确认卡）；be 对 published plan 的 generate/swap 无 `force` → **409**（caller 确认后带 `force:true`）。
   - 菜被改 → 该 plan 的 `publishText` **自动清空**（防发出旧接龙）。
4. **一键发布 = 生成接龙文案 + 复制到剪贴板 + draft→published**；**不是真发微信群**（小程序无群发 API、且无消费者端）。「已发出」是她点按钮的 intent 标记；实际贴群 offline。published plan 再次「复制文案」→ 返回缓存（不重生成）。
5. **接龙格式文案（确定性模板，去 LLM）**：publishText 按「桃子的接龙格式」生成——日期+菜名+价格+截止+接龙起始行，供顾客接龙下单。**纯模板拼接**（`buildJielongMenuText` 纯函数），M1 **不调 DeepSeek**（接龙是结构化模板，非语气润色；LLM 语气 defer）。格式需桃子真实接龙样本校准（见 §假设）。
6. **日/周双视图**：日视图（默认今天，左右滑翻页，单日/单餐操作）；周视图（toggle，N 天网格，**只生成 draft 不批量发出**；点某天跳该天日视图）。发出永远按**餐次**在日视图做。
7. **菜单流程不开餐**：`generate` 只 ensure `service_slot` 存在（缺则建 draft，不动既有 status），**不改 slot 状态**；slot open 仍由订单确认管（PRD §7.1）。→ 砍掉 archived/force-slot、partial-publish 复杂度。
8. **范围拆分**：feature 003 = be 端点 + 菜单 panel（确定性）；feature 004 = 「今天」agent 工具（US-M06，薄，消费同一套 be 端点）。

## 用户场景与测试

### 用户故事 1 — 生成 / 重新生成某餐或某几天菜（优先级：P1）

桃子进菜单 tab（默认今天），对没排的餐点「生成」；或对已排的餐点「重新生成」换一整套；或切周视图「生成这周」一次排 N 天。

**验收**：
1. 日视图对明天午餐点「生成」→ 该餐出 draft plan（2荤2素1汤，避近期主料重），状态暂定。
2. 对已 draft 的餐点「重新生成」→ 覆写 draft（新一套）。
3. 周视图「生成这周」→ 这周各餐 draft plan；点某天 → 跳该天日视图。
4. 对**已发出(published)**的餐点「重新生成」→ 弹二次确认；确认（带 force）才覆写（publishText 清空）；取消则不改。

### 用户故事 2 — 换一道菜（auto / 指定）（优先级：P1）

桃子对某餐里某道菜点「换一道」（auto，避重）或「选别的」（指定，冲突时提示）。

**验收**：
1. draft 餐的某菜点「换一道」→ 换成池里另一道（避近期主料），其余不变。
2. 「选别的」选指定菜 → 换；若破坏主料避重 → 提示「会和近期主料重复，仍要换？」，确认后换。
3. **published** 餐换菜 → 二次确认；确认后换 + publishText 清空（接龙过期）。

### 用户故事 3 — 一键发布（接龙文案 + 复制 + 标记）（优先级：P1）

桃子对某餐点「一键发布」→ 拿到**接龙格式**文案（自动复制到剪贴板）+ 该餐标「已发出」（颜色变化）；提示她去群粘贴。顾客在群里接龙下单。

**验收**：
1. draft 餐点「一键发布」→ 返回接龙文案（含日期/菜名/¥X/份/截止/接龙起始行），剪贴板复制，状态→published（颜色变化）。
2. published 餐点「复制文案」→ 返回**缓存**的 publishText（不重新生成模板）。
3. published 餐被换菜后再点「一键发布/复制」→ publishText 已清空 → 重新生成接龙文案。
4. 日视图能看出每餐状态（暂定 vs 已发出，颜色区分）。

### 边界情况

- **菜品池太小**：generate 按 `generateWeekMenu` 返 `{ok:false, pool-too-small}` → FE 提示「菜品池不够」，不写 plan。
- **跨租户**：所有 cms 写/读经 operatorScope + seller 钉死；PATCH/swap/publish find-then-update 跨租户 404。
- **刷新**：draft/published 都落库，刷新不丢（不像初版的 in-session 换菜）。
- **接龙文案格式**：M1 用默认模板；需桃子真实接龙样本校准（Clarification 5）。
- **无 force 改 published**：be 返 409 `{error:"plan-published"}`。
- **时区**：日期一律 Asia/Shanghai。

## 需求

### 功能需求

- **FR-001**: `GET /menu/plans?date=`（或 `?from=&to=`）返回当(范围)内 menu_plans（含 status、dishes、publishText?），seller-scoped。
- **FR-002**: `POST /menu/generate {targets:[{date,occasion}], force?}`：对每个 target 算 `generateWeekMenu` 建议并 upsert **draft** plan（ensure slot 存在 draft-if-missing、覆写现有 draft）；target 已是 published 且无 force → 409 `{error:"plan-published"}`。
- **FR-003**: `POST /menu/plans/:id/swap {dishId, replacementId?, force?}`：auto（`swapDish`）/指定（`swapDishSpecified`，主料避重 warning）换一道菜，upsert plan；plan 为 published 且无 force → 409；published plan 换菜 → 清空 publishText。
- **FR-004**: `POST /menu/plans/:id/publish`：draft→published（已 published 则不变）+ 若 publishText 缺失则生成（接龙模板）+ 返回 `{publishText}`。
- **FR-005**: 接龙文案由 `buildJielongMenuText(plan, seller)` **确定性模板**生成（日期+菜名+价格+截止+接龙起始行）；M1 **不调 DeepSeek**。
- **FR-006**: 菜单 tab **日视图**（默认今天、左右滑翻页）+ **周视图**（toggle、N 天网格、只生成 draft）；周视图点某天 → 跳该天日视图。
- **FR-007**: published plan 的编辑（generate 覆写 / swap）必须二次确认；panel 用 modal、004 agent 用确认卡；be 无 `force` → 409。
- **FR-008**: published 视觉标记（颜色/徽标）区别 draft。
- **FR-009**: 所有写经 cms internal（让 Payload hooks/租户 access 生效），be 不裸 SQL。
- **FR-010**: 本 feature 不改 `generateWeekMenu`/`swapDish` 算法；新增 `swapDishSpecified` + date-targets 薄包装 + `buildJielongMenuText`。
- **FR-011**: 菜单流程**不改 service_slot.status**（只 ensure 存在）；slot open 归订单确认。
- **FR-012**: 一键发布不真发微信群（无 API / 无消费者端）；= 接龙文案 + 复制 + 标记。

### 关键实体

- **MenuPlan**：`menu_plans`，status draft/published；offerings[]→菜；publishText?=接龙文案；slot→service_slot(date,occasion)。
- **接龙文案**：`buildJielongMenuText` 产的字符串（日期/菜名/价格/截止/接龙起始），存 publishText。
- **Swap 契约**：`{planId, dishId, replacementId?, force?}` → `{plan}` 或 409/404。

## 成功标准

- **SC-001**: 桃子能日视图生成/重排/换菜（draft 随意、published 二次确认）。
- **SC-002**: 桃子点「一键发布」拿到接龙格式文案（复制好），该餐标已发出。
- **SC-003**: 周视图能一次排一周 draft；逐日发出按餐次日视图做。
- **SC-004**: 全程不绕过 Payload 租户隔离/hooks；不改 generateWeekMenu 算法；不调 DeepSeek。

## 假设

- M1 接龙文案用**默认模板**（见 data-model）；需桃子真实群接龙样本校准格式（标题/分隔/截止措辞/送餐说明）——列为 follow-up 校准项，不阻塞。
- M1 不做：发布后批量改、plan 删除/清空、真发微信群、整周一键发出、菜单 tab 翻周到任意历史日期（日视图可滑到任意日期，周视图范围可调但默认本周/接下来 7 天）。
- 「今天」agent 菜单工具（US-M06）= feature 004。
- 仓库未部署、无 prod 数据；schema 走 drizzle push（不改 schema、不加 ensureConstraints）。
