# cfp-mono Spec Kit 宪法

## 核心原则

### I. 功能规格承载功能工作

每个新功能都从 `specs/` 下的 Spec Kit 功能目录开始。`docs/<project>/` 下的项目级文档是来源材料，但不能替代功能自己的 `spec.md`、`plan.md` 和 `tasks.md`。

### II. Monorepo 作用域必须明确

每个功能规格必须写明项目名和允许触碰的源码路径。只有当计划解释了依赖关系、任务写明了精确文件时，功能才可以触碰 monorepo 里的其他区域。

### III. 先承认 Brownfield 事实

已有项目的每个实现计划都必须先记录当前代码事实：相关 route、schema、数据表、UI 入口、测试和已知缺口。不要为了贴合新规格而重写已经工作的架构。

### IV. 最小可交付切片

规格和任务应描述一个可独立验证的切片。优先扩展已有模块和契约，不为未来假设新增抽象、依赖或平行系统。

### V. 验证和审查属于完成定义

每个功能计划必须列出最小但相关的自动化检查。PR 仍然遵守 `AGENTS.md` 中的仓库 review 规则。

### VI. 文档默认中文

项目维护者或 agent 编写的 Spec Kit 文档产物，叙述主体默认使用中文，包括 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md` 和 `tasks.md`。技术术语、代码标识、API / 协议名称、第三方工具脚手架、上游模板和技能说明可按原文保留。

## 何时开 spec 目录（三档：全套 / 轻量 / 不开）

不是每个改动都要开 `specs/NNN-*/`。按以下硬阈值归档，避免在「这个算不算大」上临场判断——规则固化，AI 按规则跑，不每次重谈。

### 必须开（全套 spec）

满足任一即建 `specs/NNN-<project>-<feature>/`，产出全套（`spec.md` / `plan.md` / `research.md` / `data-model.md` / `contracts/` / `quickstart.md` / `tasks.md` / `checklists/`）：

- 跨切面（同时动 shared + be + fe + cms 等多层）
- 动数据模型或 API 契约（collection / schema / 索引 / 端点契约）
- 含状态机、生命周期、或租户隔离 / 权限判断
- 预计 ≥2 个 PR
- 需求模糊，需要先探索 / 对齐

范例：`specs/001-kith-inn-chat-card-persistence/`、`specs/002-kith-inn-dish-pool-crud/`。

### 不开

typo、注释、单字段重命名、明确的小重构、复制既有模式的增量。直接靠 `AGENTS.md` + `pnpm verify` + Conventional Commits 走单 PR，**不建 `specs/` 目录**。

### 中间地带（轻量 spec）

单 PR 但有领域判断或取舍：只写 `spec.md`（做什么 + 验收 + Clarifications 记决策）+ `plan.md`（brownfield 事实 + 结构）+ `tasks.md`，跳过 `research.md` / `contracts/` / `checklists/` / `quickstart.md` / `data-model.md`。保留 `plan.md` 是因为 Spec Kit 脚本（`.specify/scripts/bash/setup-tasks.sh`、`check-prerequisites.sh`）强制要求它，缺了 `/speckit-tasks`、`/speckit-implement` 会直接报错。

### 兜底

拿不准时，**倾向开——但用轻量档**。归档明显错时纠偏一次，顺手把案例补进本节作例子。

## Monorepo 功能规则

> 先按上节「何时开 spec 目录」判断是否开；开则按本节形态。不开的改动不建 `specs/` 目录。

- 功能目录使用 Spec Kit 默认形态：`specs/<NNN>-<project>-<feature>/`。
- 项目名写进功能名称，例如 `001-kith-inn-chat-card-persistence`。
- 长期项目文档放在 `docs/<project>/`。
- 不在 Spec Kit 功能目录外维护另一套 PR 粒度任务清单。
- 如果功能改变长期产品行为、架构或数据模型，同一个 PR 必须更新对应的 `docs/<project>/` 文档。

## 治理

本宪法只约束 Spec Kit 文档产物。通用仓库工程规则和 PR 规则仍以 `AGENTS.md` 为准。修改这些原则时，必须更新本文件，并在受影响的功能计划中说明原因。

**版本**: 1.1.2 | **批准日期**: 2026-07-02 | **最后修订**: 2026-07-03
