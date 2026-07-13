# Tasks：kith-inn 主链路真实 E2E 与 CMS 集成验证

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/e2e-scenarios.md](./contracts/e2e-scenarios.md)、[quickstart.md](./quickstart.md)

## PR 切片（必须）

| PR | 目标 / 核心不变量 | 包含任务 | 独立验证 | 依赖 |
|----|-------------------|----------|----------|------|
| PR1 | 冻结真实链路、失败/租户边界与小 PR 执行顺序 | T001–T004 | requirements checklist、artifact 一致性分析、`git diff --check` | #185 |
| PR2 | 真实 PostgreSQL/CMS 双 seller 隔离与项目级 reset 对 v1 零影响 | T005–T009 | CMS PG 集成测试、v1 sentinel、`pnpm verify` | PR1 |
| PR3 | PostgreSQL H5 编排贯通登录→接龙 preview→draft→confirm happy path | T010–T015 | mainline Playwright happy path 连跑、affected dry-run、`pnpm verify` | PR2 |
| PR4 | 缺日期失败、无地址成功、重复提交/确认重试不产生重复经营数据 | T016–T019 | 四类边界 E2E、零变化/唯一性断言、`pnpm verify` | PR3 |
| PR5 | 连续 journey 完成菜单→发布→已付→批量送达，并交付 CI 诊断证据 | T020–T024 | mainline 连跑 3 次、CI artifact、affected matrix、`pnpm verify` | PR4 |

## Phase 1：规格与规划（PR1）

**Goal**: 在实现前固定真实/固定边界、场景证据、租户不变量和每个后续 PR 的 review 预算。

- [x] T001 审计 issue #157、`docs/kith-inn/**`、`specs/011-*` 至 `specs/015-*`、`.github/workflows/ci.yml`、`apps/kith-inn-fe/playwright.config.ts` 与旧 kith-inn FE/BE/CMS 主链路，记录 brownfield 事实
- [x] T002 完成 `specs/016-kith-inn-mainline-e2e/spec.md` 与 `checklists/requirements.md`，覆盖 happy path、缺日期、无地址、幂等、双 seller 和非 v1 边界
- [x] T003 完成 `plan.md`、`research.md`、`data-model.md`、`contracts/e2e-scenarios.md`、`quickstart.md` 与 PR1–PR5 切片
- [x] T004 生成 `tasks.md` 后执行 speckit artifact 一致性分析，修正全部 CRITICAL/HIGH 与 actionable MEDIUM 问题并运行 `git diff --check`

## Phase 2：User Story 4 - 真实 CMS/PostgreSQL 租户基座（PR2，P1）

**Goal**: 不启动 H5，先用真实 Payload/PostgreSQL 固定双 seller、relationship、批量写和项目级 seed isolation 的安全证据。

**Independent Test**: 在本地/CI PostgreSQL 中创建 seller A/B 同类资源与 v1 sentinel，通过真实旧 kith-inn internal route handler/CMS client 执行读写和跨租户尝试；A 只见 A、B 零变化，kith reset 前后 v1 sentinel 完全一致。

- [x] T005 [P] [US4] 在 `apps/cms/tests/helpers/kithInnMainline.ts` 建立要求 PostgreSQL 的 Payload 生命周期、双 seller/operator/resource fixture、清理与稳定业务标识 helper，缺 PostgreSQL 时明确 skip/fail 规则
- [x] T006 [US4] 在 `apps/cms/tests/kith-inn-mainline-integration.test.ts` 先写真实 customers/orders/reconcile/confirm/menu-plans/fulfillments/service-slots 读写的 seller A happy-path 集成断言
- [x] T007 [US4] 在 `apps/cms/tests/kith-inn-mainline-integration.test.ts` 增加 seller A 对 seller B 的读取、update、bulk ids 与跨 seller relationship 攻击矩阵，断言拒绝/空结果及 B 零变化
- [x] T008 [US4] 在 `apps/cms/tests/kith-inn-mainline-integration.test.ts` 调用 `apps/cms/seed/run.ts` 的项目级 reset/seed 真实逻辑，以 `kiv1_*` sentinel 断言 id、内容、数量及访问变化均为零
- [x] T009 [US4] 运行 `apps/cms/tests/kith-inn-mainline-integration.test.ts`、既有 `apps/cms/tests/seed-run.test.ts`、`pnpm verify` 与 `git diff --check`，记录 PR2 PostgreSQL 命令和人工 diff

**PR2 验证记录（2026-07-13）**：显式 opt-in 下本地 PostgreSQL 窄测试 19/19 通过（2.39s），无 opt-in 时破坏性 suite 安全跳过，强制重跑 CMS coverage 与 `pnpm verify` 通过；人工 diff 为 340 insertions / 13 deletions。

## Phase 3：User Story 1 - H5 订单 happy path（PR3，P1）

**Goal**: 在独立 PostgreSQL 环境中从 H5 登录、粘完整接龙并确认 preview/draft/order，证明 UI→BE→真实 CMS 的首次完整订单闭环。

**Independent Test**: 运行 `test:e2e:mainline`，从项目级 reset/seed 开始，由 H5 完成登录、粘贴含午晚餐的固定接龙、确认 preview 和确认订单；support API 只读断言每个业务坐标唯一、draft 前无经营副作用、confirm 后 slot/fulfillment 一致。

- [x] T010 [P] [US1] 在 `apps/kith-inn-fe/tests/e2e/fixtures/fixed-llm-server.ts` 实现测试专用 DeepSeek-compatible 固定 HTTP 服务，只返回场景 contract 允许的 tool call，未知输入明确失败
- [x] T011 [P] [US1] 在 `apps/kith-inn-fe/tests/e2e/fixtures/mainline.ts` 实现日期冻结、API 登录/只读查询、响应断言、订单聚合唯一性与服务日志路径 helper，不直接代替 H5 业务动作
- [x] T012 [US1] 在 `apps/kith-inn-fe/playwright.mainline.config.ts` 编排本地 `pnpm db:up`（CI 复用 service）、kith-inn safe reset/seed、fixed LLM、CMS 3306、BE 3311 与 H5 10087，并隔离 mainline report/results/logs
- [x] T013 [US1] 在 `apps/kith-inn-fe/package.json` 增加 `test:e2e:mainline`，让既有 `test:e2e` 串行执行 #185 快速 config 与 PostgreSQL mainline config，不新增 Playwright 版本
- [x] T014 [US1] 在 `apps/kith-inn-fe/tests/e2e/mainline.spec.ts` 实现 `E2E-ORDER-001`：H5 dev-login、完整午晚接龙、preview 断言、确认草稿/订单、数据库前后差异与 order/item/slot/fulfillment 唯一性
- [x] T015 [US1] 最小扩展 `.github/workflows/ci.yml` 的旧 kith-inn changed-path trigger 以覆盖 orders/customers/fulfillments/service-slots/chat/orderLifecycle；运行 mainline happy path 两次、workflow 等价 dry-run、`pnpm verify` 与 `git diff --check`

**PR3 验证记录（2026-07-13）**：PostgreSQL mainline happy path 独立重置连续通过，且从数据库完全停止状态可等待 healthy 后成功启动；旧 SQLite E2E 与 mainline 串行通过；affected dry-run 仅选中 `@cfp/kith-inn-fe#test:e2e`，`pnpm verify` 与 `git diff --check` 通过；人工 diff 为 277 insertions / 9 deletions。

## Phase 4：User Story 3 - 失败、地址与幂等（PR4，P1）

**Goal**: 用同一真实链路区分“缺日期必须拒绝”和“缺地址必须成功”，并证明重复/重试不会制造第二套经营数据。

**Independent Test**: 分别只运行四个 tagged 场景；每个场景从稳定初始状态开始，页面反馈正确，support API 精确证明零变化或唯一性。

- [x] T016 [US3] 在 `apps/kith-inn-fe/tests/e2e/fixtures/fixed-llm-server.ts` 与 `mainline.spec.ts` 增加 `E2E-DATE-001` 的缺日期/周几冲突固定模型输入，断言生产校验补全提示及 order/item/slot/fulfillment 零变化
- [x] T017 [US3] 在 `apps/kith-inn-fe/tests/e2e/mainline.spec.ts` 增加 `E2E-ADDRESS-001`，由 H5 新客地址留空后完成 draft/confirm，并断言订单快照为空且送餐页进入“无地址”组
- [x] T018 [US3] 在 `apps/kith-inn-fe/tests/e2e/mainline.spec.ts` 增加 `E2E-IDEMP-001`：重复接龙确认、同 operation retry 与订单 confirm retry/并发，断言 active order、item 集合和有效 fulfillment 计数不增长
- [x] T019 [US3] 分别运行 date/address/idempotency tagged E2E 与完整 mainline、`pnpm verify`、`git diff --check`，确认 PR4 不修改 v1 文件且人工 diff 不超预算

**PR4 验证记录（2026-07-14）**：date/address/idempotency tagged E2E 分别 1/1 通过，完整 mainline 4/4 通过；BE 434/434 测试通过且 coverage 四项 100%，`pnpm verify` 与 `git diff --check` 通过，无 v1 文件变更，人工 diff 为 281 insertions / 27 deletions。

## Phase 5：User Story 2 - 菜单、收款与送达连续收尾（PR5，P1）

**Goal**: 不 reset PR3 形成的订单，在同一 H5 journey 中完成菜单、付款与送达，使 MVP 从接龙到当餐收尾连续可证。

**Independent Test**: 从 `E2E-ORDER-001` 的页面会话与真实 confirmed orders 继续，所有业务动作通过 H5；最终 API 只读断言菜单 published、目标位置唯一变化、订单 paid、履约 done。

- [x] T020 [US2] 在 `apps/kith-inn-fe/tests/e2e/mainline.spec.ts` 把 `E2E-MAIN-001` 接到订单 happy path：H5 生成目标餐菜单、记录原始位置、自动换菜并验证完整中文放宽原因与非目标位置不变
- [x] T021 [US2] 在 `apps/kith-inn-fe/tests/e2e/mainline.spec.ts` 继续通过 H5 发布当前菜单、对目标订单标已付并精确批量送达，最终断言 publish text、未付口径和 fulfillment 状态

## Phase 6：CI 证据与交付收口（PR5）

**Goal**: 让相关 PR 稳定执行目标 suite，失败能下载完整诊断材料，无关项目不被误选。

- [x] T022 在 `apps/kith-inn-fe/playwright.mainline.config.ts` 与 `.github/workflows/ci.yml` 清理旧 mainline 产物、保留 failure trace/report，并上传 CMS/BE/fixed-LLM service logs；验证 webServer failure 和 assertion failure 两类 artifact
- [x] T023 用 `.github/workflows/ci.yml` 的等价 range/filter 命令验证 `CI-AFFECTED-001` 路径矩阵：旧 kith FE/BE/CMS/shared helper 100% 选中，纯 v1/website/community-cooking 0 次误选，共享 CMS 同时选中时保持 `--concurrency=1`
- [x] T024 连续运行 `CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e:mainline` 三次，运行根 `pnpm test:e2e` 的目标 dry-run、`pnpm verify` 和 `git diff --check`，把耗时/产物/最终任务状态同步到 `specs/016-kith-inn-mainline-e2e/{quickstart,tasks}.md`

**PR5 验证记录（2026-07-14）**：连续 H5 journey 与完整 mainline 4/4 在 CI 模式连续三次通过（21s / 21s / 22s）；受控 webServer failure 仅留下本次 CMS `ECONNREFUSED` 日志，受控 assertion failure 同时生成 trace、error context、HTML report 与五类 service log；synthetic Git tree 路径矩阵全部符合预期，根 E2E dry-run、`pnpm verify` 与 `git diff --check` 通过，无 v1 文件变更，人工 diff 为 148 insertions / 12 deletions。

## Dependencies & Execution Order

- PR1 合并后才开始 PR2；PR2–PR5 均等待前一片 Codex review 干净并 rebase merge。
- T005 先固定共享 fixture，T006/T007/T008 依次扩展同一集成测试，T009 收口 PR2。
- T010/T011 可并行；T012 组装服务，T013 暴露命令，T014 写 happy path，T015 才调整 CI trigger。
- T016/T017 依次扩展同一 spec，T018 复用订单 helper，T019 收口 PR4。
- T020 在既有 order journey 后追加菜单，T021 完成经营收尾；T022/T023 收口证据，T024 做最终三连跑。
- PR2 不创建 H5 runner，PR3 不并入失败矩阵，PR4 不并入菜单收尾；若实现暴露产品缺陷，只在当前场景直接依赖的旧 kith 路径做最小修复并补窄测试，不顺手扩展业务。

## Parallel Execution Examples

- PR2：T005 fixture 完成后，T006–T008 复用它逐层补齐 happy path、攻击矩阵与 v1 sentinel。
- PR3：T010 fixed LLM 与 T011 API/assert helper 无文件依赖，可并行；T012 后再接 T014。
- PR4：T016 date、T017 address 与 T018 idempotency 依次写入同一 spec，避免并行编辑冲突。

## Implementation Strategy

1. **安全基座优先**：PR2 先证明真实 CMS/PostgreSQL 与租户隔离，后续 H5 不重复搭安全矩阵。
2. **最小可用旅程**：PR3 只交付登录到订单确认，单独即可证明第一个跨层闭环。
3. **风险独立 review**：PR4 集中评审日期/地址/幂等，不与菜单 UI 混杂。
4. **经营闭环最后拼接**：PR5 延续同一 journey 完成菜单、收款、送达和 CI 证据，不重写前片 helper。

## Format Validation

- 共 24 项任务，ID 连续为 T001–T024；每项只属于一个 PR。
- User Story 阶段任务均带 `[US1]`、`[US2]`、`[US3]` 或 `[US4]`；Setup/收口任务不滥用 story 标签。
- 仅不同文件或可独立区域、且不依赖未完成实现的任务标 `[P]`。
- 所有实现任务均给出精确文件路径，验证任务给出明确命令与可观察不变量。
