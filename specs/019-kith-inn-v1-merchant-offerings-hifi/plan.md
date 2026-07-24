# 实施计划：商家菜品库高保真重构

**分支**：`codex/kith-inn-v1-merchant-offerings-hifi` | **日期**：2026-07-24 | **规格**：[spec.md](./spec.md)

**输入**：`specs/019-kith-inn-v1-merchant-offerings-hifi/spec.md`

## 摘要

在不改变菜品 API、CMS 数据模型、认证和导入协议的前提下，基于仓库现有商家菜品 CRUD 页面，先补齐逐菜品请求协调、导入草稿版本约束和原位编辑，再按本规格定义的页面结构与视觉要求完成移动端重构和跨端验证。

## 技术上下文

**语言/版本**：TypeScript 5.9、React 18

**主要依赖**：Taro 4.2、`@tarojs/components`、现有 `createApiClient`

**存储**：沿用后端与 CMS；本功能不修改持久化模型

**测试**：Vitest 4（100% 覆盖率门禁）、Playwright 1.57、Taro H5/微信小程序构建

**目标平台**：移动端 H5、微信小程序

**项目类型**：pnpm + Turborepo 中的跨端前端应用

**性能目标**：逐菜品操作互不阻塞；列表状态更新无需整页重载；50 行导入仍可完成预览与提交

**约束**：不改 shared/be/cms 契约；不提交设计 Prompt；保持认证失败跳转；兼容 Page 1 已合并的底部导航；PR 以目标单一、可独立验证且适合 review 为首要边界，400 行是默认审查预算而非硬上限，超过 400 行须说明继续拆分为何会破坏独立审查，超过 800 行必须先获授权

**规模/范围**：单个商家菜品页面、3 个分类、浏览/管理/导入 3 组交互状态及相关单元/E2E 测试

## Brownfield 事实

- 页面入口为 `apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx`，已直接调用真实 list/create/update/import API。
- `apps/kith-inn-v1-fe/src/logic/offeringsImport.ts` 已提供分组、冲突选择和结果文案；其中 `partitionOfferings()` 会在启用/停用分组内按菜名排序。后端提交时按当前文本重新预览并按行号解释覆盖选择。
- 主线 Page 1 已更新 `MerchantNav` 视觉；Page 2 必须基于该版本追加样式。
- 本规格以仓库中的现有页面、API client、纯逻辑与测试为唯一可执行基线；外部工作树或本地原型只用于前期审计，不是后续 PR 的输入。PR3/PR4 必须分别依据本规格、UI 契约和前序已合并代码完成页面结构与视觉实现。
- 已知缺口：当前启停请求没有逐项 pending、同项重复提交保护或陈旧响应判定，飞行期间所有开关仍可操作；编辑会把菜品追加到末尾，且页面使用按菜名排序的 `partitionOfferings()` 渲染分组，改名后可见位置会跳动；预览响应可在原文变化后恢复陈旧状态；长文字和 disabled 预览按钮在窄屏下不可读。

## 宪法检查

- [x] 功能目录明确归属 `kith-inn-v1`，允许修改范围仅为 `specs/019-kith-inn-v1-merchant-offerings-hifi/**`、`apps/kith-inn-v1-fe/**`、对应的 `docs/kith-inn-v1/USER-STORIES.md`、`docs/kith-inn-v1/TECH-SPEC.md` 和明确列出的非 Prompt 设计资产。
- [x] 已记录现有 route、API、页面、测试和缺口，不重写工作中的后端架构。
- [x] 因预计至少 2 个 PR，使用全套 spec；各 PR 依赖有序且可独立验证。
- [x] 所有规格与计划文档主体使用中文。
- [x] 每片合并前执行相关自动化检查并通过 `pr-review-converge` 收口。
- [x] Phase 1 设计后复核：没有新增 API、模型、依赖或越界路径，全部 gate 仍通过。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 关联故事/需求 | 主要路径 | 明确非目标 | 独立验证 | 预计人工 diff | 依赖 |
|----|----------------------|---------------|----------|------------|----------|---------------|------|
| PR1 | 固化 Page 2 行为、竞态约束和可执行任务 | US1-US4、FR-001~015 | `specs/019-kith-inn-v1-merchant-offerings-hifi/**` | 不改运行时代码 | 规格 checklist、任务格式检查 | 约 500 行 | 无 |
| PR-Assets | 让 Page 2 高保真参考可由仓库独立读取和复核 | US4、FR-012~014 | `docs/kith-inn-v1/design/merchant-offerings-hifi-v0.2.png`、`docs/kith-inn-v1/design/kith-inn-v1-hifi-v1.html` | 不包含任何 `*-prompt.md`；不改产品代码 | 文件可读取、HTML 可打开、PNG 尺寸与内容人工核对 | HTML 约 360 行；PNG 为二进制资产 | PR1 |
| PR2 | 保证旧响应不能覆盖新意图且编辑保持原位 | US1-US3、FR-003/004/006/008~010/015 | `apps/kith-inn-v1-fe/src/logic/offeringsView*`、`apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx`、`docs/kith-inn-v1/TECH-SPEC.md`、`docs/kith-inn-v1/USER-STORIES.md` | 不做高保真视觉调整 | lint、typecheck、coverage、定向 E2E、长期文档一致性核对 | 约 400 行 | PR1 |
| PR3 | 在正确行为之上收敛 Page 2 页面结构和真实管理流程 | US1/US2/US4、FR-001/002/005/012~015 | `apps/kith-inn-v1-fe/src/pages/merchant/offerings/index.tsx`、`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts`、`apps/kith-inn-v1-fe/tests/e2e/jielong-import.spec.ts`、`docs/kith-inn-v1/TECH-SPEC.md`、`docs/kith-inn-v1/USER-STORIES.md` | 不做最终视觉换肤；不改 API/CMS | 定向 E2E、lint、typecheck、双端 build、长期文档一致性核对 | 约 520 行 | PR2 |
| PR4 | 完成 Page 2 高保真样式与窄屏可读性验收 | US4、FR-001/002/012~015 | `apps/kith-inn-v1-fe/src/app.css`、`specs/019-kith-inn-v1-merchant-offerings-hifi/quickstart.md` | 不再改变业务流程；不提交 Prompt | 354×786 对已入库 PNG/HTML 的视觉验收、`pnpm verify`、定向 E2E | 约 460 行 | PR3、PR-Assets |

PR1 超过默认 400 行是因为宪法要求 ≥2 PR 的功能必须提交同一套完整且相互引用的 spec/plan/tasks/design artifacts；继续拆开会使中间 PR 的 Spec Kit 前置检查不可执行。预计仍低于 800 行。

初始实现审计后，原本合并在 PR3 的 JSX、CSS 与 E2E 人工 diff 超过 800 行，因此按可独立构建的边界再拆为 PR3（结构/流程）与 PR4（样式/视觉验收），无需申请超大 PR 例外。

PR3 预计略高于 400 行，但只有一个核心不变量：重排页面结构后，浏览、管理、编辑和导入真实流程仍可从同一入口完整使用。页面 JSX 与验证这些入口的 E2E 必须在同一片出现，拆走测试会使页面改造无法独立验收，按模式拆 JSX 又会产生一版功能入口不完整的中间页面；对应长期产品文档也必须按宪法与行为改动同片更新。该片仍低于 800 行，审查范围只涉及一个页面、两份定向 E2E 和两份对应文档的小幅同步。

PR4 预计略高于 400 行，但只有一个核心不变量：Page 2 在目标窄屏下形成完整一致、可读且不遮挡的视觉层。共享 token、卡片、弹层、固定按钮、底部导航和安全区选择器集中在同一 `app.css` 并共同决定最终布局；再按选择器拆分会留下无法独立视觉验收的混合样式。除该 CSS 和验收记录外不改变业务行为，该片仍低于 800 行。

参考 PNG/HTML 设计资产不与功能代码混合：PR-Assets 必须提交 `merchant-offerings-hifi-v0.2.png` 与共享设计源 `kith-inn-v1-hifi-v1.html`，明确排除所有 `*-prompt.md`，并在 PR4 开始前合并。这样 PR4 可只从仓库读取视觉基线并独立验收。

依赖关系分成两条链：`PR1 → PR2 → PR3 → PR4` 固化行为与运行时代码，`PR1 → PR-Assets → PR4` 提供视觉基线；PR2/PR3 不依赖设计资产，PR4 必须同时等待 PR3 与 PR-Assets。

## 项目结构

### 功能文档

```text
specs/019-kith-inn-v1-merchant-offerings-hifi/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── merchant-offerings-ui.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### 源码

```text
apps/kith-inn-v1-fe/
├── src/
│   ├── app.css
│   ├── logic/
│   │   ├── offeringsView.ts
│   │   └── offeringsView.test.ts
│   └── pages/merchant/offerings/index.tsx
└── tests/e2e/
    ├── merchant.spec.ts
    └── jielong-import.spec.ts
```

### 长期文档与设计基线

```text
docs/kith-inn-v1/
├── USER-STORIES.md
├── TECH-SPEC.md
└── design/
    ├── merchant-offerings-hifi-v0.2.png
    └── kith-inn-v1-hifi-v1.html
```

**结构决策**：仅扩展现有前端页面和纯逻辑模块；请求协调与列表合并规则放在可单测的 `offeringsView.ts`，页面保留 I/O 和视图编排，CSS 继续集中在现有 `app.css`。

## 复杂度跟踪

无宪法例外；不新增依赖、数据模型、API 或并行状态系统。
