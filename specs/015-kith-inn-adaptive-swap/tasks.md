# Tasks：kith-inn 自适应换菜

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/swap-api.md](./contracts/swap-api.md)

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 包含任务 | 独立验证 | 依赖 |
|----|-------------------|----------|----------|------|
| PR1 | 冻结行为契约、边界与可执行切片 | T001–T003 | 规格清单、artifact 一致性分析、`git diff --check` | #164 |
| PR2 | 所有有效候选按固定四级择优，结果可解释且随机可控 | T004–T008 | shared/core 单测、`pnpm verify` | PR1 |
| PR3 | 目标日期历史进入评分，放宽解释在菜单页无损可见 | T009–T015 | route/FE 单测、既有保护回归、`pnpm verify` | PR2 |
| PR4 | H5 真实链路证明小池仍换且提示可见 | T016–T019 | kith-inn FE Playwright、`pnpm verify` | PR3 |

## Phase 1：规格与规划（PR1）

**Goal**: 让评分语义、日期边界、响应契约和后续 PR 审查边界先独立稳定。

- [x] T001 审计 `apps/kith-inn-be/src/domain/menu/core.ts`、`apps/kith-inn-be/src/routes/menu.ts`、`apps/kith-inn-fe/src/pages/menu/index.tsx`、shared 契约与 v1 参考实现，记录 brownfield 事实和范围
- [x] T002 完成 `specs/015-kith-inn-adaptive-swap/spec.md` 与 `checklists/requirements.md`，覆盖四类菜品池边界、历史窗口、随机稳定性和既有保护
- [x] T003 完成 `plan.md`、`research.md`、`data-model.md`、`contracts/swap-api.md`、`quickstart.md`、`tasks.md` 的交叉一致性分析，运行 `git diff --check`

## Phase 2：User Story 1 - 纯领域自适应选择（PR2，P1）

**Goal**: 只要存在有效同类候选就成功，并按固定优先级选择冲突最少的一道。

**Independent Test**: 不启动 HTTP/CMS，直接用固定菜单、历史、菜品池与随机源验证四类边界、四级优先级、解释和单位置不变量。

- [ ] T004 [P] [US1] 先在 `packages/kith-inn-shared/src/schemas.test.ts` 写失败契约测试，再于 `schemas.ts` / `types.ts` 增加四个固定 `RelaxedRule` 值和有序类型
- [ ] T005 [US1] 先在 `apps/kith-inn-be/src/domain/menu/core.test.ts` 写失败测试：充足池、小池、唯一候选、无候选、各级字典序、日期边界、当前餐剩余主料、并列随机和只替换目标位置
- [ ] T006 [US1] 在 `apps/kith-inn-be/src/domain/menu/core.ts` 实现日历日/自然周、冲突计数、字典序比较、放宽规则与可注入随机源的纯 helper
- [ ] T007 [US1] 在 `apps/kith-inn-be/src/domain/menu/core.ts` 改造 `swapDish`：资格过滤与偏好评分分离，接收显式 history，成功返回 replacement + `relaxedRules`，不改 `swapDishSpecified`
- [ ] T008 [US1] 运行 shared/core 定向测试、`pnpm verify`、`git diff --check`，确认 PR2 人工 diff 不超 review 预算

## Phase 3：User Story 2/3 - 历史接入与可见解释（PR3，P1）

**Goal**: 自动换菜读取正确的 seller 历史并把本次放宽原因显示给桃子，同时保持指定/published 行为。

**Independent Test**: mock CMS 返回目标周/近 7 日/当前 plan，调用 swap 路由验证查询、排除和 patch；FE 纯测试验证响应透传与中文顺序，既有指定/published 用例继续通过。

- [ ] T009 [P] [US2] 先在 `packages/kith-inn-shared/src/schemas.test.ts` 写失败测试，再于 `schemas.ts` / `types.ts` 增加兼容自动/指定分支的 swap success response 契约
- [ ] T010 [US1] 先在 `apps/kith-inn-be/src/routes/menu.test.ts` 写失败测试：自动分支目标相关范围、当前 plan 排除、历史传入、空/非空 `relaxedRules` 与仅一个 offerings 位置变化
- [ ] T011 [US1] 在 `apps/kith-inn-be/src/routes/menu.ts` 并行读取启用菜池和历史 plans，排除当前 plan、映射 history、调用新内核并返回自动分支 `relaxedRules`
- [ ] T012 [P] [US2] 先在 `apps/kith-inn-fe/src/logic/menuEdit.test.ts` 写失败测试，再在 `menuEdit.ts` 类型化透传 `relaxedRules` 并实现固定顺序的中文提示纯函数
- [ ] T013 [US2] 在 `apps/kith-inn-fe/src/pages/menu/index.tsx` 消费自动响应，在对应餐卡显示本次“菜品池较小”放宽原因，空规则不显示
- [ ] T014 [US3] 复用并运行 `apps/kith-inn-be/src/routes/menu.test.ts` 已有的指定换菜 warning、published 无 force 和 force 清文案用例；仅补历史接入造成的新回归断言，并同步 `docs/kith-inn/TECH-SPEC.md` 的自适应换菜语义
- [ ] T015 [US1] [US2] [US3] 运行 shared/BE route/FE logic 定向测试、`pnpm verify`、`git diff --check`，确认 API 示例与实际响应一致

## Phase 4：User Story 2 - H5 小池验收（PR4，P1）

**Goal**: 用真实 H5→BE→CMS 链路证明小菜品池不误失败且放宽提示可见。

**Independent Test**: Playwright 准备有菜单的餐次并把目标分类收缩为唯一冲突候选，页面点击换菜后同时验证菜名、顺序与提示。

- [ ] T016 [P] [US2] 在 `apps/kith-inn-fe/package.json`、`playwright.config.ts` 建立最小 H5 E2E 命令与 CMS kith-inn seed→BE→H5 webServer 编排，只声明仓库 lockfile 已有的 Playwright 版本，不引入新库或版本
- [ ] T017 [US2] 在 `apps/kith-inn-fe/tests/e2e/menu-swap.spec.ts` 实现 dev-login、菜单准备、活跃同类池收缩、点击换菜、单位置变化及中文放宽提示断言
- [ ] T018 [US2] 如 `turbo --affected` 不能自动覆盖新 suite，则最小更新 `.github/workflows/ci.yml` 的 kith-inn E2E filter；不得把 #157 的 PostgreSQL/跨租户场景并入
- [ ] T019 [US2] 运行 `CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e`、`pnpm verify`、`git diff --check`，记录耗时和失败 trace 路径

## Dependencies & Execution Order

- PR1 合并后才开始 PR2；PR2/PR3/PR4 均等待前片 Codex review 干净并 rebase merge。
- T004 与 T005 可先分别写 shared/core 失败测试；T006 后由 T007 组装，T008 收口。
- T009/T010/T012 可先写不同层失败测试；T011 完成 BE，T013 完成 UI，T014/T015 收口不回归。
- T016 先提供 runner，T017 写唯一场景；T018 仅在实际 affected 证据表明需要时执行，T019 最后验收。
- #163 四片全部合并后关闭 issue，再开始 #157；#157 扩展而不重写 PR4 的 H5 设施。

## Format Validation

- 共 19 项任务，ID 连续为 T001–T019；每项只属于一个 PR。
- 实现任务含精确文件路径；仅不同文件且无未完成依赖的任务标 `[P]`。
- 测试任务明确先写失败用例；没有 v1 代码修改、CMS schema、LLM、推荐系统或仓库新第三方库/版本任务。
