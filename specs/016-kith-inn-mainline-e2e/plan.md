# Implementation Plan: kith-inn 主链路真实 E2E 与 CMS 集成验证

**Branch**: `016-kith-inn-mainline-e2e` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-kith-inn-mainline-e2e/spec.md`

## Summary

在 #185 已建立的非 v1 H5 Playwright 基座上，增加一条使用真实 PostgreSQL、CMS internal routes 与生产 BE 业务路径的可重复主链路。测试在外部 LLM HTTP 边界使用固定响应，但继续经过生产 parser、确认卡、CMS 原子端点和租户校验。交付分成 CMS/PostgreSQL 租户证据、H5 订单 happy path、订单失败与幂等、菜单/收款/送达收尾四个实现 PR；既有 SQLite 自适应换菜回归保留为快速场景。

## Technical Context

**Language/Version**: TypeScript（Node.js 22 CI；前端 React 18 / Taro 4.2.0；CMS React 19 / Next.js 16.2.9）

**Primary Dependencies**: Playwright 1.57、Hono 4、Payload 3.85.1、`@payloadcms/db-postgres` 3.85.1、Zod 4、Vitest 4（FE 既有 Vitest 1.6）

**Storage**: PostgreSQL 17（主链路与 CMS 集成证据）；SQLite 仅保留 #185 已有快速回归，不作为 #157 的真实数据证据

**Testing**: Playwright H5 E2E、Vitest CMS/PostgreSQL 集成测试、现有 100% 单元覆盖门禁、`pnpm verify`

**Target Platform**: GitHub hosted Ubuntu + Node.js 22；本地 macOS/Linux 通过仓库 Docker Compose 提供相同 PostgreSQL 17

**Project Type**: pnpm/Turborepo monorepo，跨 Taro H5、Hono BE、Next/Payload CMS 与共享 Payload package

**Performance Goals**: 新增 PostgreSQL 主链路 suite 在 CI 浏览器与依赖已安装后 90 秒内完成；单次失败在产物中可定位到具体场景与步骤

**Constraints**: 只改非 v1；不依赖真实微信、真实 LLM、微信群或支付；不新增业务 schema/状态机；CMS-backed E2E 串行；每个实现 PR 人工编写 diff 目标低于 400 行

**Scale/Scope**: 4 组用户旅程、至少 2 个 seller/operator、1 条连续 happy path、4 类失败/重试边界、1 组真实租户隔离矩阵

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Spec 档位**：本功能跨 FE/BE/CMS/PostgreSQL/CI、含租户隔离且预计多 PR，必须使用全套 spec；本目录包含 spec、plan、research、data-model、contracts、quickstart、tasks 与 checklist。
- **项目边界**：所有业务改动仅在旧 `@cfp/kith-inn-*` 与共享 `apps/cms` 的旧路由范围；通过精确路径和 v1 sentinel 防止影响 `kith-inn-v1`。
- **真实后端**：至少一组测试使用真实 CMS internal route + PostgreSQL，不以 mock fetch 冒充集成证据；外部 LLM 固定服务仅替代第三方不确定性。
- **测试与覆盖**：新增 helper/分支需要 Vitest 覆盖；H5 行为由 headless Playwright 覆盖；每个实现 PR运行窄测试和 `pnpm verify`。
- **文档与命名**：规格、任务、PR 说明与 review 回复使用中文，代码标识与上游协议保留英文。
- **PR 可审查性**：规格与四个实现目标独立切片；不得把真实基座、订单失败路径、租户矩阵和菜单收尾一次塞进同一实现 PR。
- **外发与审查**：每个 PR ready 后等待 Codex review，逐条回复并 resolve actionable thread，再请求最新 head 复审；只用 rebase merge。

**Phase 1 后复核**：设计不新增持久化实体或生产 API；测试 fixture 复用既有模型与安全 seed reset；全部 gate 继续满足，无需 Complexity Tracking 例外。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 主要路径 | 独立验证 | 依赖 |
|----|----------------------|----------|----------|------|
| PR1 | 冻结 #157 的真实链路、失败边界、租户证据与可执行切片 | `specs/016-kith-inn-mainline-e2e/**` | requirements checklist、speckit analyze、`git diff --check` | #185 已合并 |
| PR2 | 用真实 PostgreSQL 与两个 seller 证明旧 kith-inn CMS internal routes 的读写/relationship 租户隔离，且 reset 不碰 v1 sentinel | `apps/cms/tests/**`、必要 `apps/cms/src/**` 测试 seam、`packages/kith-inn-payload/src/seed/**`（仅在 fixture 缺口存在时） | 指定 CMS PG 集成测试、v1 sentinel、`pnpm verify` | PR1 |
| PR3 | 独立 PostgreSQL Playwright 编排贯通 H5 登录→接龙预览→草稿→确认订单 happy path，外部模型固定但生产 parser/CMS 不替换 | `apps/kith-inn-fe/{playwright.mainline.config.ts,package.json,tests/e2e/**}`、必要 `.github/workflows/ci.yml` | mainline E2E happy path、重复运行、`pnpm verify` | PR2 |
| PR4 | 缺日期失败、无地址成功、重复提交与确认重试均符合既有安全语义 | `apps/kith-inn-fe/tests/e2e/**`、必要测试 fixture/helper | 四类边界 E2E、数据库零变化/唯一性断言、`pnpm verify` | PR3 |
| PR5 | 在同一连续 H5 journey 中完成菜单生成/自适应换菜/发布→标已付→批量送达，并收口 CI filter、trace/report/service log 证据 | `apps/kith-inn-fe/tests/e2e/**`、`.github/workflows/ci.yml`、`specs/016-kith-inn-mainline-e2e/{tasks,quickstart}.md` | 完整 journey 连跑 3 次、affected dry-run、CI 产物、`pnpm verify` | PR4 |

PR1 为宪法要求的全套纯文档规格，目标控制在 650–800 行且不含源码；spec、plan、research、model、contracts 与 tasks 必须原子 review 并通过同一次 analyze gate，拆开会留下不可验收占位或跨产物失配。PR2–PR5 各自控制人工编写 diff 在 400 行内；若 PR3 的固定 LLM 服务与 PostgreSQL 编排逼近预算，优先把通用 fixture 放入 PR2，而不是提前并入订单边界。

## Project Structure

### Documentation (this feature)

```text
specs/016-kith-inn-mainline-e2e/
├── checklists/
│   └── requirements.md
├── contracts/
│   └── e2e-scenarios.md
├── data-model.md
├── plan.md
├── quickstart.md
├── research.md
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/cms/
├── seed/
├── src/app/api/internal/        # 真实旧 kith-inn internal routes
└── tests/                       # PostgreSQL/租户/seed sentinel 证据

apps/kith-inn-be/src/
├── domain/orders/               # 生产 parser、对账与原子订单语义
├── lib/cms/                     # 真实 CMS HTTP client
├── lib/llm/                     # 外部 HTTP 边界，不新增平行 parser
└── routes/                      # auth/chat/orders/menu/delivery

apps/kith-inn-fe/
├── playwright.config.ts         # #185 SQLite 快速自适应换菜回归
├── playwright.mainline.config.ts# 新增 PostgreSQL 主链路编排
├── src/pages/                   # today/menu/orders/kitchen 真实 H5 操作面
└── tests/e2e/
    ├── fixtures/                # 固定外部模型响应、API/DB 只读断言 helper
    ├── menu-swap.spec.ts        # #185 既有快速场景
    └── mainline.spec.ts         # 连续主链路与边界场景

.github/workflows/ci.yml         # affected 选择、串行 CMS E2E、失败产物
```

**Structure Decision**: 保留 #185 的快速 SQLite 场景，新增独立 PostgreSQL Playwright config，由 package 的 `test:e2e` 串行执行两个 config；这样 #157 的真实证据不会被 SQLite 降级，同时不移除已合并回归。生产代码只在真实链路暴露缺陷时做最小修正，测试 fixture 不进入业务 package。

## Complexity Tracking

无宪法违例。
