# Tasks：kith-inn 自适应换菜

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/swap-api.md](./contracts/swap-api.md)

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 包含任务 | 独立验证 | 依赖 |
|----|-------------------|----------|----------|------|
| PR1 | 冻结行为契约、边界与可执行切片 | T001–T003 | 规格清单、artifact 一致性分析、`git diff --check` | #164 |
| PR2 | 有效候选按固定四级择优，结果可解释、随机可控且目标位置精确 | T004–T008 | shared/core 单测、`pnpm verify` | PR1 |
| PR3 | menu route 与 chat agent 使用同一历史、解释和单位置写回语义 | T009–T014 | shared/route/agent 单测、既有保护回归、`pnpm verify` | PR2 |
| PR4 | H5 runtime 验证响应并无损显示解释 | T015–T019 | FE logic 单测、页面交互检查、`pnpm verify` | PR3 |
| PR5 | H5 真实链路证明小池仍换且提示可见 | T020–T023 | kith-inn FE Playwright、`pnpm verify` | PR4 |

## Phase 1：规格与规划（PR1）

**Goal**: 让评分语义、日期边界、响应契约和后续 PR 审查边界先独立稳定。

- [x] T001 审计 `apps/kith-inn-be/src/domain/menu/core.ts`、`routes/menu.ts`、`agent/services.ts`、`apps/kith-inn-fe/src/pages/menu/index.tsx`、shared 契约与 v1 参考实现，记录 brownfield 事实和范围
- [x] T002 完成 `specs/015-kith-inn-adaptive-swap/spec.md` 与 `checklists/requirements.md`，覆盖四类菜品池边界、历史窗口、随机稳定性、重复位置和既有保护
- [x] T003 完成 `plan.md`、`research.md`、`data-model.md`、`contracts/swap-api.md`、`quickstart.md`、`tasks.md` 的交叉一致性分析，运行 `git diff --check`

## Phase 2：User Story 1 - 纯领域自适应选择（PR2，P1）

**Goal**: 只要存在有效同类候选就成功，按固定优先级择优，并精确解析本次只允许写回的目标位置。

**Independent Test**: 不启动 HTTP/CMS，直接用固定菜单、历史、菜品池、可选 dishIndex 与随机源验证四类边界、四级优先级、解释和单位置不变量。

- [x] T004 [P] [US1] 先在 `packages/kith-inn-shared/src/schemas.test.ts` 写失败契约测试，再于 `schemas.ts` / `types.ts` 增加四个固定 `RelaxedRule` 值和有序类型
- [x] T005 [US1] 先在 `apps/kith-inn-be/src/domain/menu/core.test.ts` 写失败测试：充足池、小池、唯一候选、无候选、各级字典序、日期边界、当前餐剩余主料、并列/边界随机、重复 dish 的显式位置/默认首项和其他位置不变
- [x] T006 [US1] 在 `apps/kith-inn-be/src/domain/menu/core.ts` 实现日历日/自然周、冲突计数、字典序比较、放宽规则、可注入随机源及 `dishIndex` 目标解析 pure helper
- [x] T007 [US1] 在 `apps/kith-inn-be/src/domain/menu/core.ts` 改造 `swapDish` 与 `swapDishSpecified`：资格过滤与偏好评分分离，接收显式 history/可选位置，成功返回 replacement + `targetIndex`（auto 另含 `relaxedRules`）
- [x] T008 [US1] 运行 shared/core 定向测试、`pnpm verify`、`git diff --check`，确认 PR2 人工 diff 不超 review 预算

## Phase 3：User Story 1/2/3 - 双前门历史集成（PR3，P1）

**Goal**: menu route 与 chat agent 的自动换菜读取同一 seller 历史、返回同一解释并只写一个位置；chat 确认沿用 preview 结果。

**Independent Test**: mock CMS 返回目标周/近 7 日/当前 plan 和重复 offering，分别调用 menu route、agent preview/confirm，验证查询范围、当前 plan 排除、选择/解释一致、单位置 patch 与既有保护。

- [x] T009 [P] [US2] 先在 `packages/kith-inn-shared/src/schemas.test.ts` 写失败测试，再于 `schemas.ts` / `types.ts` 扩展 swap request 的可选非负整数 `dishIndex`，并增加区分自动/指定成功分支的 shared runtime response schema
- [x] T010 [US1] 先在 `apps/kith-inn-be/src/routes/menu.test.ts` 写失败测试：目标相关范围、当前 plan 排除、inactive 候选排除、空/非空 `relaxedRules`、显式位置匹配和重复 ID 只改一个 offerings 位置
- [x] T011 [US1] 在 `apps/kith-inn-be/src/routes/menu.ts` 并行读取启用菜池和历史 plans，排除当前 plan、映射 history、传入 `dishIndex`，按 `targetIndex` 单位置写回并返回自动分支 `relaxedRules`
- [x] T012 [US2] 先在 `apps/kith-inn-be/src/agent/services.test.ts`、`agent/run.test.ts` 写失败测试：`swapDish` / `previewSwap` 使用同一目标历史、排除当前 plan、返回解释、确认参数固化 preview replacement、重复 ID 单位置写回且确认卡提示放宽原因
- [x] T013 [US2] 在 `apps/kith-inn-be/src/agent/services.ts`、`agent/tools.ts` 与必要 `agent/run.ts` 类型中接入历史和 `relaxedRules`；auto preview 把胜出 replacement 写进 pending op，确认不得重随机，直接 auto 调用按 `targetIndex` 写回
- [x] T014 [US3] 复用并运行 `routes/menu.test.ts` 与 `agent/services.test.ts` 已有的指定换菜 warning、published 无 force 和 force 清文案用例；仅补双前门历史接入造成的新回归断言，运行 shared/route/agent 定向测试、`pnpm verify`、`git diff --check`

## Phase 4：User Story 2 - H5 runtime 契约与解释（PR4，P1）

**Goal**: H5 只消费经 shared schema 验证的响应，并把对应点击位置和完整放宽原因无损呈现。

**Independent Test**: FE 纯测试覆盖合法自动/指定响应、未知规则拒绝、中文固定顺序和 dishIndex 请求；页面交互覆盖提示按 plan 归属且空规则不显示。

- [x] T015 [US2] 先在 `apps/kith-inn-fe/src/logic/menuEdit.test.ts` 写失败测试：自动 success runtime parse、指定 success 兼容、未知 `relaxedRules` 拒绝、缺失自动必填字段拒绝、规则中文固定顺序与 `dishIndex` 请求透传
- [x] T016 [US2] 在 `apps/kith-inn-fe/src/logic/menuEdit.ts` 按请求分支消费 shared runtime response schema，并实现完整、固定顺序的放宽规则中文纯函数
- [x] T017 [US2] 在 `apps/kith-inn-fe/src/pages/menu/index.tsx` 为每道菜传零起始 `dishIndex`，消费自动响应并在对应餐卡显示本次“菜品池较小”原因，空规则不显示
- [x] T018 [US2] 同步 `docs/kith-inn/TECH-SPEC.md`：双前门历史语义、四级放宽解释、位置精确性和 runtime response validation
- [x] T019 [US2] 运行 shared/FE logic 定向测试、`pnpm verify`、`git diff --check`，确认 contract 示例与实际 H5 请求/响应一致

## Phase 5：User Story 2 - H5 小池验收（PR5，P1）

**Goal**: 用真实 H5→BE→CMS 链路证明小菜品池不误失败且放宽提示可见。

**Independent Test**: Playwright 准备有菜单的餐次并把目标分类收缩为唯一冲突候选，页面点击换菜后同时验证菜名、顺序与提示。

- [ ] T020 [P] [US2] 在 `apps/kith-inn-fe/package.json`、`playwright.config.ts` 建立最小 H5 E2E 命令与 CMS kith-inn seed→BE→H5 webServer 编排，只声明仓库 lockfile 已有的 Playwright 版本
- [ ] T021 [US2] 在 `apps/kith-inn-fe/tests/e2e/menu-swap.spec.ts` 实现 dev-login、菜单准备、活跃同类池收缩、点击换菜、单位置变化及中文放宽提示断言
- [ ] T022 [US2] 验证 `turbo --affected` 会运行新 suite；仅在证据表明不会运行时，最小更新 `.github/workflows/ci.yml` 的 kith-inn E2E filter，不并入 #157 的 PostgreSQL/跨租户场景
- [ ] T023 [US2] 运行 `CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e`、`pnpm verify`、`git diff --check`，记录耗时和失败 trace 路径

## Dependencies & Execution Order

- PR1 合并后才开始 PR2；PR2–PR5 均等待前片 Codex review 干净并 rebase merge。
- T004 与 T005 可先写不同文件的失败测试；T006 后由 T007 组装，T008 收口。
- T009/T010/T012 可先写 shared/route/agent 失败测试；T011/T013 分别接好两个前门，T014 收口不回归。
- T015 先锁定 FE 边界，T016/T017 依次完成逻辑与页面，T018/T019 收口长期文档和门禁。
- T020 先提供 runner，T021 写唯一场景；T022 以实际 affected 证据决策，T023 最后验收。
- #163 五片全部合并后关闭 issue，再开始 #157；#157 扩展而不重写 PR5 的 H5 设施。

## Format Validation

- 共 23 项任务，ID 连续为 T001–T023；每项只属于一个 PR。
- 实现任务含精确文件路径；仅不同文件且无未完成依赖的任务标 `[P]`。
- 测试任务明确先写失败用例；没有 v1 代码修改、CMS schema、LLM、推荐系统或仓库新第三方库/版本任务。
