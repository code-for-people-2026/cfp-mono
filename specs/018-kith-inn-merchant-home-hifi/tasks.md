# Tasks: kith-inn-v1 商家今日工作台高保真重构

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 关联故事/需求 | 包含任务 | 允许路径 / 非目标 | 独立验证 | 人工 diff | 依赖 |
|----|-------------------|---------------|----------|-----------------|----------|-----------|------|
| PR1 | 商家首页以真实数据高保真呈现今日经营状态，且所有既有动作和失败恢复保持可达 | US1；FR-001–FR-016 | T001–T005 | `apps/kith-inn-v1-fe` 首页逻辑/渲染/样式/E2E 与本规格目录；不改 BE、CMS、shared，不纳入设计资产或完整还原说明 | logic coverage、merchant H5 E2E、H5/weapp build、目标视口视觉核对 | 约 650–780 行；若超过 800 行先确认或重切 | 无 |

### 每个 PR 的统一完成定义（不分配 Task ID）

1. 独立验证、适用的文档链接检查、`git diff --check` 和人工 diff 统计通过。
2. `pnpm verify` 通过。
3. 发起人确认外发后，Ready PR 的 latest-head CI 与 Codex review 按 `pr-review-converge` skill 收敛。
4. unresolved thread 为 0、`mergeStateStatus=CLEAN`，并只使用 rebase merge。

## Phase 1: User Story 1 - 一眼完成今日经营判断（Priority: P1）

**Goal**: 商家进入首页后按待确认、午晚餐、快捷动作的顺序看懂真实经营状态，并在加载、刷新、空餐次和失败时继续安全操作。

**Independent Test**: 用 H5 自动化覆盖非零/零待确认、预订中/待开放/截止/关闭/未排菜单、局部/整页失败、保留数据刷新及所有入口，再在参考视口核对信息层级、溢出和导航遮挡。

### Tests（先写并确认失败）

- [x] T001 [P] [US1] 在 `apps/kith-inn-v1-fe/src/logic/merchantHome.test.ts` 增加动态问候、状态文案、菜单构成摘要、价格与截止时间文案的边界测试
- [x] T002 [P] [US1] 在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 固定品牌/无头像、条件式提醒、餐次卡片点击与防冒泡、待开放/空状态、四个快捷入口和底部导航行为

### Implementation

- [x] T003 [US1] 在 `apps/kith-inn-v1-fe/src/logic/merchantHome.ts` 实现 T001 固定的纯展示模型，同时保持日期、餐次状态、真实汇总和手动加单资格逻辑
- [x] T004 [US1] 在 `apps/kith-inn-v1-fe/src/pages/merchant/home/index.tsx` 按品牌/问候/提醒/餐次/快捷入口顺序重组渲染，接入纯逻辑、真实路由、局部恢复和卡片事件隔离
- [x] T005 [US1] 在 `apps/kith-inn-v1-fe/src/app.css` 高保真还原奶油背景、层级、卡片、状态、触控区、快捷网格与安全区底部导航，并依据目标视口视觉核对结果收敛样式

## Dependencies & Execution Order

- T001 与 T002 修改不同测试文件，可并行起草；两者必须先取得预期失败证据。
- T003 依赖 T001；T004 依赖 T002、T003；T005 依赖 T004 的最终语义结构。
- 全部任务只属于 US1 和 PR1；任务映射无遗漏、无重复、无环。

## Requirement Coverage

| 范围 | 任务 |
|------|------|
| FR-002、FR-005–FR-007、FR-010、FR-013；SC-002、SC-004 | T001、T003 |
| FR-001、FR-003–FR-013、FR-015–FR-016；SC-002–SC-004 | T002、T004 |
| FR-001、FR-005、FR-008、FR-012、FR-014–FR-015；SC-001、SC-005 | T005 |

## Implementation Strategy

先用纯逻辑和 H5 行为测试锁定真实状态与入口，再最小改造现有类组件，最后在不引入图片或图标依赖的情况下收敛跨端 CSS。实现过程中保留现有 API client、session、revision 与局部重试结构；不复制参考数据，不创建新后端能力。

## Format Validation

- 共 5 项任务，ID 连续为 T001–T005，全部带 `[US1]` 且在 PR1 中恰好出现一次。
- `[P]` 只标记起草阶段互不修改同一文件的两组测试；后续实现严格按依赖顺序执行。
- 每项任务均给出精确文件路径；通用验证、外发、review、resolve 和 merge 只在统一完成定义中出现。
