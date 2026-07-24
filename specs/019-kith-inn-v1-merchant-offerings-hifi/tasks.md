# Tasks：商家菜品库高保真重构

**Input**：`specs/019-kith-inn-v1-merchant-offerings-hifi/` 下的 spec、plan、research、data-model、contracts 和 quickstart

**Tests**：规格 FR-015 明确要求单元、E2E 和跨端构建验证；对应测试任务必须先于实现完成。

## PR 切片

| PR | 目标 / 核心不变量 | 关联故事/需求 | 包含任务 | 允许路径 / 非目标 | 独立验证 | 人工 diff | 依赖 |
|----|-------------------|---------------|----------|-----------------|----------|-----------|------|
| PR1 | 固化 Page 2 行为、竞态约束和执行计划 | US1-US4、FR-001~015 | T001-T003 | `specs/019-kith-inn-v1-merchant-offerings-hifi/**`；不改运行时代码 | checklist 全通过、Task ID 映射检查 | 约 500 行 | 无 |
| PR-Assets | 让 Page 2 高保真参考可由仓库独立读取和复核 | US4、FR-012~014 | T018 | `docs/kith-inn-v1/design/merchant-offerings-hifi-v0.2.png`、`docs/kith-inn-v1/design/kith-inn-v1-hifi-v1.html`；排除所有 `*-prompt.md` | 文件可读取、HTML 可打开、PNG 尺寸与内容人工核对 | HTML 约 360 行；PNG 为二进制资产 | PR1 |
| PR2 | 保证异步响应与编辑合并不破坏当前用户意图 | US1-US3、FR-003/004/006/008~010/015 | T004-T012、T019 | `apps/kith-inn-v1-fe/src/logic/offeringsView*`、`apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx`、`docs/kith-inn-v1/TECH-SPEC.md`、`docs/kith-inn-v1/USER-STORIES.md`；不做视觉换肤 | Vitest coverage、lint、typecheck、定向 E2E、长期文档一致性核对 | 约 400 行 | PR-Assets |
| PR3 | 收敛 Page 2 页面结构且不回退真实管理流程 | US1/US2/US4、FR-001/002/005/012~015 | T013、T015、T020 | `apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx`、`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts`、`apps/kith-inn-v1-fe/tests/e2e/jielong-import.spec.ts`、`docs/kith-inn-v1/TECH-SPEC.md`、`docs/kith-inn-v1/USER-STORIES.md`；不做最终视觉换肤，不改 API/CMS | 定向 E2E、lint、typecheck、双端 build、长期文档一致性核对 | 约 520 行；目标单一，页面、行为 E2E 与对应产品文档同片才能独立验收 | PR2 |
| PR4 | 完成 Page 2 高保真样式和窄屏验收 | US4、FR-001/002/012~015 | T014、T016-T017 | `apps/kith-inn-v1-fe/src/app.css`、`specs/019-kith-inn-v1-merchant-offerings-hifi/quickstart.md`；不再改业务流程，不提交 Prompt | 354×786 对已入库 PNG/HTML 的视觉验收、`pnpm verify`、定向 E2E | 约 460 行；共享视觉层与验收记录同片才能完整核对 | PR3、PR-Assets |

每个 Task ID 只在上表出现一次；依赖顺序为 PR1 → PR-Assets → PR2 → PR3 → PR4，无环。每片统一完成定义遵循 `AGENTS.md` 与 `pr-review-converge`：`git diff --check`、`pnpm verify`、latest-head CI、Codex review、0 unresolved thread、`mergeStateStatus=CLEAN`、rebase merge。

## Phase 1：规格与设计基线

**目的**：在运行时代码前固定行为范围、竞态不变量和 PR 边界。

- [x] T001 在 `specs/019-kith-inn-v1-merchant-offerings-hifi/spec.md` 与 `checklists/requirements.md` 定义并校验用户场景、边界和成功标准
- [x] T002 在 `specs/019-kith-inn-v1-merchant-offerings-hifi/plan.md`、`research.md`、`data-model.md`、`contracts/merchant-offerings-ui.md` 和 `quickstart.md` 记录 brownfield 事实、设计决策与验证方法
- [x] T003 在 `specs/019-kith-inn-v1-merchant-offerings-hifi/tasks.md` 建立完整 Task ID、story 与 PR slice 映射

---

## Phase 1.5：可复现视觉基线

**Goal**：任何后续 agent 都能只从仓库读取 Page 2 高保真参考，不依赖本地工作树。

- [ ] T018 [US4] 在独立 PR-Assets 中提交 `docs/kith-inn-v1/design/merchant-offerings-hifi-v0.2.png` 与 `docs/kith-inn-v1/design/kith-inn-v1-hifi-v1.html`，明确排除所有 `*-prompt.md`

**Checkpoint**：PNG/HTML 均可从仓库读取和打开，PR4 的视觉验收具备稳定输入。

---

## Phase 2：User Story 1 - 浏览、筛选和安全启停（Priority: P1）

**Goal**：不同菜品可以独立操作，同一道菜的旧响应不能覆盖新状态。

**Independent Test**：对两个菜品交错开始和结束启停请求，验证 pending 集合、revision 和最终列表仅受各自最新请求影响。

- [ ] T004 [US1] 先在 `apps/kith-inn-v1-fe/src/logic/offeringsView.test.ts` 增加逐菜品 pending/revision、乱序完成和筛选测试并确认新断言失败
- [ ] T005 [US1] 在 `apps/kith-inn-v1-fe/src/logic/offeringsView.ts` 实现逐菜品请求协调器和最新响应判定，使 T004 通过
- [ ] T006 [US1] 在 `apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx` 接入逐菜品 pending/revision，避免其他请求的 `finally` 提前解锁或陈旧响应写回

**Checkpoint**：启停正确性可独立通过单元测试和现有 CRUD E2E 验证。

---

## Phase 3：User Story 2 - 原位维护菜品（Priority: P1）

**Goal**：编辑保持目标位置和上下文，新增才追加。

**Independent Test**：编辑数组中间元素后比较全部标识顺序，再验证 create 结果只追加一次。

- [ ] T007 [US2] 先在 `apps/kith-inn-v1-fe/src/logic/offeringsView.test.ts` 增加 edit 原位替换、create 追加和未知 edit 防重复测试并确认新断言失败
- [ ] T008 [US2] 在 `apps/kith-inn-v1-fe/src/logic/offeringsView.ts` 实现按操作模式合并保存结果的纯函数，使 T007 通过
- [ ] T009 [US2] 在 `apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx` 接入保存合并函数并保留当前 view/filter

**Checkpoint**：编辑顺序与新增行为可独立由纯逻辑测试验证。

---

## Phase 4：User Story 3 - 安全批量导入（Priority: P1）

**Goal**：预览、冲突选择和提交只属于当前原文版本。

**Independent Test**：修改原文后让旧预览/提交结果返回，验证旧版本失效且没有可提交的陈旧冲突选择。

- [ ] T010 [US3] 先在 `apps/kith-inn-v1-fe/src/logic/offeringsView.test.ts` 增加导入草稿版本推进、快照匹配和旧版本拒绝测试并确认新断言失败
- [ ] T011 [US3] 在 `apps/kith-inn-v1-fe/src/logic/offeringsView.ts` 实现导入草稿 revision/snapshot 协调器，使 T010 通过
- [ ] T012 [US3] 在 `apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx` 将 preview/commit 绑定原文版本，文本变化清空旧状态且过期响应不写回
- [ ] T019 [US1] [US2] [US3] 在 `docs/kith-inn-v1/TECH-SPEC.md` 与 `docs/kith-inn-v1/USER-STORIES.md` 同步逐菜品最新响应、原位编辑和导入原文失效的长期产品行为

**Checkpoint**：导入数据风险可由单元测试和接龙 E2E 独立验证。

---

## Phase 5：User Story 4 - 高保真移动端呈现（Priority: P2）

**Goal**：在 H5/微信小程序保留真实业务能力，并与参考图保持稳定的移动端层级和可读性。

**Independent Test**：在 354×786 核对默认、管理、新增/编辑和导入态，再构建两个目标平台。

- [ ] T013 [US4] 在 `apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx` 依据本规格和 UI 契约实现浏览/管理/弹层 JSX、加载/空/错误状态，并保留仓库现有真实 API、认证和错误处理入口
- [ ] T014 [US4] 在 `apps/kith-inn-v1-fe/src/app.css` 依据本规格实现完整高保真视觉层，并覆盖长菜名/主料省略、disabled 预览按钮可读性及 Page 1 导航兼容
- [ ] T015 [US4] 在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 与 `jielong-import.spec.ts` 覆盖新入口、管理分组、编辑顺序和导入失效回归
- [ ] T020 [US1] [US2] [US4] 在 `docs/kith-inn-v1/TECH-SPEC.md` 与 `docs/kith-inn-v1/USER-STORIES.md` 同步默认启用列表、分类筛选、浏览/管理模式和固定新增入口
- [ ] T016 [US4] 在 `specs/019-kith-inn-v1-merchant-offerings-hifi/quickstart.md` 记录 H5/微信小程序 build 与定向 E2E 的实际结果
- [ ] T017 [US4] 在 `specs/019-kith-inn-v1-merchant-offerings-hifi/quickstart.md` 记录 354×786 默认态、管理态、批量导入态的人工视觉验收及新增/编辑弹层的 E2E 验收事实

**Checkpoint**：四个用户故事均完成，页面可进入 PR 收口阶段。

---

## 依赖与执行顺序

- Phase 1 已完成；T018 的 PR-Assets 随后合并，为运行时切片提供仓库内视觉基线。
- T004 → T005 → T006；T007 → T008 → T009；T010 → T011 → T012。
- T019 依赖 T006、T009、T012，并与 PR2 的行为改动同片提交。
- T013 依赖 T006、T009、T012，避免页面结构改动掩盖正确性问题。
- T015 依赖 T013 以及 T006、T009、T012，用于验证页面入口和行为回归，不依赖只改变视觉的 T014。
- T020 依赖 T013/T015，并与 PR3 的页面行为改动同片提交。
- T014 依赖 T013 与 T018；T016/T017 依赖全部运行时代码、测试任务和已入库视觉基线。
- PR 实际合并顺序固定为 PR1 → PR-Assets → PR2 → PR3 → PR4；即使不同 story 的测试可并行编写，也不得绕过该顺序发布。

## 并行机会

- T004、T007、T010 都修改同一测试文件，实际按顺序执行以避免冲突。
- PR2 合并后，T013 与 T015 可在 PR3 内按页面实现、行为验证的顺序推进；T014 必须等 PR3 合并后再开始，最终视觉验收基于前序完整页面。
- 自动化验证中的 lint、typecheck 与文档链接检查可并行；coverage、E2E 和 build 按资源情况串行。

## 实施策略

1. 先以失败测试锁定逐菜品请求、原位编辑和导入版本三条正确性不变量。
2. 在 `offeringsView.ts` 提供最小纯逻辑/协调器，页面只负责调用 API 和提交视图状态。
3. 依据仓库内本规格和 UI 契约实现页面骨架与样式，不依赖外部工作树或未入库原型。
4. 完成定向自动化与视觉验证后再运行仓库统一门禁；本地 commit 是正常实现步骤，未经用户明确授权不得 push、开 PR 或执行其他外发动作。
