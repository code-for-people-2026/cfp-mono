# 实施计划：CMS 项目级 Seed 隔离

**Branch**: `codex/014-cms-seed-isolation` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

## Summary

把共享 CMS 的 seed runner 从“固定依次操作两个项目”改成“必须选择一个项目后只调用该项目 seed/reset”；为 kiv1 补齐与 kith-inn 对称的 reset primitive，并用双向哨兵测试锁定零跨项目访问。

## Brownfield 事实

- `apps/cms/seed/run.ts` 的 `applyAllSeeds` 与 `resetAllSeedData` 当前每次都操作 kith-inn 和 kiv1。
- kith-inn package 已同时拥有 `applySeed`、`resetSeedData` 与外键安全的 collection 顺序。
- kiv1 package 只有 `applySeed` 和 `RESET_COLLECTIONS`，删除循环仍写在 CMS runner。
- `apps/cms/package.json` 只暴露含糊的 `seed` / `seed:reset:dev`。
- `apps/cms/tests/seed-run.test.ts` 当前验证跨项目编排，恰好固化了需要删除的行为；安全守卫测试应保留。

## Technical Context

**Language/Version**: TypeScript 5.9，Node.js 24

**Primary Dependencies**: Payload 3、tsx、Vitest 4

**Storage**: 共享 PostgreSQL；测试使用记录 collection 访问的内存 Payload fake

**Testing**: package seed 单测、CMS 双向哨兵隔离测试、`pnpm verify`

**Project Type**: monorepo 内部 CLI / seed library

**Constraints**: 不改 schema/API；不新增跨项目入口；保留现有 reset 安全守卫；单 PR，默认 review 预算 400 行

## Constitution Check

- **I 功能规格**: 通过；使用轻量 `spec.md / plan.md / tasks.md`。
- **II Monorepo 作用域**: 允许触碰 `apps/cms`、两个 payload package 的 seed、相关开发文档与本 spec。
- **III Brownfield**: 通过；复用既有 fixture、reset 顺序和安全守卫，只删除跨项目编排。
- **IV 单一切片**: 通过；一个 PR 只维护“选择一个项目就零访问另一个项目”的对称不变量。
- **V 验证审查**: 双向 seed/reset 哨兵测试 + package 单测 + `pnpm verify`；按 Codex review 流程清理后 rebase merge。
- **VI 中文文档**: 通过。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 主要路径 | 独立验证 | 依赖 |
|----|----------------------|----------|----------|------|
| PR1 | 任一项目 seed/reset 对另一项目零读写删，且只暴露项目级命令 | `apps/cms/seed/`、`apps/cms/tests/seed-run.test.ts`、`apps/kith-inn-v1-fe/playwright.config.ts`、两个 payload package 的 `src/seed/`、`apps/cms/package.json`、CMS README 与相关 specs 命令文档 | 双向哨兵测试、package seed 单测、v1 H5 E2E、`pnpm verify` | #156 已完成 |

该对称安全边界不能拆成两个先后 PR：只修一个方向时，含糊入口和另一个破坏方向仍然存在，无法独立满足“无跨项目命令”的核心不变量。预计 diff 若略超 400 行，主要来自 issue 强制要求的轻量 spec 与四场景哨兵测试，不包含业务功能或无关重构。

## Project Structure

### Documentation

```text
specs/014-cms-seed-isolation/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code

```text
apps/cms/
├── seed/run.ts
├── tests/seed-run.test.ts
├── package.json
└── README.md

apps/kith-inn-v1-fe/
└── playwright.config.ts

packages/kith-inn-payload/src/seed/
└── taozi.ts

packages/kith-inn-v1-payload/src/seed/
├── taozi.ts
└── taozi.test.ts
```

**Structure Decision**: 保留一个 runner，但要求显式项目参数并只 dispatch 一个 package；reset 细节由各自 package 拥有。这样不复制 Payload 启停和安全守卫，也不存在“all”行为。
