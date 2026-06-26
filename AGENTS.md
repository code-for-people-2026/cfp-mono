# AGENTS.md

本仓库面向**所有编码 agent**（Codex、Claude Code 等）的共享指令；这是唯一事实源，Claude Code 经由 `CLAUDE.md` 导入本文件。

## PR 流程（重要）

本仓库的 PR 发出后会由 **Codex 自动 review**。合并前必须：

1. 逐条 review Codex 的每条 comment；
2. **该改的改；不该改的，回复说明理由**（不无脑照改，也不无脑忽略）；
3. **所有重要 comment 都 resolve 掉**，PR 才能合并。

开 PR / push 属外发动作，需先与发起人确认。

### 合并与审查机制（实测，2026-06）

- **只允许 rebase merge**：仓库 `allow_rebase_merge=true`、squash / merge-commit 均 false。`gh pr merge` 必须用 `--rebase`（`--squash` 会报 "Squash merges are not allowed"）。
- **Codex 自动 review 只触发于 base = `main` 的 PR**。base 指向其他 feature 分支的"堆叠 PR"不会自动审，需在 PR 下手动评论 `@codex review` 触发。
- **合并时 `--delete-branch` 删掉 base 分支，会连带关闭 base 指向它的堆叠 PR（且无法 reopen，因 base 已删）**。要堆叠：先 `gh pr edit <上层> --base main` 把上层 retarget 到 main，再合并下层；或下层合并时不删 base。

## 工程基线

详见 [PLAN.md](./PLAN.md)：pnpm + Turborepo；质量门禁 `pnpm verify`（lint / typecheck / 100% 覆盖率 / knip / build）。提交信息遵循 Conventional Commits。
