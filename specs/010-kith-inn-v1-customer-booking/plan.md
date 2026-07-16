# Implementation Plan: 街坊味 v1 顾客预订登记

**Branch**: `codex/kith-inn-v1-m2-slot-target-plan` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-kith-inn-v1-customer-booking/spec.md`

## Summary

M2 在已经完成的 M0 七个 `kiv1_` collection 和 M1 商家闭环上增加顾客预订登记：桃子配置餐次、创建/关闭 booking batch 并分享固定顾客 path；顾客用微信临时 code 静默建立与单一 seller 绑定的 customer JWT，查看批次，维护自己的资料，逐餐提交、修改或取消 draft 订单，并只读查看桃子确认后的三状态轴。

实现继续复用现有 `apps/kith-inn-v1-be`、`apps/kith-inn-v1-fe`、`packages/kith-inn-v1-shared` 和共享 `apps/cms`。M2 不新增 collection、数据库、Payload 进程或生产依赖；BE 继续持有 batch/slot 可写判断、顾客订单状态机和逐项提交决策，CMS 只验证 operator/customer 身份、seller/owner/relationship 和写字段白名单。M2-A/B 与 M2-C1～C5 已合并。C6 开始前发现公开批次读模型按 FR-009 隐藏内部 `mealSlotId`，而登记写 contract 却要求客户端提交该 ID；先以一个原子纠偏 PR 将登记输入和逐项结果统一为公开 `{date, occasion}` 坐标，由 BE 在指定 batch 内解析真实餐次，再继续 C6 与 D1～D4。

## Technical Context

**Language/Version**: TypeScript 5.9；Node.js 20+（仓库本地 Node 24 可运行）

**Primary Dependencies**: 现有 Hono 4、Taro 4.2、React 18、Payload 3.85、Zod 4.4、Web Crypto；不新增生产第三方库

**Storage**: 现有 PostgreSQL `cms` schema 与七个 `kiv1_` collection；本地/CI 继续支持 SQLite fallback，M2 不改 collection 或索引

**Testing**: Vitest（shared/BE/FE 100% coverage）、CMS SQLite/PostgreSQL tenant/owner 集成、Playwright H5 双端关键流、weapp build + 真机分享/微信登录 smoke、`pnpm verify`

**Target Platform**: Node.js Linux 服务；微信小程序为真实顾客/分享平台，现代移动浏览器 H5 仅用于开发和自动化；沿用 CMS 3304、v1 BE 3311、v1 H5 10087

**Project Type**: pnpm/Turborepo monorepo，现有共享契约包、Hono web service、Taro H5/weapp app 和共享 Next/Payload persistence host

**Performance Goals**: 顾客正常网络 5 秒内看到批次；单次最多 20 个餐次的确认摘要与提交；低并发单商家不引入缓存、队列或事务协调器

**Constraints**: seller/openid 只从已验证 token 推导；operator/customer/Admin 三个信任域隔离；Asia/Shanghai 日历语义；customer JWT 不存进业务库；无支付、AI、接龙、消息推送或资料认领；M4 migration baseline 前仍不写真实需保留数据

**Scale/Scope**: 1 个实际 seller、微信群低并发顾客；自动化覆盖至少 2 seller × 2 openid；每批次/每次提交最多 20 个去重公开餐次坐标；已完成 M2-A/B、C1～C5，剩余产品代码按 C5R→C6→D1→D2→D3→D4 六个顺序小 PR 交付

## Brownfield Baseline

- `origin/main@46b7873` 已包含 M0/M1、M2-A/B 与 M2-C1～C5（PR #214、#217、#218、#219、#220）：七个 collection、索引、关系守卫、桃子 seed、operator/customer JWT、菜品、菜单、商家订单、booking batch、顾客只读分享页、顾客资料/订单持久化、BE 编排和 customer HTTP 均已合并。
- `packages/kith-inn-v1-payload` 已有 `kiv1_booking_batches` 的 publicId/title/status/mealSlots/createdBy、meal slot 的 orderStatus/orderDeadline/priceCents、profile 的 openid/lastUsedAt/active 和 order 的 customerOpenid/source/snapshot/三状态轴；M2 无需修改 collection。
- `packages/kith-inn-v1-shared` 已有 customer profile/reservation strict contract，但 reservation item/result 仍使用未公开的内部 `mealSlotId`；own-order/edit/cancel contract 尚未实现。
- `apps/cms/src/lib/kiv1-internal.ts` 与 `/api/internal/kiv1/customer/*` 已有 seller+openid owner、profile/order 写边界；C5R 不改 CMS route 或持久化坐标。
- M1 meal-slot PATCH 只允许菜单快照；M2-A 使用独立的 `booking-config` child route 增加 priceCents/orderDeadline/orderStatus 白名单，复用同一 operator owner/service guard，但不把“是否可 open”的领域决策下沉 CMS。
- M1 order PATCH 需要 operator JWT + service secret，状态机在 BE；M2 customer order 写必须使用独立 customer scope 并同样要求 service secret，不能让持有 customer token 的客户端直连 persistence 决策。
- `apps/kith-inn-v1-be` 已有 `/auth/operator`、`/auth/customer`、`/public/booking-batches`、`/customer/profiles`、`/customer/reservations` 与 `/merchant/*`；C5R 只把 reservation 的公开坐标解析到既有 CMS 内部餐次 ID，不改变持久化 route。
- `apps/kith-inn-v1-fe` 已有 merchant 页面、只读 booking 页面和相互隔离的 operator/customer storage；后续在同一 booking 页增加登记，在独立 customer orders 页增加自助管理。
- Playwright 已能在无头模式重置 SQLite、seed 桃子并启动 CMS/BE/H5；M2 继续扩展同一套纵向测试，不打开可见浏览器。
- 微信官方文档页面在当前检索环境无法直接打开；本计划沿用仓库长期文档中已记录的 `wx.login`、code2Session、`open-type=share`/页面分享回调和隐私边界，真实 API 行为由 weapp 真机 smoke 验证。

## Constitution Check

*GATE: Phase 0 前通过；Phase 1 设计后复核仍通过。*

- **I. 功能规格承载功能工作**: 通过。M2 使用新的全套 `specs/010-*`，长期文档仅作为输入。
- **II. Monorepo 作用域必须明确**: 通过。允许修改 `apps/kith-inn-v1-be/**`、`apps/kith-inn-v1-fe/**`、`packages/kith-inn-v1-shared/**`、`apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/**`、相关 CMS tests、`docs/kith-inn-v1/**`（仅决策漂移时）、本规格目录；`packages/kith-inn-v1-payload/**` 和旧 `@cfp/kith-inn-*` 业务源码只读。
- **III. 先承认 Brownfield 事实**: 通过。上一节记录现有实体、route、身份、页面、测试和明确缺口，不重写 M1 架构。
- **IV. 最小可交付与可审查切片**: 通过。M2-A/B、C1～C5 已合并。C5R 原子同步 shared contract、BE domain 与既有 HTTP route，是避免中间 `main` 类型不一致或出现“接受但不能执行”半契约的最小兼容单元；不改 CMS/FE，预计 `<400` 行。其后仍按 C6、D1～D4 顺序推进。
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

### 恢复计划 PR：重建尚未完成工作的可审查边界

- **单一目标**: 只修正 M2-B 记账并把尚未实施的 M2-C/D 拆成依赖有序的小 PR；不修改产品代码。
- **精确路径**: `specs/010-kith-inn-v1-customer-booking/{spec.md,plan.md,research.md,quickstart.md,tasks.md}`。
- **独立验证**: 文档链接检查、任务格式/状态检查、`speckit-analyze`、`git diff --check`、人工 diff 统计与 `pnpm verify`。
- **依赖与预算**: 从最新 `origin/main` 开始；人工 diff 默认 `<400` 行，超过时必须先继续压缩或在 PR 说明中证明不能再拆，`>800` 行不得开 PR。

**状态**: 已由 PR #213 rebase merge。

### 公开餐次坐标纠偏计划 PR

- **单一目标**: 记录 C6 暴露出的读写 contract 冲突，并把最小原子纠偏片插入 C5 与 C6 之间；不修改产品代码。
- **精确路径**: `specs/010-kith-inn-v1-customer-booking/{spec.md,plan.md,research.md,data-model.md,contracts/customer-api.md,quickstart.md,tasks.md}`。
- **独立验证**: 文档链接检查、任务格式/状态检查、`speckit-analyze`、`git diff --check`、人工 diff 统计与 `pnpm verify`。
- **依赖与预算**: C5 PR #220；人工 diff `<400`，`>800` 不开 PR。

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

**独立交付**: M2-B 代码已合并，顾客会话与只读批次边界可由自动化独立验证；原生卡片、真实 `wx.login` 与 query 恢复仍受 T028 维护者真机门禁约束，未据此宣称可发布。

### M2-C1～C6：顾客资料与首次多餐次登记

| PR | 单一目标 / 核心不变量 | 精确路径 | 独立验证 | 依赖 / 人工 diff |
|---|---|---|---|---|
| M2-C1 | strict contract 只接受顾客可控字段，并确定性归一化 1–20 个餐次 | `packages/kith-inn-v1-shared/src/{api.ts,api.test.ts,types.ts,index.ts}` | shared contract/100% coverage；完全重复保留首次位置，冲突重复整请求 422 | 已合并 PR #214 |
| M2-C2 | profile 持久化始终按 `seller+openid` owner，且响应隐藏 openid | `apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/customer/profiles/{route.ts,[id]/touch/route.ts}`、`apps/cms/tests/kiv1-customer-profiles.test.ts` | SQLite/PostgreSQL 的 JWT+service、owner、active 与响应白名单 | 已合并 PR #217 |
| M2-C3 | order 持久化始终按 `seller+openid+slot+profile` 坐标并拒绝跨关系 | `apps/cms/src/app/api/internal/kiv1/customer/orders/{route.ts,[id]/route.ts,by-slot/[mealSlotId]/route.ts}`、`apps/cms/tests/kiv1-customer-orders.test.ts` | SQLite/PostgreSQL 的 relationship、unique、跨 owner 404 与写字段白名单 | 已合并 PR #218 |
| M2-C4 | BE 每项写前重查，并返回幂等、确定性的部分成功结果 | `apps/kith-inn-v1-be/src/domain/customerOrders/{service.ts,service.test.ts}`、`apps/kith-inn-v1-be/src/lib/cms/{customerProfiles.ts,customerProfiles.test.ts,orders.ts,orders.test.ts}` | 纯领域与 CMS client 测试覆盖 create/update/resubmit/confirmed lock、价格快照和 profile 不回滚 | 已合并 PR #219 |
| M2-C5 | customer HTTP API 只接受 customer JWT，并稳定映射整请求与逐项错误 | `apps/kith-inn-v1-be/src/routes/{customerProfiles.ts,customerProfiles.test.ts,customerOrders.ts,customerOrders.test.ts}`、`apps/kith-inn-v1-be/src/{app.ts,app.test.ts}` | route 鉴权、1–20 项、整请求 422、partial result 与 CMS 错误映射 | 已合并 PR #220 |
| M2-C5R | reservation 输入与逐项结果只使用公开 `{date, occasion}`，BE 在指定 batch 内解析内部餐次 | `packages/kith-inn-v1-shared/src/{api.ts,api.test.ts,types.ts,index.ts}`、`apps/kith-inn-v1-be/src/domain/customerOrders/{service.ts,service.test.ts}`、`apps/kith-inn-v1-be/src/routes/{customerOrders.ts,customerOrders.test.ts}` | shared/BE 100% coverage；拒绝 `mealSlotId` 注入、坐标唯一解析、按公开坐标返回结果、未知错误净化 | 坐标纠偏计划 PR；原子切换既有 endpoint 以保持 `main` 可构建且契约可执行；`<400` |
| M2-C6 | booking UI 完成资料选择、确认摘要和多餐次提交 | `apps/kith-inn-v1-fe/src/{services/api.ts,services/api.test.ts,logic/customerBooking.ts,logic/customerBooking.test.ts,pages/booking/index.tsx,app.css}`、`apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` | FE 100% coverage、无头 H5 E2E、weapp build、维护者真机登记 smoke | C5R；`<400`；T028 与维护者发布结论完成前不得标记可发布/已交付 |

**独立交付**: C1–C5 已逐层锁定可复用安全边界；C5R 消除公开读模型与写 contract 的断裂，且不扩展持久化或 UI；C6 完成后，首次/回访顾客可从卡片完成多餐次 draft 登记，桃子在 M1 订单页可见。每个 PR 从前一片 rebase merge 后的最新 `main` 开始。

### M2-D1～D4：我的预订、修改/取消与资料软停用

| PR | 单一目标 / 核心不变量 | 精确路径 | 独立验证 | 依赖 / 人工 diff |
|---|---|---|---|---|
| M2-D1 | own-order/edit/cancel/deactivate strict contract 不允许顾客覆盖 owner 或状态轴 | `packages/kith-inn-v1-shared/src/{api.ts,api.test.ts,types.ts,index.ts}` | strict contract/100% coverage，额外 seller/openid/source/status 字段全部拒绝 | C6；`<400` |
| M2-D2 | CMS own-order 与 deactivate/update 统一按 owner 过滤并保留历史 | `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/{route.ts,[id]/route.ts}`、`apps/cms/tests/{kiv1-customer-profiles.test.ts,kiv1-customer-orders.test.ts}` | SQLite/PostgreSQL 幂等停用、历史可见、跨顾客 404、service guard | D1；`<400` |
| M2-D3 | BE 修改/取消前重查 batch/slot/deadline/status，confirmed 即时锁单 | `apps/kith-inn-v1-be/src/domain/customerOrders/{service.ts,service.test.ts}`、`apps/kith-inn-v1-be/src/lib/cms/{customerProfiles.ts,customerProfiles.test.ts,orders.ts,orders.test.ts}`、`apps/kith-inn-v1-be/src/routes/{customerProfiles.ts,customerProfiles.test.ts,customerOrders.ts,customerOrders.test.ts}`、`apps/kith-inn-v1-be/src/{app.ts,app.test.ts}` | domain/route 测试覆盖 own list、edit/cancel/deactivate、截止重查与 confirmed lock | D2；`<400` |
| M2-D4 | 顾客页面只显示自有订单，并仅在允许窗口修改/取消 | `apps/kith-inn-v1-fe/src/{services/api.ts,services/api.test.ts,logic/customerOrders.ts,logic/customerOrders.test.ts,pages/customer/orders/index.tsx,app.config.ts,app.css}`、`apps/kith-inn-v1-fe/tests/e2e/{customer-booking.spec.ts,customer-orders.spec.ts}` | FE 100% coverage、无头 H5 E2E、weapp build、M2 总真机验收 | D3；`<400`；T028 未完成时只记录实现完成，不宣称可发布 |

**独立交付**: D4 完成后顾客可查看并在锁单前纠错；桃子确认后顾客即时只读，M2 闭环完成。M2-B 的原生分享卡片/真实 `wx.login` smoke 必须在开放顾客写入前补齐。

## Complexity Tracking

无宪法违规。新增 customer middleware/storage/route namespace 是 operator/customer 两个真实信任域的必要隔离，不是平行应用或通用抽象；所有剩余 PR 都复用同一 workspace、collection 和 CMS host。PR #152 为 `+2136/-19`、PR #153 为 `+1861/-42`，证明原四片计划不再满足现行 review 预算。C5R 是唯一跨 shared/BE domain/HTTP 的剩余片：若先单独改变现有 shared schema，BE 将无法 typecheck；若只增加并行 schema，则会留下仍接受内部 ID 或接受后不能执行的半契约，因此必须原子切换，但明确排除 CMS 与 FE，预计人工 diff `<400`。每片开 PR 前以 `origin/main` 为基线统计人工 diff；若超过 400 行，必须继续拆分，或在 PR 说明中写明不可拆原因、额外风险和验证；超过 800 行一律停止，不开 PR。
