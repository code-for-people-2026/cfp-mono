# 规格质量检查清单：kith-inn 菜单换菜 + 发群文案（持久化）

**目的**: 进入计划阶段前验证规格完整性与质量
**创建日期**: 2026-07-04
**功能**: [spec.md](../spec.md)

## 内容质量

- [x] 行为需求不包含实现细节
- [x] 聚焦用户价值和业务需求
- [x] 面向非技术干系人可读
- [x] 必填章节已完成

## 需求完整性

- [x] 没有遗留 [NEEDS CLARIFICATION] 标记
- [x] 需求可测试且无歧义
- [x] 成功标准可衡量
- [x] 成功标准不依赖具体技术实现
- [x] 验收场景已定义
- [x] 边界情况已识别（pool-too-small、重复发布、archived slot、跨租户、publishText 失败、刷新丢换菜、时区）
- [x] 作用域边界清晰（deferred 项明确）
- [x] 依赖和假设已识别

## 功能准备度

- [x] 所有功能需求都有清晰验收口径
- [x] 用户场景覆盖主要流程（换菜 auto/指定、发布持久化、复制文案、回看）
- [x] 功能满足成功标准中定义的可衡量结果
- [x] 行为需求中没有泄漏实现细节

## 备注

- 因 monorepo 宪法要求，规格含项目作用域路径。
- 评审拍板：发布落 menu_plans（乙 全套持久化）、publishText 每餐次按需、不做 draft / 不做发布后换菜（见 spec Clarifications）。
- 不改 menu_plans/service_slots collection schema、不改 generateWeekMenu/swapDish 内核（brownfield 已就绪，只新增 swapDishSpecified + 周日期解析）。
- 触发宪法「必须开」（跨切面 + 动 menu_plans 写路径 + ≥2 PR）→ 全套 spec。
