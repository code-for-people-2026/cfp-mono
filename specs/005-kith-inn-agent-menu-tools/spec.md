# 功能规格：「今天」agent 菜单工具（US-M06）

**功能分支**: `005-kith-inn-agent-menu-tools`

**创建日期**: 2026-07-05

**状态**: 草稿（设计评审中，未开始实现）

**输入**: PRD §6.2（今天可口头改菜单）、§5.5（主 agent 编排工具）。feature 003 deferred 项：「be 端点已为 agent 备好」。

## 项目作用域

**项目**: kith-inn

**允许触碰**:

- `apps/kith-inn-be/src/agent/tools.ts`（+ 4 个 menu 工具定义 + execute handler）
- `apps/kith-inn-be/src/agent/services.ts`（+ 4 个 menu 服务方法）
- `apps/kith-inn-be/src/agent/services.test.ts`（+ 用例）
- `apps/kith-inn-be/src/agent/run.ts`（system prompt 加菜单能力描述）
- `apps/kith-inn-be/src/agent/tools.test.ts`（+ 用例，如存在）

**不触碰**: FE、cms、shared、collection schema、be 路由（菜单端点 f003 已全就绪）。

## Clarifications

### Session 2026-07-05

- **Q: 哪些菜单操作暴露给 agent？** → A: 4 个——`generate_menu`（生成/重排）、`swap_dish`（换一道）、`publish_menu`（发布+文案）、`get_menu`（查菜单）。覆盖 US-M04（随机换）、US-M05（指定换）、US-M06（口头改）、US-M07（发群文案）的 agent 路径。
- **Q: agent 怎么知道 planId？** → A: `get_menu` 返回的 plan 列表带 planId；agent 先查再操作（或 LLM 从上文 tool 返回中拿）。generate 的返回也带 planId。
- **Q: 日期怎么传？** → A: 工具 schema 的 `date` 参数定义为 `YYYY-MM-DD` 字符串（Codex #121 P2）。LLM 负责把自然语言"明天""后天"解析成具体日期（system prompt 里给指引："明天 = 今天的日期 +1，今天按 Asia/Shanghai"；run.ts 的 system prompt 注入今天日期）。不传中文相对日期给 be 端点。`get_menu` 的 date 省略时默认今天。
- **Q: 操作 published 菜单的二次确认？** → A: be 端点已有 force 守卫（无 force→409）。agent 工具收到 409 → 回复「这餐已发给顾客，确定要改吗？」→ 用户确认 → 带 force 重调。与 panel 的 modal 确认等价。
- **Q: 接龙文案返回给用户怎么展示？** → A: publish_menu 返回 `{ text: 接龙文案, card?: { type: "publish-text", data: { publishText } } }`——文字直接展示在聊天气泡里，桃子复制即可。不做专门 card（文案是纯文本，气泡够用）。

## 用户场景

### US1 — 桃子在「今天」说"生成明天午餐"

桃子：「明天午餐排一下」→ agent 解析"明天"为 `2026-07-06`（system prompt 注入今天日期）→ 调 `generate_menu({ targets: [{ date: "2026-07-06", occasion: "lunch" }] })` → 回复「明天午餐排好了：红烧牛肉、清炒时蔬…」。

### US2 — 桃子说"把明天午餐的牛腩换掉"

桃子：「把明天午餐的牛腩换掉」→ agent 先 `get_menu({ date: "2026-07-06" })` 拿到 planId + dishes → 找到"牛腩"的 dishId → 调 `swap_dish({ planId, dishId })` → 回复「换成了香菇滑鸡」。

### US3 — 桃子说"把明天午餐发出去"

桃子：「明天午餐发出去」→ agent `publish_menu({ planId })` → 回复接龙文案「【街坊味】7月8日 周三 午餐…30元/份…接龙：1.」→ 桃子复制贴群。

### US4 — 桃子问"明天菜单是什么"

桃子：「明天菜单是什么」→ agent `get_menu({ date: "2026-07-06" })` → 回复「明天午餐：红烧牛肉、清炒时蔬…；晚餐：…」。

## 需求

- **FR-001**: `AgentServices` 加 4 方法：`generateMenu(targets, force?)`、`swapDish(planId, dishId, replacementId?, force?)`、`publishMenu(planId)`、`getMenu(date?)`。各调对应 be 菜单端点（f003 已合）。
- **FR-002**: `AGENT_TOOLS` 加 4 工具定义（function-calling schema）+ execute handler，返 `{ text, card? }`。
- **FR-003**: `run.ts` system prompt 加菜单能力描述（"你可以帮桃子生成/换菜/发布/查菜单"）。
- **FR-004**: published 菜单操作遇 409 → 回复提示需确认；用户确认 → 带 force 重调。
- **FR-005**: generate 返回的 text 含排好的菜名列表（方便 LLM 组织回复）；publish 返回接龙文案全文。
- **FR-006**: 所有工具复用 `AgentServices` DI 模式（生产调 be 路由 / cms；测试 mock）。
- **FR-007**: `pnpm verify` 全绿（100% 覆盖；agent 逻辑用 mock LLM + 脚本化工具序列测）。

## 成功标准

- **SC-001**: 桃子能在「今天」口头生成/换菜/发布/查菜单（不切到菜单 tab）。
- **SC-002**: 操作 published 菜单时 agent 提示确认。
- **SC-003**: 接龙文案在聊天气泡里可见、可复制。

## 假设 / deferred

- agent 不做「选别的」菜品选择器（LLM 从 get_menu 返回的池子里选替代菜；用户指定菜名时 LLM 匹配）。
- 跨日菜单查询（"上周三做了什么"）deferred（M1 限今天/明天）。
- agent 菜单操作不返回结构化 card（文案直接文字展示）。
