# 规格质量检查清单：kith-inn 菜单编辑 + 接龙发布

**目的**: 进入计划阶段前验证规格完整性
**创建日期**: 2026-07-04
**功能**: [spec.md](../spec.md)

## 内容质量
- [x] 行为需求不含实现细节
- [x] 聚焦用户价值和业务需求
- [x] 面向非技术干系人可读
- [x] 必填章节已完成

## 需求完整性
- [x] 无 [NEEDS CLARIFICATION] 遗留
- [x] 需求可测试无歧义
- [x] 成功标准可衡量
- [x] 验收场景已定义
- [x] 边界情况已识别（pool-too-small、跨租户、刷新、无 force 改 published、接龙格式校准、时区）
- [x] 作用域边界清晰（deferred 明确）
- [x] 依赖和假设已识别

## 功能准备度
- [x] 所有功能需求有清晰验收口径
- [x] 用户场景覆盖主要流程（生成/重排、换菜 auto+指定、一键发布+接龙、双视图）
- [x] 满足成功标准
- [x] 行为需求无实现泄漏

## 备注
- 因 monorepo 宪法，规格含项目作用域路径。
- 5 轮评审 + 接龙格式收敛：date-driven、draft/published 状态机、日/周双视图、一键发布=接龙文案+复制+标记（不真发群、不调 LLM）、菜单不开餐、003(be+panel)/004(agent) 拆分（见 spec Clarifications）。
- 不改 menu_plans/service_slots collection schema、不改 generateWeekMenu/swapDish 算法（只新增 swapDishSpecified + buildJielongMenuText）。
- 触发宪法「必须开」（跨切面 + 动 menu_plans 写路径 + 状态机 + ≥2 PR）→ 全套 spec。
- 关 #114（旧 week-based spec）后重开；#114 的 Codex 三条洞察（getMenuPlan、swap ok-shape）已吸收，partial-publish 随"菜单不开餐"决策消失。
