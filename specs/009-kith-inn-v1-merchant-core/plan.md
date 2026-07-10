# Implementation Plan: 街坊味 v1 商家核心闭环

**Branch**: `codex/kith-inn-v1-m1-spec` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-kith-inn-v1-merchant-core/spec.md`

## Summary

M1 在 M0 的七个 `kiv1_` collection 上首次建立实际可运行的商家产品：新增一个 Hono 业务服务和一个同时支持 H5/微信小程序的 Taro 前端，并在现有 `apps/cms` 下增加 `/api/internal/kiv1/*` 薄持久化边界。M1-A 已完成 operator 登录和菜品池，M1-B 已完成单餐/一周菜单与换菜；剩余商家订单按 M1-C1“草稿补单”、M1-C2“订单生命周期”、M1-C3“批量与清单收口”三个顺序纵向 PR 交付，避免再次把跨 shared/CMS/BE/FE 的整段业务压进一个过大的 review。

所有产品读写从 v1 operator JWT 推导 seller；CMS 在每次请求中重新验证 operator membership 仍有效。登录前的 openid membership lookup 使用独立 v1 service secret，不能复用旧 kith-inn token。M1 复用 M0 数据模型，不新增 collection、数据库或 Payload 进程；生产依赖和领域抽象保持最小，前端优先使用 Taro 原生组件与普通 CSS。

## Technical Context

**Language/Version**: TypeScript 5.9；Node.js 20+（仓库本地当前 Node 24 可运行）

**Primary Dependencies**: Hono 4、`@hono/node-server`、Taro 4.2、React 18、Payload 3.85、Zod 4.4、Web Crypto；不新增生产第三方库

**Storage**: 现有 PostgreSQL `cms` schema；本地仍允许 `apps/cms` 的 SQLite fallback，但同 schema/索引集成验证使用 PostgreSQL

**Testing**: Vitest（shared/BE/FE 纯逻辑与契约 100% coverage）、现有 CMS Vitest/PostgreSQL 集成、Playwright H5 关键流、weapp 手工 smoke、`pnpm verify`

**Target Platform**: Node.js Linux 服务；微信小程序与现代移动浏览器 H5；开发端口 CMS 3304、旧 BE 3310 保持不变，v1 BE 3311、v1 H5 10087

**Project Type**: pnpm/Turborepo monorepo，包含共享契约包、Hono web service、Taro mobile/web app 和现有 Next/Payload persistence host

**Performance Goals**: 50 行菜品预览在 2 秒内完成；单餐菜单生成在 3 秒内完成；低并发单商家操作不引入额外常驻缓存或队列

**Constraints**: 单 v1 seller 生产范围但测试双 seller；Asia/Shanghai 日历日；产品 JWT 与旧项目/Admin 分离；seller 从 token 推导；无 AI、支付、分享或顾客入口；M1 不部署真实需保留数据，migration baseline 仍由 M4 在真实数据前统一建立

**Scale/Scope**: 1 个实际 seller/operator；预览最多 50 行；一次最多生成 10 个工作日午晚餐目标（常用 10 个餐次）；订单列表按单餐低百条设计；M1 共 5 个顺序实现 PR，其中剩余订单能力拆成 3 个纵向 PR

## Brownfield Baseline

- `origin/main@44978c6` 已完成 M0、M1-A 和 M1-B：七个 collection、关系守卫、索引、seed、v1 shared API/auth、商家登录、菜品池、菜单生成与换菜均已存在。
- `apps/kith-inn-v1-be` 与 `apps/kith-inn-v1-fe` 已是可运行 workspace；现有 merchant 页面只含登录、菜品和菜单，尚无 orders 页面或空的 M1-C 文件。
- `apps/cms` 已装配 `/api/internal/kiv1/auth`、offerings 和 meal-slots routes；seller/customer-profile/order routes 尚不存在，旧 Admin、health 和旧 `/api/internal/*` routes 保持不变。
- v1 operator JWT、membership revalidation、独立 secret/header 和 seller-scoped CMS helper 已由 M1-A 建立；M1-C 必须复用这些边界，不另建 auth、session 或 repository 层。
- `packages/kith-inn-v1-shared` 已承载 auth、offering 和 meal-slot API schema/type；M1-C 只追加当前订单切片实际使用的契约，不能一次预建后续 PR 尚未使用的 action/bulk schema。
- M0 collection 已完整表达 customer profiles、orders、三条状态轴与快照；M1-C 不修改 `packages/kith-inn-v1-payload`，也不新增 collection。
- 旧 `apps/kith-inn-be`/`apps/kith-inn-fe` 业务源码在 M1-A/B 中保持未修改；M1-C 继续只读旧业务 package。
- 仓库 CI 已提供 PostgreSQL，先运行 `pnpm verify`，再运行 workspace `test:e2e`；新增 v1 H5 e2e 可复用该环境。
- 共享 CMS 仍处于 schema push 阶段；M1 只用于开发/体验验证，首批真实需保留订单进入前必须完成 M4 migration baseline。

## Constitution Check

*GATE: Phase 0 前通过；Phase 1 设计后复核仍通过。*

- **I. 功能规格承载功能工作**: 通过。M1 使用独立全套规格目录，不用长期文档代替实施规格。
- **II. Monorepo 作用域必须明确**: 通过。允许路径仅为 `apps/kith-inn-v1-be/**`、`apps/kith-inn-v1-fe/**`、`packages/kith-inn-v1-shared/**`、`apps/cms` 的 v1 package/config/lib/routes/tests、`docs/kith-inn-v1/**`、根 `knip.json`/`turbo.json`/lockfile、本规格目录；旧 `@cfp/kith-inn-*` 业务源码只读。
- **III. 先承认 Brownfield 事实**: 通过。上一节记录 M0、共享 CMS、旧工程参考、push 模式、CI 和缺失 workspace。
- **IV. 最小可交付切片**: 通过。M1-C 的三个 PR 分别交付草稿补单、生命周期、批量与清单价值；不拆纯 schema/CMS/FE 空壳，不抽新业务 package，不加入 M2/M3 能力。
- **V. 验证和审查属于完成定义**: 通过。每个纵向 PR 都要求失败测试先行、相关窄测试、H5/数据库验证、`pnpm verify` 和 Codex review 闭环。
- **VI. 文档默认中文**: 通过。规格、任务、PR 说明和设计叙述使用中文，标识符/API 保留英文。

## Project Structure

### Documentation (this feature)

```text
specs/009-kith-inn-v1-merchant-core/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cms-internal-api.md
│   └── merchant-api.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/kith-inn-v1-be/
├── .env.example
├── package.json
├── eslint.config.mjs
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts
    ├── app.ts
    ├── middleware/operatorAuth.ts
    ├── lib/
    │   ├── cms/
    │   │   ├── auth.ts
│   │   ├── offerings.ts
│   │   ├── mealSlots.ts
│   │   ├── seller.ts
│   │   ├── customerProfiles.ts
    │   │   └── orders.ts
    │   └── wx/code2session.ts
    ├── domain/
    │   ├── offerings/importText.ts
    │   ├── menu/generate.ts
    │   └── orders/{service,summary}.ts
    └── routes/{auth,health,offerings,mealSlots,orders}.ts

apps/kith-inn-v1-fe/
├── .env.example
├── package.json
├── babel.config.js
├── config/index.ts
├── playwright.config.ts
├── eslint.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── tests/e2e/merchant.spec.ts
└── src/
    ├── app.config.ts
    ├── app.css
    ├── app.tsx
    ├── services/api.ts
    ├── store/session.ts
    ├── logic/{offeringsImport,menu,orders}.ts
    └── pages/merchant/
        ├── login/index.tsx
        ├── offerings/index.tsx
        ├── menu/index.tsx
        └── orders/index.tsx

packages/kith-inn-v1-shared/
└── src/
    ├── api.ts
    ├── auth.ts
    ├── index.ts
    └── schemas.ts

apps/cms/
├── .env.example
├── package.json
├── src/lib/kiv1-internal.ts
├── src/app/api/internal/kiv1/
│   ├── auth/operator-memberships/route.ts
│   ├── offerings/{route.ts,[id]/route.ts}
│   ├── meal-slots/{route.ts,[id]/route.ts}
│   ├── seller/route.ts
│   ├── customer-profiles/route.ts
│   └── orders/{route.ts,[id]/route.ts}
└── tests/
    ├── kiv1-auth.test.ts
    ├── kiv1-offerings.test.ts
    ├── kiv1-meal-slots.test.ts
    └── kiv1-orders.test.ts

knip.json
turbo.json
pnpm-lock.yaml
```

**Structure Decision**: v1 BE 持有认证、解析、菜单规则和订单状态机；v1 FE 只持有展示/表单/纯视图逻辑；CMS routes 只验证身份、owner/relationship 和字段白名单后调用 Payload local API。M1 不增加 `packages/*-domain`、repository class、缓存、队列或单独数据库。

## PR Delivery Plan

### M1-A：商家登录与菜品池

- 创建两个实际 workspace、shared API/auth contract、v1 CMS auth/offerings routes。
- 实现微信登录、显式非生产 dev login、多 seller 选择、JWT/membership revalidation。
- 实现菜品列表、新增、编辑、停用/恢复和 50 行文本预览/提交。
- 交付 H5 “登录 → 菜品池”关键流；M1-B/C 文件不预建。

**独立交付**: 桃子可登录并维护可用于菜单生成的菜品池；未绑定/跨 seller 全部拒绝。

### M1-B：单餐/一周菜单与换菜

- M1-A 合并后从最新 `main` 开始。
- 增加 meal-slot CMS routes、纯菜单生成器、BE endpoints 和商家菜单页。
- 查询目标日前 7 日历史快照；先满足硬约束，再按固定优先级最小化近期/同周/同日主料冲突。

**独立交付**: 足量菜品下可生成 2 荤 2 素 1 汤的单餐/一周菜单并单项换菜。

### M1-C1：顾客资料与草稿补单

- M1-B 合并后从最新 `main` 开始。
- 增加 seller/customer-profile/order CMS routes、基础订单 CMS clients 和只承载当前切片的 shared contract。
- 商家订单页支持选择/创建无 openid 顾客资料、按餐次查看、创建和修改 draft 手动订单。
- 同 profile+slot 重复补单必须先提示，再显式更新同一 draft；不预建 confirm/payment/delivery/bulk UI 或 API。

**独立交付**: 不依赖顾客侧即可跑通“菜单 → 新顾客资料 → 草稿补单 → 修改”，刷新后数据一致。

### M1-C2：订单生命周期

- M1-C1 rebase merge 后从最新 `main` 开始。
- 增加订单状态机与 confirm/cancel/resubmit/payment/delivery actions，继续由 BE 决策、CMS 只执行白名单 patch。
- 增加 confirmed 汇总与前端二次确认；不实现批量送达和剪贴板清单。

**独立交付**: 单条订单可完成“草稿 → 确认 → 收款/送达 → 取消 → 明确重提”，非法迁移无写入。

### M1-C3：批量送达、清单与 M1 收口

- M1-C2 rebase merge 后从最新 `main` 开始。
- 增加显式选中订单的批量已送、地址排序的备餐/送餐清单和平台剪贴板交互。
- 跑通空数据 seed 到订单履约的完整 H5/数据库验证并完成 M1 scope audit。

**独立交付**: 桃子可对多单批量标已送并复制只含 confirmed 订单的经营清单；M1 商家闭环完成。

## Complexity Tracking

无宪法违规。新增 FE/BE workspace 已由 M1-A 的实际功能建立；共享 CMS 继续是唯一 Payload host。M1-C1/C2/C3 都跨层但各自形成可运行纵向切片，前一个 rebase merge 后才从最新 `main` 开始后一个，不创建堆叠 PR，也不拆没有用户价值的纯基础设施 PR。
