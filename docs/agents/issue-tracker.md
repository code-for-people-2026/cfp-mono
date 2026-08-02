# Issue tracker: GitHub

本仓库的 Issues 和 PRD 使用 GitHub Issues 管理。所有操作使用 `gh` CLI。

## Conventions（操作约定）

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 Issue**：`gh issue view <number> --comments`，同时获取并检查评论和标签。
- **列出 Issues**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，根据任务添加适当的 `--label` 和 `--state` 过滤条件。
- **评论 Issue**：`gh issue comment <number> --body "..."`
- **添加或移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <number> --comment "..."`

从 `git remote -v` 推断仓库；在当前仓库 clone 内运行时，`gh` 会自动完成这一步。

## Pull requests as a triage surface（将 PR 作为分诊入口）

**PRs as a request surface: no.**

如果以后将其改为 `yes`，外部 PR 将与 Issues 使用相同的标签和状态：

- **读取 PR**：使用 `gh pr view <number> --comments`，并通过 `gh pr diff <number>` 读取 diff。
- **列出待分诊的外部 PR**：使用 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的 PR。
- **评论、添加标签或关闭**：使用 `gh pr comment`、`gh pr edit --add-label`/`--remove-label` 和 `gh pr close`。

GitHub 的 Issues 和 PR 共用编号空间。遇到单独的 `#42` 时，先运行 `gh pr view 42`；如果不是 PR，再运行 `gh issue view 42`。

## 当 Skill 要求 “publish to the issue tracker”

创建一个 GitHub Issue。

## 当 Skill 要求 “fetch the relevant ticket”

运行 `gh issue view <number> --comments`。

## Wayfinding operations（寻路操作）

供 `/wayfinder` 使用。一个 map 是 GitHub Issue，其 tickets 是该 Issue 的子 Issues。

- **Map**：创建带有 `wayfinder:map` 标签的 Issue，正文保存 Notes、Decisions-so-far 和 Fog。使用 `gh issue create --label wayfinder:map`。
- **Child ticket**：通过 GitHub sub-issues API 将 Issue 关联为 map 的子 Issue。如果仓库未启用 sub-issues，则在 map 正文使用 task list，并在 child ticket 正文顶部写入 `Part of #<map>`。每个 ticket 使用 `wayfinder:<type>` 标签，其中 `<type>` 为 `research`、`prototype`、`grilling` 或 `task`。ticket 被认领后，分配给当前负责推进 map 的开发者。
- **Blocking**：优先使用 GitHub 原生 issue dependencies。通过 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加依赖边。`<blocker-db-id>` 必须是 blocker 的 numeric database ID，可通过 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 获取，不能使用 Issue 编号或 `node_id`。如果 dependencies 不可用，则在 child ticket 正文顶部使用 `Blocked by: #<n>, #<n>`。
- **Frontier query**：列出 map 的所有 open children，排除仍有 open blocker 或已有 assignee 的 tickets；按 map 顺序选择第一个。
- **Claim**：运行 `gh issue edit <n> --add-assignee @me`。这是 session 的第一次写操作。
- **Resolve**：在 ticket 中发布 resolution comment，关闭 Issue，然后向 map 的 Decisions-so-far 追加包含摘要和链接的 context pointer。
