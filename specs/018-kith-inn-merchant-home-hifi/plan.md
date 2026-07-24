# Implementation Plan: kith-inn-v1 商家今日工作台高保真重构

**Branch**: `018-kith-inn-merchant-home-hifi` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: 指定工作树中的高保真参考图、完整还原说明、HTML 设计源与本目录 `spec.md`

## Summary

在不改变后端、共享契约和现有路由的前提下，把商家首页重排为“品牌与问候 → 待确认提醒 → 午晚餐状态 → 四个快捷动作”，并用可单测的纯逻辑生成问候、菜单摘要、价格、截止时间和状态文案。页面组件继续负责 session、请求编排、局部失败隔离、竞态保护和跳转；全局样式中的首页与 `MerchantNav` 区段负责奶油色视觉、统一卡片、触控目标和安全区。

## Technical Context

**Language/Version**: TypeScript 5.9、React 18、CSS/WXSS rpx

**Primary Dependencies**: Taro 4.2 原生组件、现有 `@cfp/kith-inn-v1-shared` 类型与 API client

**Storage**: N/A；只读取现有 session、meal slot 和 order summary，不新增持久化

**Testing**: Vitest + V8 100% coverage、Playwright H5 E2E、H5/weapp production build、`pnpm verify`

**Target Platform**: H5 与微信小程序

**Project Type**: pnpm/Turborepo monorepo 内的 Taro 多端前端页面

**Performance Goals**: 首屏无缓存时给出明确加载态；同日刷新保留旧卡片；快速重复进入时旧请求覆盖新状态次数为 0

**Constraints**: 不改后端/API/共享契约；不增加 mock 或静态业务数据；不实现头像、伪系统胶囊、“我的”、聊天、AI、支付；固定导航不遮挡小屏最后入口

**Scale/Scope**: 一个商家首页、午餐/晚餐两个固定视图、五种餐次状态、四个快捷入口和一个共享底部导航

## Constitution Check

*GATE：计划前与设计后均已复核，结果 PASS。*

- **轻量规格**：单 PR 且包含状态文案和交互取舍，已按宪法生成 `spec.md / plan.md / tasks.md`；不生成全套研究、模型、契约、quickstart 或 checklist。
- **Monorepo 作用域**：只允许修改 `apps/kith-inn-v1-fe/src/logic/merchantHome.ts` 及测试、商家首页、`MerchantNav`、`app.css`、相关 H5 E2E 与本规格目录；不触碰 BE、CMS、shared 或其他 app。
- **Brownfield 事实**：当前首页已有上海业务日期、session 失效跳转、同日旧数据保留、revision 竞态保护、午晚餐并行加载、单餐次摘要失败隔离/重试、手动加单和既有路由；缺口是品牌/问候层级、零待确认隐藏、菜单构成摘要、卡片点击、待开放动作、参考视觉与安全区导航。
- **可审查切片**：当前实现只有一个“真实今日经营状态一眼可见且既有动作可达”的页面不变量；纯展示逻辑若单独合并会成为未使用代码或提前改变旧页面文案，无法同时通过独立可用性和未使用代码门禁，因此保留一个实现 PR。
- **完成定义**：先扩充纯逻辑与 E2E 断言，再修改渲染和样式；执行相关 coverage、H5 E2E、H5/weapp build、视觉验收、`pnpm verify` 和 diff 检查。
- **文档语言**：规格与说明主体使用中文。无宪法例外。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 关联故事/需求 | 主要路径 | 明确非目标 | 独立验证 | 预计人工 diff | 依赖 |
|----|----------------------|---------------|----------|------------|----------|---------------|------|
| PR1 | 商家首页以真实数据高保真呈现今日经营状态，且所有既有动作和失败恢复保持可达 | US1；FR-001–FR-016 | `apps/kith-inn-v1-fe/src/logic/merchantHome*`、`src/pages/merchant/home/index.tsx`、`src/components/MerchantNav.tsx`、`src/app.css`、`tests/e2e/merchant.spec.ts`、本规格目录 | 后端/API、设计资产归档、其他商家页面重构、任何 MVP 外能力 | logic coverage、merchant H5 E2E、H5/weapp build、目标视口视觉核对、`pnpm verify` | 约 650–780 行 | 无 |

预计超过默认 400 行，因为同一页面不变量同时需要轻量规格、可测试文案模型、真实状态渲染、跨端样式和现有交互回归；拆出任一部分都会留下未使用逻辑、旧视觉配新语义或无法独立验收的中间态。预计保持低于 800 行；若实际人工 diff 超过 800 行，停止开 PR 并先向发起人确认或重新切片。指定 PNG/HTML 等设计资产不进入本 PR，可在实现之外另开独立设计资产 PR；完整还原说明永不提交。

## Project Structure

### Documentation (this feature)

```text
specs/018-kith-inn-merchant-home-hifi/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/kith-inn-v1-fe/
├── src/
│   ├── logic/
│   │   ├── merchantHome.ts
│   │   └── merchantHome.test.ts
│   ├── pages/merchant/home/index.tsx
│   ├── components/MerchantNav.tsx
│   └── app.css
└── tests/e2e/merchant.spec.ts
```

**Structure Decision**: 扩展现有首页 view model、类组件和共享样式，不新增组件目录、状态库、图标依赖或平行数据层。`MerchantNav` 只补足现有四栏的视觉语义，不改变路由。

## Complexity Tracking

无宪法违规或需保留的额外复杂度。
