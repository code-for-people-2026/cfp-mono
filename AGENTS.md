# AGENTS.md

本仓库面向**所有编码 agent**（Codex、Claude Code 等）的共享指令；这是唯一事实源，Claude Code 经由 `CLAUDE.md` 导入本文件。

## 文档语言

本仓库中由项目维护者或 agent 新增、更新的文档类内容，叙述主体默认使用中文，包括 `docs/**`、`specs/**`、PR 说明、review 回复、设计说明、任务说明和学习笔记。技术术语、代码标识、API / 协议名称、第三方工具脚手架和上游模板可按原文保留。

## PR 流程（重要）

本仓库的 PR 发出后会由 **Codex 自动 review**。合并前必须：

1. 逐条 review Codex 的每条 comment；
2. **该改的改；不该改的，回复说明理由**（不无脑照改，也不无脑忽略）；
3. **所有重要 comment 都 resolve 掉**，PR 才能合并。

开 PR / push 属外发动作，需先与发起人确认。

### PR 粒度纪律

每个 PR 必须只有一个可一句话说明的目标或核心不变量，并且能够独立验证。
不得把多个可分别验收的 user story、无关重构、顺手清理或后续功能塞进同一个 PR。

- **先拆再写**：预计需要多个 PR 的功能，必须在 `plan.md` / `tasks.md` 中写出按依赖排序的
  PR 切片；不开 spec 的改动则在 issue 或开始实现前的任务说明中写明切片。
- **按可审查边界切分**：优先按「契约或纯领域逻辑 → 数据写入与迁移 → 服务集成 → UI」
  拆分；每片必须保持门禁可通过。跨层闭环不是合并成大 PR 的理由。
- **review 预算**：默认控制在 400 行以内的人工编写 diff（源码、测试、文档均计入；
  lockfile 和明确的机器生成文件不计）。超过 400 行时，PR 说明必须解释为什么不能继续拆；
  超过 800 行时必须先取得发起人同意，否则不得开 PR。
- **超范围另开**：review 中发现的正确性、安全性或数据损坏风险在当前 PR 内闭环；
  与当前目标无关的新功能或重构必须建 issue，放到后续 PR。
- **例外要可证伪**：只有拆开后无法独立构建、验证或保持兼容时才允许合并切片；
  PR 说明必须写明不可拆原因、额外风险和对应验证。

### 合并与审查机制（实测，2026-06）

- **只允许 rebase merge**：仓库 `allow_rebase_merge=true`、squash / merge-commit 均 false。`gh pr merge` 必须用 `--rebase`（`--squash` 会报 "Squash merges are not allowed"）。
- **Codex 自动 review 只触发于 base = `main` 的 PR**。base 指向其他 feature 分支的"堆叠 PR"不会自动审，需在 PR 下手动评论 `@codex review` 触发。
- **合并时 `--delete-branch` 删掉 base 分支，会连带关闭 base 指向它的堆叠 PR（且无法 reopen，因 base 已删）**。要堆叠：先 `gh pr edit <上层> --base main` 把上层 retarget 到 main，再合并下层；或下层合并时不删 base。

## 工程基线

详见 [PLAN.md](./PLAN.md)：pnpm + Turborepo；质量门禁 `pnpm verify`（lint / typecheck / 100% 覆盖率 / knip / build）。提交信息遵循 Conventional Commits。

## Spec Kit 功能规格

新功能改动前先按 [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) 的「何时开 spec 目录」三档判断（**全套 / 轻量 / 不开**，阈值见宪法）；只有「全套 / 轻量」才建 `specs/NNN-<project>-<feature>/`，不开的改动直接走 AGENTS.md + `pnpm verify` + Conventional Commits。
