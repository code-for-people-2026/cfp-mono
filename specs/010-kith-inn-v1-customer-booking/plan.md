# Implementation Plan: 街坊味 v1 顾客预订登记

**Branch**: `codex/kith-inn-v1-m2-spec` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-kith-inn-v1-customer-booking/spec.md`

## Summary

M2 在已经完成的 M0 七个 `kiv1_` collection 和 M1 商家闭环上增加顾客预订登记：桃子配置餐次、创建/关闭 booking batch 并分享固定顾客 path；顾客用微信临时 code 静默建立与单一 seller 绑定的 customer JWT，查看批次，维护自己的资料，逐餐提交、修改或取消 draft 订单，并只读查看桃子确认后的三状态轴。

实现继续复用现有 `apps/kith-inn-v1-be`、`apps/kith-inn-v1-fe`、`packages/kith-inn-v1-shared` 和共享 `apps/cms`。M2 不新增 collection、数据库、Payload 进程或生产依赖；BE 继续持有 batch/slot 可写判断、顾客订单状态机和逐项提交决策，CMS 只验证 operator/customer 身份、seller/owner/relationship 和写字段白名单。为控制 review 粒度，M2 按 A“商家批次”、B“顾客会话+只读分享页”、C“资料+首次登记”、D“我的预订+修改/取消/软停用”四个顺序纵向 PR 交付。

## Technical Context

**Language/Version**: TypeScript 5.9；Node.js 20+（仓库本地 Node 24 可运行）

**Primary Dependencies**: 现有 Hono 4、Taro 4.2、React 18、Payload 3.85、Zod 4.4、Web Crypto；不新增生产第三方库

**Storage**: 现有 PostgreSQL `cms` schema 与七个 `kiv1_` collection；本地/CI 继续支持 SQLite fallback，M2 不改 collection 或索引

**Testing**: Vitest（shared/BE/FE 100% coverage）、CMS SQLite/PostgreSQL tenant/owner 集成、Playwright H5 双端关键流、weapp build + 真机分享/微信登录 smoke、`pnpm verify`

**Target Platform**: Node.js Linux 服务；微信小程序为真实顾客/分享平台，现代移动浏览器 H5 仅用于开发和自动化；沿用 CMS 3304、v1 BE 3311、v1 H5 10087

**Project Type**: pnpm/Turborepo monorepo，现有共享契约包、Hono web service、Taro H5/weapp app 和共享 Next/Payload persistence host

**Performance Goals**: 顾客正常网络 5 秒内看到批次；单次最多 20 个餐次的确认摘要与提交；低并发单商家不引入缓存、队列或事务协调器

**Constraints**: seller/openid 只从已验证 token 推导；operator/customer/Admin 三个信任域隔离；Asia/Shanghai 日历语义；customer JWT 不存进业务库；无支付、AI、接龙、消息推送或资料认领；M4 migration baseline 前仍不写真实需保留数据

**Scale/Scope**: 1 个实际 seller、微信群低并发顾客；自动化覆盖至少 2 seller × 2 openid；每批次/每次提交最多 20 个去重 meal slots；M2 共 4 个顺序实现 PR

## Brownfield Baseline

- `origin/main@5175e83` 已完成 M0/M1：七个 collection、索引、关系守卫、桃子 seed、operator JWT、菜品、菜单和商家订单闭环均已合并。
- `packages/kith-inn-v1-payload` 已有 `kiv1_booking_batches` 的 publicId/title/status/mealSlots/createdBy、meal slot 的 orderStatus/orderDeadline/priceCents、profile 的 openid/lastUsedAt/active 和 order 的 customerOpenid/source/snapshot/三状态轴；M2 无需修改 collection。
- `packages/kith-inn-v1-shared` 已有底层 batch/slot/profile/order schema 与 operator auth/API contract，但对外 `MealSlot` 尚未返回 orderDeadline，也没有 customer claims、batch/customer API schema。
- `apps/cms/src/lib/kiv1-internal.ts` 目前只有 service 和 operator scope；`/api/internal/kiv1/*` 已有 operator offerings/meal-slots/profiles/orders，尚无 booking-batches 或 customer-scoped namespace。
- M1 meal-slot PATCH 只允许菜单快照；M2-A 使用独立的 `booking-config` child route 增加 priceCents/orderDeadline/orderStatus 白名单，复用同一 operator owner/service guard，但不把“是否可 open”的领域决策下沉 CMS。
- M1 order PATCH 需要 operator JWT + service secret，状态机在 BE；M2 customer order 写必须使用独立 customer scope 并同样要求 service secret，不能让持有 customer token 的客户端直连 persistence 决策。
- `apps/kith-inn-v1-be` 只有 `/auth/operator` 与 `/merchant/*`；现有 Web Crypto JWT helper、code2Session、CMS clients 和订单状态机可扩展，不能另建平行 auth/repository/domain package。
- `apps/kith-inn-v1-fe` 只有四张 merchant 页面和独立 operator storage；M2 在同一 app 增加 batches、booking、customer orders 页面和独立 customer storage，顾客入口不得复用或覆盖 operator session。
- Playwright 已能在无头模式重置 SQLite、seed 桃子并启动 CMS/BE/H5；M2 继续扩展同一套纵向测试，不打开可见浏览器。
- 微信官方文档页面在当前检索环境无法直接打开；本计划沿用仓库长期文档中已记录的 `wx.login`、code2Session、`open-type=share`/页面分享回调和隐私边界，真实 API 行为由 weapp 真机 smoke 验证。

## Constitution Check

*GATE: Phase 0 前通过；Phase 1 设计后复核仍通过。*

- **I. 功能规格承载功能工作**: 通过。M2 使用新的全套 `specs/010-*`，长期文档仅作为输入。
- **II. Monorepo 作用域必须明确**: 通过。允许修改 `apps/kith-inn-v1-be/**`、`apps/kith-inn-v1-fe/**`、`packages/kith-inn-v1-shared/**`、`apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/**`、相关 CMS tests、`docs/kith-inn-v1/**`（仅决策漂移时）、本规格目录；`packages/kith-inn-v1-payload/**` 和旧 `@cfp/kith-inn-*` 业务源码只读。
- **III. 先承认 Brownfield 事实**: 通过。上一节记录现有实体、route、身份、页面、测试和明确缺口，不重写 M1 架构。
- **IV. 最小可交付切片**: 通过。M2-A/B/C/D 每个 PR 都是可运行纵向增量；不拆纯 schema/CMS 空壳，不预建下一切片页面或 endpoint。
- **V. 验证和审查属于完成定义**: 通过。每个实现 PR 都要求失败测试先行、窄验证、H5/数据库回归、`pnpm verify` 和 Codex review 闭环。
- **VI. 文档默认中文**: 通过。规格、计划、任务、契约、PR 说明和 review 回复以中文为叙述主体。

## Project Structure

### Documentation (this feature)

```text
specs/010-kith-inn-v1-customer-booking/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cms-internal-api.md
│   ├── customer-api.md
│   └── merchant-api.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/kith-inn-v1-shared/src/
├── auth.ts
├── api.ts
├── types.ts
└── {auth,api}.test.ts

apps/kith-inn-v1-be/src/
├── app.ts
├── middleware/{operatorAuth,customerAuth}.ts
├── routes/{auth,mealSlots,bookingBatches,customerProfiles,customerOrders}.ts
├── domain/
│   ├── bookings/availability.ts
│   └── customerOrders/service.ts
└── lib/cms/{auth,mealSlots,bookingBatches,customerProfiles,orders}.ts

apps/kith-inn-v1-fe/
├── tests/e2e/merchant.spec.ts
├── src/app.config.ts
├── src/app.css
├── src/services/api.ts
├── src/store/{session,customerSession}.ts
├── src/logic/{bookingBatches,customerBooking,customerOrders}.ts
└── src/pages/
    ├── merchant/batches/index.tsx
    ├── booking/index.tsx
    └── customer/orders/index.tsx

apps/cms/
├── src/lib/kiv1-internal.ts
├── src/app/api/internal/kiv1/
│   ├── auth/customer-session/route.ts
│   ├── booking-batches/{route.ts,[id]/route.ts}
│   ├── meal-slots/[id]/{route.ts,booking-config/route.ts}
│   └── customer/
│       ├── booking-batches/[publicId]/route.ts
│       ├── profiles/{route.ts,[id]/{touch,deactivate}/route.ts}
│       └── orders/{route.ts,[id]/route.ts,by-slot/[mealSlotId]/route.ts}
└── tests/{kiv1-booking-batches,kiv1-customer-auth,kiv1-customer-orders}.test.ts
```

**Structure Decision**: 在现有三个 v1 workspace 和 CMS namespace 内增量扩展。customer route 与 operator route 用明确 namespace/header/JWT kind 隔离；BE domain 负责可写状态和订单转换，CMS 只负责身份/owner/relationship/白名单；FE 使用同一 Taro app 的不同页面和 storage key。M2 不增加 workspace、通用 auth package、repository class、缓存、队列或事务框架。

## PR Delivery Plan

### M2-A：商家餐次预订配置与 booking batch

- 扩展 MealSlot 对外 contract，加入 price/deadline/orderStatus 配置与可选状态派生。
- 增加 operator-scoped booking-batch CMS/BE routes 和商家 batches 页面。
- 生成 publicId、标题和固定 share path；商家页只显示/复制 path 供验证，不发出指向尚未注册页面的真实卡片。
- 支持关闭 batch 或 meal slot；不创建 customer claims/page/API。

**独立交付**: 桃子能配置可登记餐次、创建/关闭批次并预览确定性的待分享 path；真实微信分享在目标页存在的 M2-B 启用。

### M2-B：顾客静默会话与只读分享页

- M2-A rebase merge 后从最新 `main` 开始。
- 增加 customer claims、与 operator 分离的 middleware/storage、微信登录和双开关 H5 dev customer login。
- 增加 service-auth batch→seller bootstrap、customer-scoped public batch read 和 `/pages/booking/index` 只读页。
- 在目标页真实存在后为商家 batches 页面启用 weapp 原生分享；M2-B 真机 smoke 同时验证点击卡片、`wx.login` 和 query 恢复。
- closed/archived batch 仍能建立 session/展示，invalid publicId 不签 token；不创建 profile/order 写 API。

**独立交付**: 顾客从有效卡片静默进入并只读看到限定批次，身份与商家侧完全隔离。

### M2-C：顾客资料与首次多餐次登记

- M2-B rebase merge 后从最新 `main` 开始。
- 增加 customer-scoped profile list/create、逐餐 order create/update/resubmit persistence 边界和 BE 纯领域逻辑。
- booking 页支持历史资料选择、新资料、本次快照修改、最多 20 餐次确认摘要与逐项提交结果。
- profile 创建后单项订单失败不回滚；重试复用 unique 坐标；不实现“我的预订”修改/取消或资料停用。

**独立交付**: 首次/回访顾客可以从卡片完成多餐次 draft 预订登记，桃子在 M1 订单页可见。

### M2-D：我的预订、修改/取消与资料软停用

- M2-C rebase merge 后从最新 `main` 开始。
- 增加 customer own-order list、draft quantity edit/cancel 与 profile active=false。
- 每次写前重查 batch、slot、deadline、order owner/status；confirmed/closed/expired 全部锁定。
- 增加顾客三状态轴只读页和 M2 空库 seed→分享→登记→商家确认→顾客锁单总验收。

**独立交付**: 顾客可查看并在锁单前纠错；桃子确认后顾客即时只读，M2 闭环完成。

## Complexity Tracking

无宪法违规。新增 customer middleware/storage/route namespace 是 operator/customer 两个真实信任域的必要隔离，不是平行应用或通用抽象；四个实现 PR 都复用同一 workspace、collection 和 CMS host。
