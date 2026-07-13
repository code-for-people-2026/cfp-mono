# 实施计划：kith-inn 自适应换菜

**Branch**: `codex/015-kith-inn-adaptive-swap` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

## Summary

把 kith-inn 自动换菜从“硬过滤避重、筛空即失败”改为“保留全部有效同类候选，按四级冲突计数字典序择优，必要时显式返回放宽规则”。领域内核先形成可注入随机源、能精确标识目标位置的纯函数；服务层让 menu route 与 chat preview/confirm 使用同一目标日期历史语义；H5 再通过共享 runtime schema 显示解释；最后用最小 Playwright 场景锁定小池仍可换和提示可见。

## Technical Context

**Language/Version**: TypeScript 5.9，Node.js 22/24，React 18，Taro 4.2

**Primary Dependencies**: Hono、Zod、Payload 3、Vitest、仓库既有 Playwright（不新增库或版本）

**Storage**: 既有 PostgreSQL/Payload `menu_plans` 与 `offerings`；不改 schema，不持久化放宽解释

**Testing**: shared/BE/FE Vitest，H5 Playwright，`pnpm verify`

**Target Platform**: kith-inn H5/微信小程序共用业务逻辑；本功能 E2E 运行 H5

**Project Type**: pnpm + Turborepo monorepo，shared contract + BE + Taro FE

**Performance Goals**: 单次换菜只遍历目标 seller 的同类菜品与至多目标相关日期范围内菜单；不增加网络往返以外的外部调用

**Constraints**: 固定四级优先级；仅候选为空失败；不改指定换菜/published 保护；不修改 v1/CMS schema/生成算法；每个实现 PR 默认不超过 400 行人工 diff

**Scale/Scope**: 单 seller 的日常菜品池与最多 14 个自然日餐次；menu route/chat 两个换菜前门、一个菜单页提示、一个确认卡提示、一个 H5 E2E 场景

## Brownfield Facts

- `apps/kith-inn-be/src/domain/menu/core.ts` 当前对本餐剩余主料做硬过滤，`SwapResult` 只返回 replacement 或错误，且使用不可注入的全局随机源。
- `POST /menu/plans/:id/swap` 当前只读取目标 plan 和启用 component 菜品池，没有调用已有 `listMenuPlans` 获取历史。
- `packages/kith-inn-shared` 只有 swap request schema；FE helper 的成功响应只有 `{plan, warning?}`，菜单页换菜后丢弃响应并重载。
- `apps/kith-inn-be/src/agent/services.ts` 的 `swapDish` / `previewSwap` 直接调用 core 且不读历史；确认卡 preview 是自动换菜的另一个产品前门。
- `menu_plans.offerings` 是无唯一约束的 `hasMany`；route 与 agent 当前用 `map` 替换所有同 ID 项，重复 offering 时会改多个位置。
- kith-inn FE 尚无 Playwright 配置；仓库和 kiv1 已有 Playwright 版本、CMS→BE→H5 webServer 模式与 PR E2E CI。
- 既有指定换菜 warning、published force/清 publishText 和 seller-scoped CMS 客户端已有回归测试，可直接作为不回归门禁。

## Constitution Check

- **I 功能规格**: 通过；跨 shared/BE/FE、变更响应契约且拆为多个 PR，采用全套 spec。
- **II Monorepo 作用域**: 通过；只触碰 kith-inn、共享契约、对应文档与 CI E2E 接线，不修改 v1 业务代码。
- **III Brownfield**: 通过；复用 v1 已验证的评分语义、现有 `listMenuPlans`、租户 JWT 和 H5 dev-login/seed，不另造推荐层。
- **IV 单一切片**: 通过；规划、纯领域、双前门服务集成、UI、E2E 五个 PR 各有一个可独立审查的不变量。
- **V 验证审查**: 每片独立测试并运行 `pnpm verify`；PR 经 Codex review 清空评论后 rebase merge，再开始下一片。
- **VI 中文文档**: 通过。

Phase 1 设计复查后仍无宪法违例；无需 Complexity Tracking 例外。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 主要路径 | 独立验证 | 依赖 |
|----|----------------------|----------|----------|------|
| PR1 | 冻结 #163 的行为契约、边界和可执行切片 | `specs/015-kith-inn-adaptive-swap/**` | 规格清单、artifact 交叉检查、`git diff --check` | #164 已完成 |
| PR2 | 纯领域内核对所有有效候选做固定四级择优，结果可解释、随机可控且目标位置精确 | `packages/kith-inn-shared/src/{schemas,types}*`、`apps/kith-inn-be/src/domain/menu/core*` | shared rule 测试、BE core 四类边界/优先级/稳定性/重复位置测试、`pnpm verify` | PR1 |
| PR3 | menu route 与 chat agent 两个自动换菜前门使用同一历史、放宽规则和单位置写回语义 | `packages/kith-inn-shared/src/**`、`apps/kith-inn-be/src/{routes/menu,agent/services,agent/tools}*` | route/agent 历史范围、当前 plan 排除、preview/confirm 一致、单位置 patch、指定/published 回归、`pnpm verify` | PR2 |
| PR4 | H5 在运行时验证响应并无损显示放宽解释 | `apps/kith-inn-fe/src/{logic,pages}/**`、`docs/kith-inn/**` | FE success/unknown-rule/中文顺序/dishIndex 测试、页面交互检查、`pnpm verify` | PR3 |
| PR5 | 非 v1 H5 自动化真实覆盖“小池仍换 + 放宽提示” | `apps/kith-inn-fe/{playwright.config.ts,tests/e2e/**,package.json}`、必要 `.github/workflows/ci.yml`/lockfile | `CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e`、`pnpm verify` | PR4 |

PR1 的全套规格文档预计略超 400 行，因为宪法要求 spec/plan/research/data-model/contracts/quickstart/tasks 同时可审查；它不包含源码，预计低于 800 行。PR2–PR5 各自控制在 400 行内；chat 服务集成与 H5 UI 分片以避免 PR3 超预算。若 E2E 接线实际超预算，优先复用既有 webServer/CI 模式，不并入 #157 的 PostgreSQL/跨租户场景。

## Project Structure

### Documentation

```text
specs/015-kith-inn-adaptive-swap/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/swap-api.md
└── tasks.md
```

### Source Code

```text
packages/kith-inn-shared/src/
├── schemas.ts
├── schemas.test.ts
└── types.ts

apps/kith-inn-be/src/
├── domain/menu/core.ts
├── domain/menu/core.test.ts
├── routes/menu.ts
├── routes/menu.test.ts
├── agent/services.ts
├── agent/services.test.ts
├── agent/tools.ts
└── agent/run.test.ts

apps/kith-inn-fe/
├── src/logic/menuEdit.ts
├── src/logic/menuEdit.test.ts
├── src/pages/menu/index.tsx
├── tests/e2e/menu-swap.spec.ts
├── playwright.config.ts
└── package.json
```

**Structure Decision**: 评分、日期边界和单位置选择留在既有纯领域内核；menu route 与 agent service 各自负责 seller-scoped CMS 读取、plan 身份排除和写回，但共享同一内核契约；chat preview 把选定 replacement 固化进确认操作，避免确认时重随机；FE 用共享 schema 做 runtime parse，纯 helper 负责规则→中文，页面只持有本次瞬时提示；E2E 复用仓库现有 CMS/BE/H5 进程编排。

## Complexity Tracking

无宪法违例，无需例外。
