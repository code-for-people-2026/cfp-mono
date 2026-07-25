# Tasks：商家本周菜单高保真工作区

**Input**：`specs/020-kith-inn-v1-merchant-menu-hifi/` 下的 spec、plan、research、data-model、contracts 和 quickstart

**Tests**：规格 SC-003/004/006/007/009/010 明确要求纯逻辑、关键流程 E2E、并发只读保护、完整门禁和跨端构建；测试任务必须先于对应实现。

## PR 切片

| PR | 目标 / 核心不变量 | 关联故事/需求 | 包含任务 | 允许路径 / 非目标 | 独立验证 | 人工 diff | 依赖 |
|----|-------------------|---------------|----------|-----------------|----------|-----------|------|
| PR1 | 固化 Page 3 产品边界、视图模型和执行计划 | US1-US4、FR-001~038 | T001-T003 | `specs/020-kith-inn-v1-merchant-menu-hifi/**`；不改运行时代码 | checklist、Spec Kit 前置检查、Task ID 映射 | 约 740 行 | 无 |
| PR-Assets | 让 Page 3 独立参考图可由仓库读取 | SC-005 | T004 | `docs/kith-inn-v1/design/merchant-menu-hifi-v0.2.png`；排除所有 Prompt | PNG 尺寸、大小和 SHA-256 核对 | 二进制 | PR1 |
| PR-Guard-Store | CMS 配置的 Payload 公共写入边界串行化菜单与预订状态写入，并只在锁内最新状态仍为草稿时提交 | US2/US3、FR-014 | T020-T021 | `apps/cms/payload.config.ts`、`src/lib/kiv1-meal-slot-menu-guard.ts`、`tests/kiv1-meal-slot-menu-guard.test.ts`、长期文档；不改 service route、Payload 包、公开 API 或 UI | Postgres 交错事务、SQLite 即时事务、admin/REST/local 边界 | 约 360 行 | PR1 |
| PR-Guard-Service | 服务层预检查并稳定透传持久化层的菜单锁定冲突 | US2/US3、FR-014 | T022-T023 | backend/CMS route 与测试、服务错误语义文档；不改变 collection 策略、公开 API 或 UI | 锁定冲突、过期草稿、coverage、lint、typecheck | 约 260 行 | PR-Guard-Store |
| PR2 | 工作周和操作目标不受设备时区或数据顺序影响 | US1/US2、FR-001~008/013~025/035~036 | T005-T006 | `apps/kith-inn-v1-fe/src/logic/menuWeek.ts`、`menuWeek.test.ts`、必要的 `menu.ts*`；不改 JSX/CSS | coverage、lint、typecheck | 约 380 行 | PR-Guard-Service |
| PR3 | 自动周视图只呈现所选日两个真实餐次位置 | US1、FR-001~014/029~033 | T007-T009 | 菜单页、merchant E2E、长期文档；不接新 mutation、不做最终换肤 | 先失败 E2E；coverage、双端 build | 约 520 行 | PR2 |
| PR4 | 生成、补齐和覆盖只作用于匹配当前操作上下文的可编辑目标 | US2、FR-015~021/024~026/031/037~038 | T010-T011 | 菜单页和 merchant E2E；不做换菜/配置/最终换肤 | 每目标 revision、部分成功提示与重载、跨周延迟响应 E2E 与双端 build | 约 580 行 | PR3 |
| PR5-Swap | 换菜只更新目标草稿且旧响应不能污染新工作周 | US3、FR-022~024/030~031/037 | T012-T013 | 菜单页、换菜 E2E、长期文档；不做预订配置或最终换肤 | 局部替换、无候选、只读与延迟响应 E2E | 约 360 行 | PR4 |
| PR5-Booking | 菜单与预订配置往返保持工作周和餐次上下文 | US4、FR-025~030/031 | T014-T017 | 菜单页、配置页、booking 纯逻辑/E2E、长期文档；不做换菜或最终换肤 | query 解析、预填、自动加载与返回刷新 E2E | 约 340 行 | PR5-Swap |
| PR6 | Page 3 在目标窄屏形成完整高保真视觉层 | SC-005/009、FR-006/010~014/025/031~033 | T018-T019 | `src/app.css`、本功能 quickstart；不改业务规则、不提交 Prompt | 354×786 视觉验收、定向 E2E、`pnpm verify` | 约 520 行 | PR5-Booking、PR-Assets |

所有 T001-T023 恰好映射一次；依赖图为 `PR1 → PR-Guard-Store → PR-Guard-Service → PR2 → PR3 → PR4 → PR5-Swap → PR5-Booking → PR6` 与 `PR1 → PR-Assets → PR6`，无环。每片统一完成定义遵循 `AGENTS.md` 与 `pr-review-converge`：独立验证、`git diff --check`、`pnpm verify`、latest-head CI、最新 Codex review、0 unresolved thread、`mergeStateStatus=CLEAN`、rebase merge。

## Phase 1：规格与设计

**目的**：固定产品范围、brownfield 事实、视图契约和 PR 边界。

- [x] T001 在 `specs/020-kith-inn-v1-merchant-menu-hifi/spec.md` 与 `checklists/requirements.md` 定义并校验用户场景、边界和成功标准
- [x] T002 在 `specs/020-kith-inn-v1-merchant-menu-hifi/plan.md`、`research.md`、`data-model.md`、`contracts/merchant-menu-ui.md` 和 `quickstart.md` 记录设计决策、行为契约和验收方法
- [x] T003 在 `specs/020-kith-inn-v1-merchant-menu-hifi/tasks.md` 建立完整 Task ID、story 与 PR slice 映射

---

## Phase 1.5：可复现视觉基线

**Goal**：最终视觉 PR 只从仓库读取独立 Page 3 参考图。

- [ ] T004 从用户指定的 `d097` 路径取得独立 PNG，在 PR-Assets 中提交 `docs/kith-inn-v1/design/merchant-menu-hifi-v0.2.png`，核对 155701 bytes、708×1572 RGB、SHA-256 `0ac15d72a2a0818499a2c427b841d9ac6378baea9a9a22b79efe446cb8ce6259`，并明确排除 `docs/kith-inn-v1/design/merchant-menu-hifi-rebuild-prompt.md` 和所有其他 Prompt

**Checkpoint**：PNG 可读取、尺寸正确，PR6 不依赖指定工作树继续存在。

---

## Phase 1.75：持久化菜单只读保护

**Goal**：已经进入预订生命周期的餐次不能通过生成、覆盖或换菜改变菜单。

- [ ] T020 先新增 `apps/cms/tests/kiv1-meal-slot-menu-guard.test.ts`，覆盖 direct local API、admin/REST 等价更新；增加 Postgres 两事务交错测试，明确让菜单请求与开放请求都先看到 `draft`、开放先提交、菜单随后取得行锁并重读后被拒绝；增加 SQLite 即时事务和事务/锁不可用时 fail-closed 测试，确认失败
- [ ] T021 新增 `apps/cms/src/lib/kiv1-meal-slot-menu-guard.ts`，并在 `apps/cms/payload.config.ts` 组合导入的 `MealSlots` collection 时追加公共 `beforeChange` hook：Postgres `SELECT … FOR UPDATE` 持锁至提交、SQLite 复用即时写事务，锁内重读最新 `orderStatus`，非 `draft` 或无法取得事务/锁会话时拒绝菜单变更；不依赖 hook `originalDoc`，不让 `packages/kith-inn-v1-payload` 导入 CMS 模块。同时在 `docs/kith-inn-v1/USER-STORIES.md` 与 `docs/kith-inn-v1/TECH-SPEC.md` 记录开放/关闭菜单只读不变量及配置层事务架构，不修改 service route 或公开 API

**Checkpoint**：直接 Payload 与数据库交错测试证明只读不变量不依赖前端按钮，也不受两个请求都曾读到 `draft` 的 TOCTOU 影响。

## Phase 1.8：服务层菜单只读集成

**Goal**：backend 快速预检并稳定透传持久化边界的锁定冲突，不改变存储策略或公开 API。

- [ ] T022 先在 `apps/kith-inn-v1-be/src/routes/mealSlots.test.ts` 增加 `open` / `closed` 生成覆盖与换菜拒绝、截止时间已过的 `draft` 仍可编辑测试，并在 `apps/cms/tests/kiv1-meal-slots.test.ts` 增加稳定 409 冲突透传测试，确认失败
- [ ] T023 在 `apps/kith-inn-v1-be/src/routes/mealSlots.ts` 实现批量目标快速预检查，在 `apps/cms/src/app/api/internal/kiv1/meal-slots/[id]/route.ts` 稳定透传存储层冲突；在 `docs/kith-inn-v1/TECH-SPEC.md` 补充 backend/CMS 409 错误映射语义；保持 collection 策略、公开 API 形状与生成算法不变

**Checkpoint**：backend 与 CMS 集成测试证明锁定冲突语义稳定，截止时间已过的 `draft` 仍可编辑。

---

## Phase 2：User Story 1 - 工作周纯逻辑（Priority: P1）

**Goal**：任意设备时区、跨月和乱序餐次输入都得到稳定五日视图、状态、目标和 CTA。

**Independent Test**：用固定时间戳覆盖周一至周日、跨月、截止边界、空/部分/完整/开放工作周，比较完整派生结果。

- [ ] T005 [US1] 先在 `apps/kith-inn-v1-fe/src/logic/menuWeek.test.ts` 增加上海默认周、五日范围、当前周首个未过去工作日、过去/未来周周一、切周重置默认日、日期摘要、餐次状态、可编辑性、缺失/覆盖目标和动态 CTA 测试；菜单完成度与预订信号分别断言，并覆盖“午餐开放、晚餐缺失”同时为部分完成和预订中，以及截止时间已过的 `draft` 不产生已截止信号，确认失败
- [ ] T006 [US1] 在 `apps/kith-inn-v1-fe/src/logic/menuWeek.ts` 实现 T005 所需的纯业务日期与周视图函数，并仅在必要时复用 `apps/kith-inn-v1-fe/src/logic/menu.ts`

**Checkpoint**：PR2 可只靠单元测试证明时间、视图和目标计算正确，不含页面改动。

---

## Phase 3：User Story 1 - 自动只读周界面（Priority: P1）

**Goal**：进入页面自动加载周一至周五，只显示所选日午晚餐并可安全切周。

**Independent Test**：mock 空周、部分周和完整周，验证默认周、日期条、两张卡、最后请求获胜和保留数据刷新。

- [ ] T007 [US1] 先在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 增加自动周加载、五日选择、午晚餐缺失位置、切周 latest-request-wins、刷新保留和加载错误重试的 E2E；使用可复现的本地 seed 从进入菜单页开始计时，断言工作周与午晚餐状态在 3 秒内可见，并确认新断言失败
- [ ] T008 [US1] 在 `apps/kith-inn-v1-fe/src/pages/merchant/menu/index.tsx` 接入 `menuWeek` 视图模型，实现认证、自动加载、切周/切日、只读餐次卡、刷新和错误态，保留低优先级接龙入口与 `MerchantNav`
- [ ] T009 [US1] 在 `docs/kith-inn-v1/USER-STORIES.md` 与 `docs/kith-inn-v1/TECH-SPEC.md` 同步自动工作周、上海日期、latest-request-wins 和所选日双餐次行为

**Checkpoint**：不执行菜单写入也能独立验收完整周工作区；现有 API 和认证保持不变。

---

## Phase 4：User Story 2 - 生成、补齐与覆盖（Priority: P2）

**Goal**：单餐、整周和补齐发送精确目标，已有可编辑草稿必须明确确认后才覆盖。

**Independent Test**：依次验证空周生成十个目标、部分周只补缺失、单餐独立、覆盖目标列表、取消、菜品池不足和规则放宽。

- [ ] T010 [US2] 先在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 将既有菜单生成流程改成自动周交互，并增加只补缺失、覆盖目标说明、只读餐次排除、分类缺口、放宽规则、多目标部分持久化后重载并明确提示部分成功、A 周延迟 mutation 不污染已切换 B 周、同周旧刷新不回滚生成结果，以及不同目标并行 mutation 的响应都可合并的 E2E，确认新断言失败
- [ ] T011 [US2] 在 `apps/kith-inn-v1-fe/src/pages/merchant/menu/index.tsx` 接入单餐/整周/补齐、覆盖确认层、分类缺口引导和放宽说明；为生成操作记录目标周与每个 `targetKey` 的 mutation revision，并在发出和提交时推进共享 view revision 使旧同周读取失效；pending 只锁定关联餐次或周主操作，不同目标响应独立校验并合并；非菜品池失败重载原目标周、明确提示部分目标可能已保存，且不覆盖当前其他周

**Checkpoint**：所有真实生成能力在新周视图中可用；单目标失败保留原菜单，多目标中途失败保持每个已保存餐次结构完整，并让页面提示与服务端真实状态一致。

---

## Phase 5：User Story 3 - 调整一道菜（Priority: P3）

**Goal**：用户只选择要换掉的菜，成功局部替换，无候选时保留原菜单。

**Independent Test**：对草稿选择一道菜替换并比较其余四道；对无候选和只读餐次核对零写入与入口隐藏。

- [ ] T012 [US3] 先在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 增加“选择要换掉的菜”层、局部替换、无候选保持原菜单、逐餐次 pending、只读入口隐藏、换菜延迟响应不污染新工作周、不同餐次并行响应均可合并，以及同周旧刷新不回滚换菜结果的 E2E 并确认新断言失败
- [ ] T013 [US3] 在 `apps/kith-inn-v1-fe/src/pages/merchant/menu/index.tsx` 实现换菜选择层、逐餐次 pending、目标周与目标餐次 revision 校验，并在换菜发出和提交时推进共享 view revision；成功只合并匹配目标响应，不同餐次互不失效，无候选引导菜品库，并在长期文档同步换菜职责

---

## Phase 6：User Story 4 - 预订配置衔接（Priority: P4）

**Goal**：从周或餐次进入现有配置页时自动加载目标上下文，返回后刷新当前周。

**Independent Test**：从指定晚餐进入配置，核对日期预填和自动加载；配置后返回，核对菜单页保持周/日期并显示最新状态。

- [ ] T014 [US4] 先在 `apps/kith-inn-v1-fe/src/logic/bookingBatches.test.ts` 增加配置 query 日期/餐次解析与无效参数降级测试，并在 `apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` 增加预填、自动加载和返回刷新 E2E，确认新断言失败
- [ ] T015 [US4] 在 `apps/kith-inn-v1-fe/src/logic/bookingBatches.ts` 实现最小配置 query 解析纯函数
- [ ] T016 [US4] 在 `apps/kith-inn-v1-fe/src/pages/merchant/menu/index.tsx` 和 `pages/merchant/batches/index.tsx` 接入当前周/餐次 query、动态底部 CTA、配置页自动加载与返回刷新
- [ ] T017 [US4] 在 `docs/kith-inn-v1/USER-STORIES.md` 与 `docs/kith-inn-v1/TECH-SPEC.md` 同步换菜选择、菜单/配置职责边界和返回刷新行为

**Checkpoint**：菜单安排到开放预订形成真实流程，但没有复制服务端或配置表单。

---

## Phase 7：高保真视觉与最终验收

**Goal**：目标窄屏下页面层级、卡片、弹层、动态 CTA 和导航与入库参考高度一致。

**Independent Test**：在 354×786 核对空/部分/完整/只读、覆盖、换菜和不足状态，并构建两个平台。

- [ ] T018 在 `apps/kith-inn-v1-fe/src/app.css` 依据 UI 契约和仓库内 Page 3 PNG/HTML 完成顶部、周切换、五日日期条、午晚餐卡、状态胶囊、弹层、固定 CTA、安全区和窄屏长文本样式
- [ ] T019 在 `specs/020-kith-inn-v1-merchant-menu-hifi/quickstart.md` 记录最新定向 E2E、双端 build、`pnpm verify` 和 354×786 实际视觉验收结果；真机结果仅按事实记录

**Checkpoint**：所有用户故事和代码门禁完成，可进入最终 PR 收口。

## 依赖与执行顺序

- Phase 1 已完成；T004 可在 PR1 后独立合并，但最迟必须在 PR6 前完成。
- T020 → T021 → T022 → T023；持久化保护与服务集成完成后执行 T005 → T006；PR2 合并后才执行 T007 → T008 → T009。
- PR3 合并后执行 T010 → T011；PR4 合并后以 PR5-Swap 执行 T012 → T013，再以独立 PR5-Booking 执行 T014 → T015 → T016 → T017。
- T018 依赖 PR5-Booking 与 T004；T019 依赖全部运行时代码、自动化和视觉基线。
- 不同时开放多个运行时代码 PR；每片合并后从最新 `origin/main` 开始下一片。

## 并行机会

- T004 与 PR2 在依赖图上可交换先后，但按单 PR 收口纪律依次推进。
- PR5-Swap 与 PR5-Booking 都修改菜单页和 merchant E2E，但属于可独立验收的 user story，必须串行发布为两个 PR；booking 纯逻辑测试可在页面接线前编写。
- 每片的 lint、typecheck 和文档检查可并行；coverage、E2E 与 build 按资源情况串行。

## 实施策略

1. 先让纯周逻辑完整失败并通过，页面不重复实现日历或 CTA 规则。
2. 只读周视图先独立落地，再逐片恢复现有 mutation，避免一次重写全部行为。
3. 预订配置只做 query 预填与返回刷新，不扩大后端或复制表单。
4. 最终 CSS 只在所有行为稳定后进入；Prompt 始终留在本地，PR 只包含允许的 PNG。
