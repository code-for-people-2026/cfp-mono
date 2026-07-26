# AGENTS.md

本仓库面向**所有编码 agent**（Codex、Claude Code 等）的共享指令；这是唯一事实源，Claude Code 经由 `CLAUDE.md` 导入本文件。

## 文档语言

本仓库中由项目维护者或 agent 新增、更新的文档类内容，叙述主体默认使用中文，包括 `docs/**`、`specs/**`、PR 说明、review 回复、设计说明、任务说明和学习笔记。技术术语、代码标识、API / 协议名称、第三方工具脚手架和上游模板可按原文保留。

## PR 流程（重要）

开 PR / push 属外发动作，需先与发起人确认。发起人明确要求 Codex 持续推进一个远目标时，
该授权覆盖既定范围内依赖有序的 PR 链，但不扩大允许路径、产品目标或外部门禁。

涉及实现、发布、收口或合并一个或多个 PR 时，支持 skills 的 agent 必须使用
[`pr-review-converge`](./.agents/skills/pr-review-converge/SKILL.md)。不支持 skills 的 agent 仍必须
满足以下硬门禁：

1. 逐条判断 Codex 的每条 comment；该改的改，不该改的用中文回复具体理由；
2. 所有重要 comment 均已妥善处理并 resolve，unresolved thread 数为 0；
3. latest head 的 required CI 全绿，最新 Codex review 明确无新增 actionable comment，且
   `mergeStateStatus=CLEAN`；
4. 只允许 rebase merge，不得 squash 或创建 merge commit。

### PR 粒度纪律

每个 PR 必须只有一个可一句话说明的目标或核心不变量，并且能够独立验证。
不得把多个可分别验收的 user story、无关重构、顺手清理或后续功能塞进同一个 PR。

- **先拆再写**：预计需要多个 PR 的功能，必须在 `plan.md` / `tasks.md` 中写出按依赖排序的
  PR 切片；不开 spec 的改动则在 issue 或开始实现前的任务说明中写明切片。
- **按可审查边界切分**：优先按「契约或纯领域逻辑 → 数据写入与迁移 → 服务集成 → UI」
  拆分；每片必须保持门禁可通过。跨层闭环不是合并成大 PR 的理由。
- **review 可审查性**：约 400 行人工编写 diff（源码、测试、文档均计入；lockfile 和明确的
  机器生成文件不计）只是帮助评估审查负担的宽松建议，不是拆分、开 PR 或合并的硬门槛。
  行数不能代替对目标与风险的判断：只要 PR 目标单一、改动内聚、验证完整且 reviewer 能够
  可靠理解其行为和风险，就可以合理超过该参考值；反之，即使不足 400 行，包含多个关注点
  也必须继续拆分。diff 明显偏大时应在 PR 说明中交代不能继续拆分的原因、额外审查风险和
  对应验证，并优先通过更清晰的提交、说明或切片保障 review 质量。人工 diff 超过约 800 行
  时仍须先取得发起人同意，确认现有组织方式足以保障审查质量后再开 PR。仓库其他文档沿用
  “review 预算”或 400 行阈值时，除非发起人明确批准其为当前功能的特定硬门禁，否则统一按
  本条的宽松参考和可审查性要求解释，不构成独立的 400 行硬门禁。
- **超范围另开**：review 中发现的正确性、安全性或数据损坏风险在当前 PR 内闭环；
  与当前目标无关的新功能或重构必须建 issue，放到后续 PR。
- **例外要可证伪**：只有拆开后无法独立构建、验证或保持兼容时才允许合并切片；
  PR 说明必须写明不可拆原因、额外风险和对应验证。

## 工程基线

详见 [PLAN.md](./PLAN.md)：pnpm + Turborepo；质量门禁 `pnpm verify`（lint / typecheck / 100% 覆盖率 / knip / build）。提交信息遵循 Conventional Commits。

## Spec Kit 功能规格

新功能改动前先按 [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) 的「何时开 spec 目录」三档判断（**全套 / 轻量 / 不开**，阈值见宪法）；只有「全套 / 轻量」才建 `specs/NNN-<project>-<feature>/`，不开的改动直接走 AGENTS.md + `pnpm verify` + Conventional Commits。
