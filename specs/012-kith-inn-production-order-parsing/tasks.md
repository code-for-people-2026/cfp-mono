# Tasks：kith-inn 生产接龙解析与订单对账

**Input**: `specs/012-kith-inn-production-order-parsing/` 下的设计文档

**Tests**: 规格明确要求四字段真实模型评测、fail-closed、陈旧确认、故障注入、并发和全仓门禁，因此测试任务为必需。

## Phase 1：Setup

**Purpose**: 固定五个最小 PR 的范围、现有测试入口与禁止触碰路径。

| PR | 单一目标 | Tasks |
|---|---|---|
| PR 1（#166） | 可信解析 | T001–T016 |
| PR 2（#168） | 快照对账核心与既有生产链路 | T017–T025 |
| PR 3（#171） | 增量对账核心 | T026–T028 |
| PR 4 | 增量生产确认链路 | T029–T030 |
| PR 5 | 长期文档与最终验收 | T031–T034 |

- [x] T001 核对 `specs/012-kith-inn-production-order-parsing/plan.md` 的 PR 切分，并记录 `apps/kith-inn-be/package.json`、`apps/cms/package.json`、`apps/kith-inn-fe/package.json` 的现有验证命令

---

## Phase 2：Foundational

**Purpose**: 先收紧生产/FE 共用的确认卡日期契约，阻止无日期候选继续流入写入路径。

- [x] T002 [P] 在 `packages/kith-inn-shared/src/schemas.test.ts` 增加确认候选必须含真实 `YYYY-MM-DD` 日期的失败/成功测试
- [x] T003 在 `packages/kith-inn-shared/src/schemas.ts` 与 `packages/kith-inn-shared/src/types.ts` 仅把 `ConfirmCustomerItem.date` 收紧为必填有效日期，PR 2 差异卡类型留到 T019

**Checkpoint**: 任何可执行记单卡在 shared 契约层都必须携带明确日期。

---

## Phase 3：User Story 1 - 从完整接龙得到可信订单候选（P1）🎯 PR 1 核心

**Goal**: 生产只通过唯一解析器从原文得到模式、范围和四字段候选；菜单正文忽略，日期/周几/餐次风险 fail closed。

**Independent Test**: 用含双餐标题、菜单编号、示例行、跨餐顾客和日期冲突的接龙调用生产工具；安全输入得到含完整日期的确认卡，风险输入没有 pending 写操作。

- [x] T004 [P] [US1] 在 `apps/kith-inn-be/src/domain/orders/parse.test.ts` 先增加 snapshot/increment schema、日期证据、Asia/Shanghai 参考日、周几冲突、菜单噪声和非法模型输出测试
- [x] T005 [P] [US1] 在 `apps/kith-inn-be/src/agent/tools.test.ts` 与 `apps/kith-inn-be/src/agent/run.test.ts` 先增加 `record_orders(rawText)`、原文透传、日期展示和阻断时不生成卡的编排测试
- [x] T006 [US1] 在 `apps/kith-inn-be/src/domain/orders/parse.ts` 实现唯一 `ParsedOrderInput` schema、原文日期证据解析/校验、snapshot/increment 模式和严格 fail-closed 结果
- [x] T007 [US1] 在 `apps/kith-inn-be/src/agent/tools.ts` 把 `record_orders` 改为只接收 `rawText`，调用服务解析结果并只为零 issues 的四字段候选建立 pending op
- [x] T008 [US1] 在 `apps/kith-inn-be/src/agent/services.ts` 注入 Asia/Shanghai 参考日并复用 `parse.ts`，删除 preview/record/create 中的日期默认今天语义
- [x] T009 [US1] 在 `apps/kith-inn-be/src/agent/run.ts` 更新主 agent 指令为原样转交记单文本、禁止自行补日期/餐次，并在 `apps/kith-inn-be/src/routes/chat.test.ts` 覆盖生产确认链路
- [x] T010 [US1] 在 `apps/kith-inn-fe/src/logic/orderConfirmView.ts`、`apps/kith-inn-fe/src/logic/orderConfirmView.test.ts` 与 `apps/kith-inn-fe/src/components/ChatCard.tsx` 中为每条记单候选展示完整日期，保持新客地址输入行为不变

**Checkpoint**: PR 1 的生产解析可独立上线；缺日期/冲突输入不会出现可执行卡，现有确认后创建草稿行为暂不改变。

---

## Phase 4：User Story 4 - 生产与评测使用同一解析口径（P1）🎯 PR 1 验收

**Goal**: 真实模型 eval 直接调用生产解析入口，按四字段整条匹配并记录可复现结果。

**Independent Test**: 对至少十段已标注真实接龙运行 `eval:parse`，报告四字段准确率、午晚错配、fail-closed issues、模型、参考日期和耗时。

- [x] T011 [P] [US4] 在 `apps/kith-inn-be/eval/jielong/samples.ts` 为全部真实样本补参考日期、每餐日期 ground truth 和已知日期/周几冲突标注
- [x] T012 [P] [US4] 在 `apps/kith-inn-be/src/domain/orders/evalAccuracy.test.ts` 先增加日期参与整条匹配、午晚错配和多重集合消费测试
- [x] T013 [US4] 在 `apps/kith-inn-be/src/domain/orders/evalAccuracy.ts` 将准确率收紧为日期+餐次+顾客+份数四字段全对
- [x] T014 [US4] 在 `apps/kith-inn-be/eval/run-parse.ts` 改为调用生产解析入口并输出模型、参考日期、issues、四字段准确率、午晚错配和耗时
- [x] T015 [US4] 运行真实模型 eval，把不含密钥的命令、模型、样本数、参考日期、准确率、错配和时间追加到 `specs/012-kith-inn-production-order-parsing/quickstart.md`
- [x] T016 [US4] 运行 PR 1 相关测试、`pnpm verify` 与 `git diff --check`，确认 `git diff --name-only` 不含任何 `kith-inn-v1`/`kiv1` 路径并更新 `specs/012-kith-inn-production-order-parsing/tasks.md`

**Checkpoint（PR 1）**: US1 与 US4 完成后提交第一个 PR；#155 保持打开，等待快照对账 PR。

---

## Phase 5：User Story 2 - 用最新完整接龙对账（P1）🎯 PR 2 核心

**Goal**: 完整接龙覆盖目标范围全部 active 订单且不区分此前录入方式，确认卡展示全集差异，确认后 CMS 原子应用且拒绝陈旧预览。

**Independent Test**: 先导入旧快照和自然语言补单，再预览含新增、改量和撤回的新快照；确认前零写入，确认后目标范围精确等于新快照，故障或陈旧卡不产生部分变化。

- [x] T017 [P] [US2] 在 `apps/kith-inn-be/src/domain/orders/reconciliation.test.ts` 先覆盖 snapshot 的 create/update/cancel/unchanged、全部 active 订单覆盖、空快照明确清空/疑似残缺阻断、名字归一、confirmed 警告和稳定 fingerprint
- [x] T018 [P] [US2] 在 `apps/cms/tests/order-reconciliation.test.ts` 先覆盖真实 PostgreSQL 新增/更新/取消/未变化、confirmed fulfillment、陈旧 fingerprint、故障回滚，以及同一 operation key 重复/同时提交只生效一次
- [x] T019 [P] [US2] 在 `packages/kith-inn-shared/src/schemas.ts`、`types.ts` 与 `schemas.test.ts` 定义并测试差异行和记单确认卡参数契约
- [x] T020 [US2] 在 `apps/kith-inn-be/src/domain/orders/reconciliation.ts` 实现 seller 当前数据到 snapshot 差异、最终数量、confirmed 影响和 expected fingerprint 的纯函数
- [x] T021 [US2] 在 `apps/cms/src/lib/orderLifecycle.ts` 实现 seller-scoped reconcile：事务内重验 fingerprint、创建新客/草稿、替换现单 items/total、取消退出项及同步 fulfillment
- [x] T022 [US2] 在 `apps/cms/src/app/api/internal/orders/reconcile/route.ts` 暴露内部原子对账契约并映射 `invalid-reconciliation`、`not-owned`、`stale-preview`、`inconsistent-order`
- [x] T023 [US2] 在 `apps/kith-inn-be/src/lib/cms/orders.ts` 与 `orders.test.ts` 增加一次性 reconcile client、请求/响应类型和稳定错误码测试
- [x] T024 [US2] 在 `apps/kith-inn-be/src/agent/services.ts`、`apps/kith-inn-be/src/agent/services.test.ts`、`apps/kith-inn-be/src/agent/tools.ts`、`apps/kith-inn-be/src/agent/tools.test.ts`、`apps/kith-inn-be/src/routes/chat.ts` 与 `apps/kith-inn-be/src/routes/chat.test.ts` 中用差异预览替换逐条创建，pending 只保存不可变候选、范围、operation key 和 fingerprint
- [x] T025 [US2] 在 `apps/kith-inn-fe/src/logic/orderConfirmView.ts`、`apps/kith-inn-fe/src/logic/orderConfirmView.test.ts` 与 `apps/kith-inn-fe/src/components/ChatCard.tsx` 中展示新增/更新/取消/不变、当前→最终数量和 confirmed 经营影响，不展示录入来源

**Checkpoint**: 完整接龙的“最后一次为准”成为独立可验证的原子切片，不再依赖数据库冲突表达重复粘贴。

---

## Phase 6：User Story 3 - 用自然语言单独补单（P1）

**Goal**: 自然语言只改唯一业务坐标；`add` 按当前数量追加，`set` 设置最终总数，确认卡把系统理解的运算完整展示。

**Independent Test**: 已有同日多人订单时分别执行“加 2 份”和“改成 2 份”；只目标订单改变，卡片计算与落库一致，重复网络提交不重复增加。

- [x] T026 [P] [US3] 在 `apps/kith-inn-be/src/domain/orders/reconciliation.test.ts` 增加无现单 add、已有现单 add、set、confirmed 和不得影响同日其他订单测试
- [x] T027 [P] [US3] 在 `apps/cms/tests/order-reconciliation.test.ts` 增加 increment/add/set 的事务计算、预览后变化、同一 operation key 重试幂等和不同 operation key 并发追加拒绝陈旧测试
- [x] T028 [US3] 在 `apps/kith-inn-be/src/domain/orders/reconciliation.ts` 与 `apps/cms/src/lib/orderLifecycle.ts` 完成 increment 单坐标差异和事务内 add/set 最终数量语义
- [x] T029 [US3] 在 `apps/kith-inn-be/src/agent/services.ts`、`apps/kith-inn-be/src/agent/services.test.ts`、`apps/kith-inn-be/src/agent/tools.ts`、`apps/kith-inn-be/src/agent/tools.test.ts`、`apps/kith-inn-be/src/routes/chat.ts` 与 `apps/kith-inn-be/src/routes/chat.test.ts` 中生成“当前 + 增加量 → 最终”或“当前 → 改成目标”的确认摘要并处理 stale-preview 重预览提示
- [x] T030 [US3] 在 `apps/kith-inn-fe/src/logic/orderConfirmView.ts`、`apps/kith-inn-fe/src/logic/orderConfirmView.test.ts` 与 `apps/kith-inn-fe/src/components/ChatCard.tsx` 中展示 add/set 运算，不把自然语言未提及订单渲染为取消项

**Checkpoint**: 完整快照和单笔增量共用一个原子写入口，但删除语义和确认文案严格分开。

---

## Phase 7：Polish & Cross-Cutting Concerns

**Purpose**: 同步长期产品/架构事实，在 PR 5 完成 #155 的全部门禁。

- [ ] T031 [P] 在 `docs/kith-inn/PRD.md` 与 `docs/kith-inn/USER-STORIES.md` 写明完整接龙覆盖范围内全部订单且不区分录入方式、自然语言 add/set 语义和确认卡运算展示
- [ ] T032 [P] 在 `docs/kith-inn/DATA-MODEL.md` 与 `docs/kith-inn/TECH-SPEC.md` 更新 reconcile 事务、陈旧 fingerprint、confirmed 更新/退出和不新增持久化 snapshot 的事实
- [ ] T033 运行 `specs/012-kith-inn-production-order-parsing/quickstart.md` 全部相关测试、`pnpm verify` 与真实 PostgreSQL 故障/并发场景，修复所有回归
- [ ] T034 检查 `git diff --check`、确认无 `kith-inn-v1` 文件变化、勾选 `specs/012-kith-inn-production-order-parsing/tasks.md`，在 PR 说明记录五个 PR 的验收映射并在 PR 5 关闭 #155

---

## Dependencies & Execution Order

- Phase 1 → Phase 2，shared 日期必填契约阻塞所有可执行确认卡。
- US1 → US4，先完成生产唯一解析入口，再用同一入口做真实四字段评测；两者构成 PR 1。
- PR 1 → US2，只有可信 snapshot scope 才允许实现批量退出订单。
- US2 → US3，共用 reconciliation diff、CMS endpoint、fingerprint 和差异卡；US3 只增加单坐标 add/set 语义。
- US2 → US3 核心 → US3 生产集成 → Polish，PR 5 完成长文档、全仓验证并关闭 #155。

## Parallel Opportunities

- T002 与后续 BE 测试准备可独立；同一 phase 内明确标 `[P]` 的 shared、BE、CMS 测试可并行编写。
- US4 的样本标注 T011 与准确率测试 T012 不改同一文件。
- US2 的 BE diff 测试 T017、CMS 集成测试 T018、shared 契约 T019 分属不同 package。
- US3 的 BE 纯函数测试 T026 与 CMS 集成测试 T027 分属不同 package。
- 文档 T031 与 T032 修改不同文件组。

## Implementation Strategy

### PR 1：可信解析最小切片

1. 完成 Setup、Foundational。
2. 完成 US1 的生产 rawText→唯一解析器→确认卡。
3. 完成 US4 的四字段真实 eval 并记录结果。
4. 运行 `pnpm verify`，提交独立 PR；不提前加入 CMS 对账。

### PR 2：快照对账核心（#168，已完成）

1. 从 PR 1 合并后的 main 建新分支，复用同一 `specs/012-*`。
2. 完成 US2 snapshot 全集差异、原子 reconcile 和既有生产确认链路。

### PR 3–5：增量核心、生产集成与验收

1. PR 3 只完成 T026–T028，复用 endpoint，不另建写路径。
2. PR 4 只完成 T029–T030，把已验证的核心接入 Agent、聊天确认和 FE。
3. PR 5 完成 T031–T034，更新长期文档、运行全门禁并关闭 #155。

## Format Validation

- 共 34 项任务，ID 连续为 T001–T034。
- US1 7 项、US4 6 项、US2 9 项、US3 5 项；其余为 setup/foundational/polish。
- 所有任务均含 checkbox、ID、必要的 `[P]`/`[USn]` 标签和精确文件路径。
