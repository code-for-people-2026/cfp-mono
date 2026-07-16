---
name: pr-review-converge
description: Drive one or more dependency-ordered PR slices through implementation, validation, Ready PR publication, latest-head CI, repeated Codex review, comment handling, thread resolution, and rebase merge. Use when the user asks Codex to finish a PR, merge reviewed work, continue a milestone autonomously, or pursue a distant repository goal through sequential small PRs.
---

# PR Review Convergence

把一个已获授权的远目标拆成依赖有序的小 PR，并让每个 PR 在开始下一片前完成 review 收敛和
rebase merge。始终遵守 `AGENTS.md`；本 skill 规定操作顺序，不扩大用户授权或文件范围。

## 建立执行队列

1. 完整读取 `AGENTS.md`、适用的 spec/plan/tasks、用户给出的范围和当前事实。
2. 运行 `git worktree list`、`git status -sb` 并检查远端。保留其他 session 的 worktree 和修改；
   无法安全接管时，从最新 `origin/main` 创建新的 `codex/` 分支和隔离 worktree。
3. 把 user story 当作需求验收单位，把 PR slice 当作合并单位。一个 story 可以依赖多个 PR；
   不要为了闭合 story 把契约、持久化、服务和 UI 塞进同一个 PR。
4. 从 plan/tasks 中选择依赖已经合并的下一片。每片开始前确认：
   - 一句话目标或核心不变量；
   - 精确允许路径和明确非目标；
   - 独立验证；
   - 依赖和人工 diff 预算。
5. 同一时间只推进一个 PR。当前 PR 合并前，不实现下一片。

用户明确授权“持续推进到某目标”时，把该授权应用于既定范围内的依赖有序 PR 链；不要把它
解释为修改范围外文件、通过人工/合规门禁或执行其他外部动作的授权。

## 实现当前切片

1. 从最新 `origin/main` 开始，先确认已合并事实和现有代码，避免重复实现。
2. 按 spec 要求测试先行；开发期间优先运行窄测试。
3. 采用满足当前切片的最简单实现：复用现有模块，不增加面向未来的抽象、依赖或平行系统。
4. 只修改允许路径。发现正确性、安全性或数据损坏风险时在当前 PR 内闭环；无关改进放入
   后续任务，不顺手扩大范围。
5. 完成后运行独立验证、文档链接检查（若适用）、`git diff --check`、人工 diff 统计和
   `pnpm verify`。默认人工 diff `<400`；`>400` 解释不可再拆原因；未经发起人同意不得以
   `>800` 开 PR。
6. 审计 diff 和 status，仅 stage 当前切片文件，使用 Conventional Commits。

## 发布 Ready PR

分别确认当前用户对 push、开 PR 和合并的授权；若只授权其中一部分，停在对应边界请求授权。
用户明确授权持续推进远目标直至完成时，视为已经授权既定范围内的这三类动作。

1. push 当前 `codex/` 分支，创建以 `main` 为 base 的 Ready PR；不要用 Draft 冒充待审状态。
2. PR 正文写明目标、范围/非目标、依赖、人工 diff 统计和验证结果。
3. base 不是 `main` 时不要等待自动 review，显式评论 `@codex review`。优先避免堆叠 PR；
   必须堆叠时，合并下层前先处理上层 retarget，且不要误删仍被用作 base 的分支。
4. 发布后继续工作，不把“PR 已打开”当作完成。

## 收敛 CI 和 Codex review

按轮次循环，不设置任意 review 次数上限：

1. 记录 PR 的 latest head SHA，等待该 head 的 required checks 完成。轮询期间持续给用户简短
   状态更新；使用 CLI/headless 接口，不反复打开浏览器。
2. 读取全部 review、inline comment 和 thread resolution 状态。需要 thread 级状态时使用
   GitHub GraphQL 或等价的 GitHub 工具，不只看扁平 comment 列表。
3. 对每条新 comment 独立判断：
   - 正确且属于当前目标：修改并补相应测试；
   - 正确但与当前目标无关：记录到后续 issue/task，并回复不在本 PR 扩大的理由；
   - 不适用或判断错误：用中文回复具体证据和理由，不为清空 comment 盲改代码。
4. 回复后 resolve 所有已妥善处理的重要 thread。目标是 unresolved thread 为零，而不是忽略
   不同意见。
5. 如果 head 有变化，重新运行受影响的窄检查，push，并等待新 head CI；旧 head 的绿色结果
   不得用于新 head。
6. 本轮处理完成且 latest head CI 已完成后，精确评论 `@codex review` 请求新一轮 review。
   即使本轮只有有理据的回复而没有代码变化，也请求一次新 review 以取得明确收敛结论。
7. 新 review 出现 comment 时回到步骤 2。review 仍在运行、CI 仍在排队或 merge state 尚未
   稳定时继续等待，不提前合并。

## 合并门禁

同时满足以下条件才允许合并：

- PR latest head 等于最后验证和 review 的 head；
- latest head required CI 全绿；
- 最新 Codex review 明确没有新的 actionable comment；
- unresolved thread 数为 0；
- `mergeStateStatus` 为 `CLEAN`；
- PR 仍只包含已授权切片，且人工 diff 未越过门禁。

使用 `gh pr merge --rebase`；不得 squash 或创建 merge commit。除非已经确认没有堆叠 PR 依赖
该分支，否则不要顺手 `--delete-branch`。

## 继续远目标

1. 确认 PR 已合并，以远端合并事实而不是本地“代码完成”更新任务状态。
2. fetch 最新 `origin/main`，重新评估目标是否已经完成和下一片依赖是否满足。
3. 若仍有范围内、无需新增授权的可执行切片，从“建立执行队列”继续；不要因为一次 merge
   自动结束远目标。
4. 遇到以下情况才暂停并请求用户：
   - 需要扩大路径、产品目标或外部权限；
   - `>800` 人工 diff 无法继续拆分；
   - 真实设备、人工验收、凭证、合规或其他外部门禁阻塞；
   - CI/review 指向只能通过超范围改动解决的问题；
   - 现有未提交修改无法安全归属。

不要把 H5 自动化、mock、代码完成或 PR 合并冒充真实设备/人工/合规门禁。远目标的代码部分
完成但仍有外部门禁时，明确报告“代码完成、发布门禁未完成”。
