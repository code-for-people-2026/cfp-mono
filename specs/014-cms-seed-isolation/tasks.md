# Tasks：CMS 项目级 Seed 隔离

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 包含任务 | 独立验证 | 依赖 |
|----|-------------------|----------|----------|------|
| PR1 | 任一项目 seed/reset 对另一项目零读写删，且只暴露项目级命令 | T001–T008 | 双向哨兵测试、package seed 单测、`pnpm verify` | #156 已完成 |

## Phase 1：User Story 1 - kith-inn 操作隔离（P1）

**Independent Test**: 预置 kiv1 哨兵，分别运行 kith-inn seed/reset；哨兵不变且访问记录无 `kiv1_*`。

- [x] T001 [P] [US1] 在 `apps/cms/tests/seed-run.test.ts` 把跨项目编排测试改为 kith-inn seed/reset 的 kiv1 哨兵与零访问回归
- [x] T002 [US1] 在 `apps/cms/seed/run.ts` 删除 `applyAllSeeds` / `resetAllSeedData`，实现显式项目选择且 kith-inn 分支只调用 `@cfp/kith-inn-payload/seed`

## Phase 2：User Story 2 - kiv1 操作隔离（P1）

**Independent Test**: 预置 kith-inn 哨兵，分别运行 kiv1 seed/reset；哨兵不变且访问记录无 kith-inn collection。

- [x] T003 [P] [US2] 在 `packages/kith-inn-v1-payload/src/seed/taozi.test.ts` 增加 kiv1 reset 删除顺序与结果测试
- [x] T004 [US2] 在 `packages/kith-inn-v1-payload/src/seed/taozi.ts` 与 `index.ts` 实现并导出项目内 `resetSeedData`
- [x] T005 [US2] 在 `apps/cms/tests/seed-run.test.ts` 增加 kiv1 seed/reset 的 kith-inn 哨兵与零访问回归
- [x] T006 [US2] 在 `apps/cms/seed/run.ts` 接入只调用 `@cfp/kith-inn-v1-payload/seed` 的 kiv1 分支

## Phase 3：User Story 3 - 明确且受保护的命令（P1）

**Independent Test**: 仅四个项目级脚本存在；未知项目拒绝；既有显式开关、本地数据库和环境保护测试通过。

- [x] T007 [US3] 在 `apps/cms/package.json` 删除含糊入口并增加四个项目级 seed/reset 脚本，在 `apps/cms/tests/seed-run.test.ts` 保留安全守卫并覆盖未知项目拒绝

## Phase 4：文档与验收

- [x] T008 在 `apps/cms/README.md` 记录四个命令与安全边界，运行相关单测、`pnpm verify`、`git diff --check` 并确认无 schema/API 变化

## Dependencies & Execution Order

- T001 与 T003 修改不同文件，可先写失败测试；T002 后完成 US1。
- T004 依赖 T003；T005/T006 依赖 T004，并在同一测试/runner 文件中接续 US1。
- T007 依赖两个项目分支均可用；T008 最后执行。
- 全部任务属于同一个 PR，不夹带 schema、API、业务逻辑或跨项目 reset。

## Format Validation

- 共 8 项任务，ID 连续为 T001–T008。
- 所有 user story 任务均含 `[USn]` 与精确文件路径；仅不同文件且无未完成依赖的任务标 `[P]`。
