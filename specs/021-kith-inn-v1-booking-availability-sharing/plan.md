# Implementation Plan: Kith Inn v1 营业预订与分享定位

**Branch**: `codex/kith-inn-v1-booking-availability-contract` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

## Summary

以餐次实时状态作为顾客可见性事实源，新增独立营业关闭记录表达整天/某餐打烊；商家默认价只作开放前模板，开放时固化逐餐价格；现有 BookingBatch 在兼容期继续提供公开随机标识，但新增的日期/餐次目标只负责分享定位。Page 4 保留同一路由，以配置、批量操作、分享成功和历史详情状态重构。

## Technical Context

**Language/Version**: TypeScript 5.9

**Primary Dependencies**: React 18、Taro 4、Hono、Payload CMS 3、Zod 4

**Storage**: PostgreSQL + Payload collection

**Testing**: Vitest、现有 Hono route tests、Playwright E2E、`pnpm verify`

**Target Platform**: 微信小程序商家端；H5 仅作自动化验证

**Project Type**: pnpm + Turborepo monorepo

**Performance Goals**: 工作周状态在一次页面加载内完成；批量操作最多 20 个餐次并逐项反馈

**Constraints**: seller 租户隔离；现有公开 `batch` 路径保持可用；本功能不重构顾客 UI

**Scale/Scope**: shared、Payload schema、CMS internal routes、v1 BE、v1 FE Page 4、E2E 和长期文档

## Constitution Check

- 全套 spec：跨 shared/CMS/BE/FE、数据模型、API、状态机且预计多个 PR，符合宪法 I。
- 允许路径和 brownfield 事实已在本计划与 research 中列出，符合 II/III。
- 下表按契约→持久化→服务→交互→视觉切片；每片独立验证，符合 IV/V。
- 所有新增文档叙述主体为中文，符合 VI。
- Phase 1 设计后复核无违反项；不新增平行预订系统，继续扩展 MealSlot 与 BookingBatch。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 关联故事/需求 | 主要路径 | 明确非目标 | 独立验证 | 预计人工 diff | 依赖 |
|----|----------------------|---------------|----------|------------|----------|---------------|------|
| PR1 | 固化营业、预订可见性和分享定位契约 | US1/US2；FR1-12 | `specs/021-*`、`packages/kith-inn-v1-shared`、长期契约文档 | 不写数据库和页面 | shared tests + typecheck | 约 750 | 无 |
| PR2 | 持久化租户隔离的营业关闭与分享目标 | US1/US2；FR6-9 | `packages/kith-inn-v1-payload`、`apps/cms` | 不开放商家 API | CMS tests | 约 500 | PR1 |
| PR3a | 只通过受控 API 修改商家默认价 | US1；FR1 | `apps/kith-inn-v1-be`、CMS seller settings route | 不做打烊、批量状态、分享 target 或 Page 4 | route tests | 约 250 | PR2 |
| PR3b | 只通过 seller/date 锁内受控 API 修改打烊记录 | US1；FR6-8 | `apps/kith-inn-v1-be`、CMS closure routes | 不做批量状态、分享 target 或 Page 4 | route/domain tests | 约 650 | PR3a |
| PR3c | 提供最多 20 餐次的逐项批量状态结果 | US1；FR2-5、FR13-15 | `apps/kith-inn-v1-be` meal-slot routes | 不做分享 target 或 Page 4 | route/domain tests | 约 350 | PR3b |
| PR3d | 校验并暴露日期/餐次分享目标与实时详情 | US2/US3；FR9-12、FR15 | `apps/kith-inn-v1-be`、CMS booking-batch routes | 不改 Page 4 | route/domain tests | 约 450 | PR3c |
| PR4 | 重构 Page 4 配置与批量经营操作 | US1；FR1-8、FR13-16 | `apps/kith-inn-v1-fe/src/logic`、Page 4、API client | 不做分享成功视觉 | unit + merchant E2E | 约 650 | PR3d |
| PR5 | 实现日期/餐次分享定位和历史详情 | US2/US3；FR9-16 | v1 FE Page 4、API client、E2E | 不重构顾客端全量浏览 | share payload + E2E | 约 500 | PR4 |
| PR6 | 完成 Page 4 高保真视觉与验收证据 | US3；FR13-16 | Page 4、`app.css`、E2E 与 quickstart | 不扩产品功能 | 375×812 截图 + verify | 约 400 | PR5 |
| PR7 | 让剩余可测量验收可在仓库内复现 | SC1/SC5；FR13-14 | Page 4 E2E、视觉基线与 quickstart | 不改产品行为、不冒充真机分享 | 计时工作流 + 状态视觉回归 + verify | 约 350 | PR6 |

预计值用于 review 负担评估；若实际人工 diff 超过约 800 行，必须停下取得发起人同意。

## Brownfield 事实

- `MealSlot` 已保存菜单快照、可空逐餐价格、截止时间与 `draft/open/closed`；`closed` 当前不可恢复。
- Page 4 已能逐餐 PATCH、选择 1–20 个开放餐次、创建/复制/分享/关闭 BookingBatch，但无 pending、成功态和默认价入口。
- Seller 已有 `defaultPriceCents`，operator session 和商家 API 未暴露它。
- BookingBatch 当前保存多餐次并作为顾客 session、读取和写订单的访问边界；本功能只保持兼容，不在商家 UI 切片内移除顾客端边界。
- MealSlot 要求五项菜单，不能诚实表示“根本不营业”，因此打烊需要独立记录。

## Project Structure

```text
packages/kith-inn-v1-shared/src/        # schema、API contract、纯可见性规则
packages/kith-inn-v1-payload/src/       # collection 配置
apps/cms/src/app/api/internal/kiv1/     # 租户隔离持久化接口
apps/kith-inn-v1-be/src/                # 商家 API 与领域校验
apps/kith-inn-v1-fe/src/                # Page 4、API client、纯页面逻辑
apps/kith-inn-v1-fe/tests/e2e/           # 商家主线 E2E 与视觉回归
docs/kith-inn-v1/                       # 长期行为文档
```

**Structure Decision**: 沿现有 v1 四层架构扩展；营业关闭独立持久化，预订继续由 MealSlot 承载，分享继续兼容 BookingBatch。

## Complexity Tracking

无宪法违反项。

## 外部验收门禁

T027 不属于任何代码 PR：它要求已登录的微信开发者工具、微信聊天会话和真实 iPhone/Android 设备。PR6 交付核心 375×812 视觉回归，PR7 补齐其余可自动化状态与 SC-001 计时证据；真机证据按 [quickstart.md](./quickstart.md) 独立记录，不得以 H5 截图代替。
