# 功能规格：kith-inn 菜品池 CRUD

**功能分支**: `002-kith-inn-dish-pool-crud`

**创建日期**: 2026-07-03

**状态**: 草稿（设计评审中，未开始实现）

**输入**: PRD §6.2（菜品池）/ US-M02（菜品池维护菜名 + 主料）。用户描述：“让桃子在菜品池里增、删、改菜，能软删除也能重新启用；录入时直接带上荤素类别。”

## 项目作用域

**项目**: kith-inn

**允许触碰的源码路径**:

- `apps/kith-inn-be/**`（offerings 路由 + cms 写客户端）
- `apps/kith-inn-fe/**`（kitchen 菜品池页 CRUD UI + 逻辑）
- `packages/kith-inn-shared/**`（offerings 写 schema + 类型）
- `apps/cms/**` 中 `src/app/api/internal/offerings/**`（新增写 internal route）
- `docs/kith-inn/DATA-MODEL.md`（§3 offerings 行为说明同步）

**不触碰**:

- `apps/cms/**` 的 Payload collection 定义、access/hooks、ensureConstraints、seed、migrations（`offerings` collection 字段已就绪，本 feature 不改 schema）。
- `apps/kith-inn-be/src/domain/menu/core.ts`（菜单生成内核，只保证新菜能被选到，不改内核）。

**来源材料**:

- `docs/kith-inn/PRD.md` §6.2（菜品池）、§7.1 offerings、§7.5 治理铁律
- `docs/kith-inn/USER-STORIES.md` US-M02（菜品池维护菜名 + 主料）
- `docs/kith-inn/TECH-SPEC.md` §2（经 cms internal API 写、不绕过 Payload）、§3.1（租户隔离硬机制）、§3.3（快照/派生/归档）
- `docs/kith-inn/DATA-MODEL.md` §3 offerings、§6 硬规则

## Clarifications

### Session 2026-07-03

- **Q: 删除一道菜是物理删除还是软停用？能否恢复？** → A（评审拍板）: **软停用 `active=false`，且支持恢复（重新启用 `active=true`）**。理由：`offerings` 被 `order_items.offering`、`menu_plans.offerings[]`、`offerings.parentOfferings` 以 relationship 引用，Payload relationship 落地为 postgres FK（`ON DELETE NO ACTION`），物理删除被引用的菜会抛 FK 错误；PRD/DATA-MODEL 已为 `active` 字段定义软停用语义。M1 提供「删除（停用）」+「恢复（启用）」一对动作；物理删除 / 批量清理 deferred。

- **Q: `category`（荤/素/汤/主食）怎么定？** → A（评审拍板，反转早先"后端推断"方案）: **录入时由桃子在表单里直接选 category（新增必填、可编辑）**。理由：菜单内核 `generateWeekMenu` 需要 category 才能组「2荤2素1汤」；与其后端启发式推断（歧义默认 veg、且无纠错路径），不如录入时就带对——桃子最清楚自己这道菜是荤是素。表单收 name + mainIngredient + category（3 字段）；`category` 来自 `OFFERING_CATEGORIES`（meat/veg/soup/staple）。放弃 `inferCategory` 推断方案。

- **Q: 菜品池列表如何展示已停用的菜？** → A: 菜品池页分两区——「菜品池」（`active=true` 的 component）+ 「已停用」（`active=false` 的 component，带「恢复」按钮）。be `GET /offerings` 返回所有 `kind=component` 的菜（带 `active` 标记），FE 按 `active` 分区。菜单生成候选池仍只取 `active && component`（`menu.ts` 已有过滤，不动）。

## 用户场景与测试

### 用户故事 1 — 新增一道菜到菜品池（优先级：P1）

桃子在菜品池页点「新增」，填菜名（必填）、主料（可选）、分类（荤/素/汤/主食，必填），确认后这道菜出现在菜品池列表里，并且随后生成菜单时能按正确荤素被选到。

**优先级理由**: PRD §6.2「菜品池增删改只需要菜名 + 主料」+ 评审决定录入带分类；这是菜品池从只读变为可维护的核心动作。

**独立测试**: 菜品池初始有 N 道菜；新增一道后列表变 N+1，且该菜 `kind=component`、`active=true`、`category` 为所选值；调用菜单生成，新菜按 category 进入对应荤/素/汤位。

**验收场景**:

1. **假设** 桃子新增「蒜蓉空心菜」/ 主料「青菜」/ 分类「素」，**当** 提交成功，**则** 列表新增该菜，归到「主料 · 青菜」分组，`category=veg`。
2. **假设** 桃子新增菜时只填菜名不填主料，**当** 提交成功，**则** 该菜归到「主料 · 其他」分组（复用 `groupByMainIngredient` 的 FALLBACK_KEY）。
3. **假设** 桃子新增菜时没填菜名或没选分类，**当** 提交，**则** 前端/后端拒绝（400），不创建。
4. **假设** 桃子新增「红烧肉」/ 主料「猪肉」/ 分类「荤」，**当** 随后生成一周菜单，**则** 该菜进入候选池且 `category=meat`，会被选进荤菜位。

---

### 用户故事 2 — 修改菜名 / 主料 / 分类（优先级：P1）

桃子点某道菜的「编辑」，改菜名、主料或分类，确认后列表更新。改的是同一行（保留 id），不破坏已有订单/菜单对它的引用。

**优先级理由**: 录菜写错字、调主料归类、或纠正分类（把误录为素的荤菜改回荤）。

**独立测试**: 选一道已存在的菜，改其菜名/主料/分类；列表对应行更新；id 不变。

**验收场景**:

1. **假设** 桃子把「番茄炒蛋」改名为「西红柿炒蛋」，**当** 提交成功，**则** 列表对应行显示新名字，id 不变。
2. **假设** 桃子把「番茄炒蛋」的主料从「鸡蛋」改成「番茄」，**当** 提交成功，**则** 它从「主料 · 鸡蛋」分组移到「主料 · 番茄」分组。
3. **假设** 桃子把某菜分类从「素」改成「荤」，**当** 提交成功，**则** 重新生成菜单时该菜进荤菜位（分类可编辑 = 有纠错路径）。
4. **假设** 桃子编辑时把菜名清空，**当** 提交，**则** 拒绝（400），菜名保持原值。
5. **假设** M1 编辑表单只暴露 name/mainIngredient/category，**当** 桃子编辑，**则** 其他字段（priceCents/tags/recipe/kind/active）不被改动（写白名单）。

---

### 用户故事 3 — 从菜品池移除一道菜，并能在「已停用」里恢复（优先级：P1）

桃子点某道菜的「删除」，确认后这道菜从「菜品池」区移到「已停用」区，不再被菜单生成选中；但已引用它的历史订单/菜单不受破坏。她在「已停用」区点「恢复」，菜回到「菜品池」、重新可被菜单选中。

**优先级理由**: 菜写错/重复了想让它从池里消失，但不能真删（订单/菜单引用 FK）；误删后要能找回。软停用 + 恢复一对动作覆盖两种情况。

**独立测试**: 选一道菜删除 → 移到「已停用」；菜单生成不再选它；该菜对应的 order_items/menu_plans 仍能 depth 读取。在「已停用」点恢复 → 回到「菜品池」；菜单生成重新可选。

**验收场景**:

1. **假设** 桃子删除「蒜蓉空心菜」，**当** 确认，**则** 它从「菜品池」区消失、出现在「已停用」区。
2. **假设** 桃子删除一道菜后生成菜单，**当** 菜单生成，**则** 该菜不在候选池（`active !== false` 过滤生效）。
3. **假设** 某道被删除（`active=false`）的菜曾被某 order_item 引用，**当** 读取该订单，**则** order_item 仍能 populate 到这道菜（doc 未物理删除）。
4. **假设** 桃子在「已停用」区点「蒜蓉空心菜」的「恢复」，**当** 确认，**则** 它回到「菜品池」区，`active=true`；再次生成菜单时该菜重新进入候选池。
5. **假设** 对已是 `active=false` 的菜再点删除，或对 `active=true` 的菜再点恢复，**当** 操作，**则** 幂等返回成功，状态不反复出错。

### 边界情况

- **删除/恢复被引用的菜**：软动作，不抛 FK 错；引用方仍可读。
- **重名菜**：PRD/DATA-MODEL 不要求菜名唯一（菜单去重在主料层）。新增允许重名。
- **`kind=component` 强制**：M1 菜品池 CRUD 只动 component；cms POST 忽略请求体 `kind`，强制 `component`。combo-meal/single-item/service-session 维护不在本 feature。
- **`category` 取值**：限 `OFFERING_CATEGORIES`（meat/veg/soup/staple）；非法值被 schema 拒（400）。`staple`（主食）合法但菜单内核「2荤2素1汤」结构不选主食位，主食菜只是不进菜单结构（不影响 CRUD）。
- **跨租户**：PATCH/DELETE/restore 前确认菜归属当前 seller（find-then-update，跨租户 404）。
- **并发**：M1 单租户单操作者，不处理并发冲突；最后一次写胜出。
- **网络失败**：CRUD 失败时前端 toast，列表回退到上次成功状态（操作后整体 refetch）。

## 需求

### 功能需求

- **FR-001**: 系统必须允许已认证操作者新增一道菜，表单收集 `name`（必填）、`mainIngredient`（可选）、`category`（必填，限 meat/veg/soup/staple）。
- **FR-002**: 系统必须在新增时强制 `kind = "component"`、`active = true`，忽略请求体里的 `priceCents`/`tags`/`recipe`/`kind`（M1 写白名单）；`category` 接受自请求体（schema 校验）。
- **FR-003**: 系统必须允许已认证操作者编辑某道菜的 `name`、`mainIngredient`、`category`（任选其一或多个）；编辑保留 offering id（原地改）。
- **FR-004**: 系统的编辑写白名单必须只接受 `name`/`mainIngredient`/`category`，忽略其他字段。
- **FR-005**: 系统必须允许已认证操作者「删除」一道菜；删除语义 = 软停用 `active = false`，不物理删除。
- **FR-006**: 系统必须允许已认证操作者「恢复」一道已停用的菜；恢复语义 = `active = false → true`。
- **FR-007**: 菜品池页数据源（be `GET /offerings`）必须返回所有 `kind = "component"` 的菜（含 `active=false`），每条带 `active` 标记，供前端分「菜品池 / 已停用」两区。
- **FR-008**: 菜单生成候选池必须只含 `active && kind=component`（现有 `menu.ts` 过滤，本 feature 不改）；软停用的菜不进候选，恢复后重新进候选。
- **FR-009**: 软停用 / 恢复后，菜被 `order_items`/`menu_plans` 引用时，引用方必须仍能读取（doc 一直在）。
- **FR-010**: 所有写操作必须经 cms internal API（让 Payload 校验/hooks/租户 access 生效），BE 不直连 DB 写裸 SQL。
- **FR-011**: 所有写操作必须以操作者 JWT 的 sellerId 钉死租户（seller-token 透传，无 admin key）；PATCH/DELETE/restore 必须确认菜归属当前 seller。
- **FR-012**: 菜名空 / category 缺失或非法的新增与编辑必须被拒绝（400）。
- **FR-013**: 本 feature 不修改菜单生成内核（`core.ts`）；只保证新菜/改菜/停用/恢复通过现有 `menu.ts` 的 `active && kind=component` 过滤正确进出候选池。

### 关键实体

- **Offering（菜品池项）**：`offerings` collection 里 `kind = "component"` 的菜。M1 用户维护面暴露 `name` + `mainIngredient` + `category`；`active` 由系统在删除/恢复时切换。
- **Offering 写输入（M1）**：`{ name; mainIngredient?; category }`（新增）/ `Partial<{ name; mainIngredient; category }>`（编辑）—— 由 shared `offeringCreateSchema` / `offeringUpdateSchema` 定义，FE↔BE↔cms 三端共享写契约。
- **菜品池视图**：`offerings` 里 `kind=component` 的菜，按 `active` 分「菜品池」(true) / 「已停用」(false)，前者按 `mainIngredient` 分组展示；「已停用」区每条带「恢复」按钮。

## 成功标准

### 可衡量结果

- **SC-001**: 桃子能在菜品池页新增一道菜（菜名 + 主料 + 分类），新增后出现在「菜品池」、按分类被菜单生成选到。
- **SC-002**: 桃子能改菜名/主料/分类，id 不变，引用该菜的历史订单/菜单不破坏。
- **SC-003**: 桃子能删除一道菜（软停用），它移到「已停用」、不再被菜单生成选中；引用它的历史数据仍可读。
- **SC-004**: 桃子能在「已停用」恢复一道菜，它回到「菜品池」、重新被菜单生成选中。
- **SC-005**: 菜品池 CRUD 全程不绕过 Payload 的租户隔离 / hooks / 校验。

## 假设

- M1 表单收 name + mainIngredient + category（评审拍板：录入带分类）。`category` 必填、可编辑（有纠错路径）。
- M1 单租户单操作者（桃子）；不处理并发、不接顾客侧。
- 仓库未部署、无 prod 数据；schema 走 drizzle push（collection 已就绪，本 feature 不改 schema、不加 ensureConstraints 索引）。
- 删除 = 软停用、恢复 = 重新启用；**物理删除 / 批量清理** deferred。
- **combo-meal 套餐管理、parentOfferings 组合编辑** deferred（菜品池 CRUD 只动 component）。
- **批量导入 / 群历史导出加速** deferred（PRD §6.2 冷启动加速项）。
- **「今天」主对话 agent 口头增删改菜品池** deferred（本 feature 只做确定性详情页 CRUD；agent tool 注册属另一 feature）。
- cms 写 internal route 的**真实 postgres 多租户隔离测试**单列 issue 跟踪（本 feature 不做，遵循仓库 cms-薄 host 分层）。
- 继续沿用现有 kith-inn 鉴权与 seller/operator scoping。
