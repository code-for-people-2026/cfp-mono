# 实施计划：商家本周菜单高保真工作区

**分支**：`codex/kith-inn-v1-menu-plan` | **日期**：2026-07-25 | **规格**：[spec.md](./spec.md)

**输入**：`specs/020-kith-inn-v1-merchant-menu-hifi/spec.md`

## 摘要

在不新增菜单 API、数据模型或改变生成算法的前提下，把现有“日期输入 + 技术按钮 + 31 天列表”改造成自动工作周视图。先在业务路由补充快速预检查，并把 `open` / `closed` 菜单只读保护下沉到 CMS/Payload 原子写入边界，再以纯逻辑建立上海业务日期、五日摘要、可编辑状态、缺失目标和动态 CTA，依次接入周界面、生成与覆盖、换菜和预订配置衔接，最后完成高保真样式和跨端验收。

## 技术上下文

**语言/版本**：TypeScript 5.9、React 18

**主要依赖**：Taro 4.2、`@tarojs/components`、现有 `createApiClient`

**存储**：沿用现有 backend/CMS；不修改实体、字段或迁移

**测试**：Vitest 4（100% 覆盖率门禁）、Playwright 1.57、Taro H5/微信小程序构建

**目标平台**：移动端 H5、微信小程序

**项目类型**：pnpm + Turborepo 中的跨端前端应用与既有 Hono 业务服务

**性能目标**：进入页面自动加载 5 个工作日；日期切换不发请求；快速切周只接受最新响应；单餐 mutation 不锁定其他餐次

**约束**：复用现有范围查询、生成、换菜和预订配置 API，仅增强现有 mutation 的状态保护；上海时区无 UTC 偏日；不提交 Prompt；Page 1/Page 2 导航和视觉 token 继续有效

**规模/范围**：1 个菜单页面、1 个预订配置页面的最小 query 预填、5 个工作日、10 个餐次位置和对应纯逻辑/E2E

## Brownfield 事实

- `pages/merchant/menu/index.tsx` 当前要求手输日期，查询 31 天并纵向展示所有真实餐次；单餐生成、工作周生成、覆盖确认、换菜、认证失败和接龙兜底已接通。
- `logic/menu.ts` 已提供合法日期、单餐/工作周目标、分类缺口文案、放宽规则文案和按日期合并餐次；缺少默认周、五日摘要、只补缺失、可编辑状态和 CTA 映射。
- `services/api.ts` 已严格解析 5 道菜快照、价格、截止时间和 `draft/open/closed`，现有接口足以完成本功能；但后端生成和换菜路由尚未拒绝 `open` / `closed` 写入，CMS 的菜单 PATCH 也在读取所有权后无条件更新，必须同时补业务预检查和带最新状态条件的原子持久化保护。
- `pages/merchant/batches/index.tsx` 已支持价格、截止时间、开放/关闭餐次及分享批次，但仍要求手输日期，尚不读取菜单页上下文。
- `tests/e2e/merchant.spec.ts` 已覆盖真实单餐/整周生成、覆盖和换菜；需要改造成自动工作周交互并补切周竞态、补齐、只读和预填流程。
- `MerchantNav` 已固定为“今日 / 菜品 / 菜单 / 订单”；Page 3 不复制概念图中的旧导航。
- 高保真 Prompt 和独立 PNG 当前来自用户指定的 `d097` 工作树。Prompt 永不提交；PNG 源文件为 `/Users/yao/.codex/worktrees/d097/cfp-mono/docs/kith-inn-v1/design/merchant-menu-hifi-v0.2.png`，大小 155701 bytes、708×1572 RGB、SHA-256 `0ac15d72a2a0818499a2c427b841d9ac6378baea9a9a22b79efe446cb8ce6259`。PR-Assets 必须逐项核对后入库，才能作为最终视觉 PR 的可复现基线。

## 宪法检查

- [x] 功能目录归属 `kith-inn-v1`；源码允许 `apps/kith-inn-v1-fe/**`、`apps/kith-inn-v1-be/src/routes/mealSlots*`、`apps/cms/src/app/api/internal/kiv1/meal-slots/**`、`apps/cms/src/lib/kiv1-meal-slot-menu-guard.ts`、`apps/cms/payload.config.ts` 及对应测试；`packages/kith-inn-v1-payload` 保持 adapter-neutral，不导入 CMS app-local 模块。长期文档仅允许 `docs/kith-inn-v1/{USER-STORIES,TECH-SPEC}.md`，设计资产仅允许明确列出的非 Prompt PNG。
- [x] 已记录现有页面、逻辑、API、CMS/Payload 写入边界、配置入口、测试和缺口；不重写生成算法，仅补只读不变量和页面衔接。
- [x] 含多种异步状态且预计多个 PR，使用全套 spec；每片单一目标并独立验证。
- [x] 文档主体使用中文，测试先行，合并前使用 `pr-review-converge`。
- [x] Phase 1 复核：未新增 API、实体、依赖或平行状态系统，全部 gate 通过。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 关联故事/需求 | 主要路径 | 明确非目标 | 独立验证 | 预计人工 diff | 依赖 |
|----|----------------------|---------------|----------|------------|----------|---------------|------|
| PR1 | 固化 Page 3 产品边界、视图状态和可执行切片 | US1-US4、FR-001~038 | `specs/020-kith-inn-v1-merchant-menu-hifi/**` | 不改运行时代码 | checklist、Spec Kit 前置检查、任务格式 | 约 740 行 | 无 |
| PR-Assets | 让独立 Page 3 参考图可由仓库读取 | SC-005 | `docs/kith-inn-v1/design/merchant-menu-hifi-v0.2.png` | 不提交任何 `*-prompt.md`；不改代码 | PNG 可读、尺寸和内容核对 | 二进制资产 | PR1 |
| PR-Guard-Store | CMS 配置的 Payload 公共写入边界串行化菜单与预订状态写入，并只在锁内最新状态仍为草稿时提交 | US2/US3、FR-014 | `apps/cms/payload.config.ts`、`src/lib/kiv1-meal-slot-menu-guard.ts`、`tests/kiv1-meal-slot-menu-guard.test.ts`、长期架构/产品文档 | 不改 CMS internal route、backend 映射、Payload 包、公开 API 或 UI | Postgres 交错事务、SQLite 即时事务、admin/REST/local 边界测试 | 约 360 行 | PR1 |
| PR-Guard-Service | 服务层预检查并稳定透传持久化层的菜单锁定冲突 | US2/US3、FR-014 | backend 路由及测试、CMS meal-slot route 与集成测试、服务错误语义文档 | 不改变 collection 策略、公开 API 形状、生成算法或 UI | backend/CMS 锁定冲突与过期草稿测试、coverage、lint、typecheck | 约 260 行 | PR-Guard-Store |
| PR2 | 工作周及操作目标在任意时区下确定且可测试 | US1/US2、FR-001~008/013~025/035~036 | `src/logic/menuWeek.ts`、`menuWeek.test.ts`、必要的 `menu.ts*` | 不改页面 JSX/CSS | coverage、lint、typecheck | 约 380 行 | PR-Guard-Service |
| PR3 | 页面自动加载并只展示所选日午晚餐的真实只读状态 | US1、FR-001~014/029~033 | `pages/merchant/menu/index.tsx`、`tests/e2e/merchant.spec.ts`、长期文档 | 不接新 mutation；不做最终换肤 | 先写周视图 E2E；lint/typecheck/coverage/build | 约 520 行 | PR2 |
| PR4 | 生成、补齐和覆盖只作用于匹配当前操作上下文的可编辑目标 | US2、FR-015~021/024~026/031/037~038 | `pages/merchant/menu/index.tsx`、`tests/e2e/merchant.spec.ts`、必要逻辑测试 | 不做换菜/配置衔接/最终样式 | 每目标 revision、部分成功提示与重载、跨周延迟响应 E2E，coverage、双端 build | 约 580 行 | PR3 |
| PR5-Swap | 换菜只更新目标草稿且旧响应不能污染新工作周 | US3、FR-022~024/030~031/037 | 菜单页、换菜逻辑与 merchant E2E、长期文档 | 不做预订配置衔接或最终换肤 | 局部替换、无候选、只读与跨周延迟响应 E2E | 约 360 行 | PR4 |
| PR5-Booking | 菜单与预订配置往返保持工作周和餐次上下文 | US4、FR-025~030/031 | 菜单页、`pages/merchant/batches/index.tsx`、booking 纯逻辑/E2E、长期文档 | 不改服务端契约；不做换菜或最终换肤 | query 解析、预填、自动加载与返回刷新 E2E | 约 340 行 | PR5-Swap |
| PR6 | Page 3 在目标窄屏形成完整高保真视觉层 | SC-005/009、FR-006/010~014/025/031~033 | `src/app.css`、本功能 `quickstart.md` | 不再改变业务规则；不提交 Prompt | 354×786 视觉验收、定向 E2E、`pnpm verify` | 约 520 行 | PR5-Booking、PR-Assets |

PR1 超过默认 400 行是因为全套 spec 的规格、研究、模型、契约、验收和任务必须相互引用并同时通过 Spec Kit 前置检查；拆开会留下不可执行的规划中间态，预计低于 800 行。额外风险是跨文件术语或需求映射不一致、以及较长 diff 导致 review 遗漏；对应缓解为 requirements checklist、FR/SC 到 Task/PR 的逐项映射、`speckit-analyze` 跨产物一致性检查、`git diff --check`，以及 Codex review 每轮新增意见清零后再收口。

原先约 520 行的 PR-Guard 已按持久化边界与服务集成拆为 PR-Guard-Store、PR-Guard-Service，各自可独立验证且目标单一。PR3、PR4 与 PR6 略高于默认预算，但分别只有只读周视图、生成目标一致性和视觉层一个核心不变量；测试与对应实现必须同片才能独立验收，均低于 800 行。换菜与预订衔接已因可独立验收而拆为两个 PR。

依赖链为 `PR1 → PR-Guard-Store → PR-Guard-Service → PR2 → PR3 → PR4 → PR5-Swap → PR5-Booking → PR6`；资产链为 `PR1 → PR-Assets → PR6`。同一时间只推进一个运行时代码 PR。

## 项目结构

### 功能文档

```text
specs/020-kith-inn-v1-merchant-menu-hifi/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/merchant-menu-ui.md
├── checklists/requirements.md
└── tasks.md
```

### 源码与验证

```text
apps/kith-inn-v1-fe/
├── src/
│   ├── app.css
│   ├── logic/menu.ts
│   ├── logic/menuWeek.ts
│   ├── logic/menuWeek.test.ts
│   └── pages/merchant/
│       ├── menu/index.tsx
│       └── batches/index.tsx
└── tests/e2e/merchant.spec.ts

apps/kith-inn-v1-be/src/routes/
├── mealSlots.ts
└── mealSlots.test.ts

apps/cms/
├── payload.config.ts（在 CMS 配置层组合 collection hook）
├── src/app/api/internal/kiv1/meal-slots/[id]/route.ts
├── src/lib/kiv1-meal-slot-menu-guard.ts（adapter-aware 事务与行锁保护）
├── tests/kiv1-meal-slot-menu-guard.test.ts
└── tests/kiv1-meal-slots.test.ts

packages/kith-inn-v1-payload/src/payload/collections/
└── MealSlots.ts（保持 adapter-neutral，由 CMS 配置层追加保护）

docs/kith-inn-v1/
├── USER-STORIES.md
├── TECH-SPEC.md
└── design/merchant-menu-hifi-v0.2.png
```

**结构决策**：新增 `menuWeek.ts` 承载不依赖 UI 的工作周视图模型；保留 `menu.ts` 的既有生成响应逻辑。页面只负责任务编排和渲染；API 形状不变，后端路由负责快速预检查。`@cfp/kith-inn-v1-payload` 不能导入依赖 `@payload-config`、Next.js 和 Postgres adapter 的 app-local helper，因此由 `apps/cms/payload.config.ts` 在组合 `MealSlots` 时追加 `kiv1-meal-slot-menu-guard.ts` hook；该 hook 在当前 Payload 请求事务中持有 Postgres 行锁至提交，SQLite 复用即时写事务，并在锁内重读最新状态，锁不可用时 fail closed。

## 复杂度跟踪

无宪法例外；不新增依赖、数据模型、API 或第二套菜单状态机。
