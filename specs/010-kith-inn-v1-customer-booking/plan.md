# Implementation Plan: 街坊味 v1 顾客预订登记

**Branch**: `codex/kiv1-merchant-dashboard-plan` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-kith-inn-v1-customer-booking/spec.md`

## Summary

M2 在已经完成的 M0 七个 `kiv1_` collection 和 M1 商家闭环上增加顾客预订登记；M3/M4 在不增加 collection、在线支付或 AI 主链路的前提下，补默认关闭的确定性接龙导入、公开文案/隐私提示、顾客数据导出/资料批量软停用、页面状态打磨与最终自动化验收。

实现继续复用现有 v1 workspaces 和共享 `apps/cms`。M2-A/B、C1～C6、D1～D4、D2R 与 M3/M4 自动化切片均已按“nullable 导入读模型 → strict parser → CMS persistence → BE endpoints → FE fallback → 文案/隐私 → 数据控制 → 状态打磨 → 总验收”顺序完成。新增商家“今日工作台”目标采用“保留业务内核、逐页重写呈现层”，按纯状态模型、真实数据页面、专用手动加单三片串行实施；T028/T087/T090/T097 人工发布门禁和 T057 历史预算事实保持未完成。

## Technical Context

**Language/Version**: TypeScript 5.9；Node.js 20+（仓库本地 Node 24 可运行）

**Primary Dependencies**: 现有 Hono 4、Taro 4.2、React 18、Payload 3.85、Zod 4.4、Web Crypto；不新增生产第三方库

**Storage**: 现有 PostgreSQL `cms` schema 与七个 `kiv1_` collection；本地/CI 继续支持 SQLite fallback，M2 不改 collection 或索引

**Testing**: Vitest（shared/BE/FE 100% coverage）、CMS SQLite/PostgreSQL tenant/owner 集成、Playwright H5 双端关键流、weapp build + 真机分享/微信登录 smoke、`pnpm verify`

**Target Platform**: Node.js Linux 服务；微信小程序为真实顾客/分享平台，现代移动浏览器 H5 仅用于开发和自动化；沿用 CMS 3304、v1 BE 3311、v1 H5 10087

**Project Type**: pnpm/Turborepo monorepo，现有共享契约包、Hono web service、Taro H5/weapp app 和共享 Next/Payload persistence host

**Performance Goals**: 顾客正常网络 5 秒内看到批次；单次最多 20 个餐次的确认摘要与提交；低并发单商家不引入缓存、队列或事务协调器

**Constraints**: seller/openid 只从已验证 token 推导；operator/customer/Admin 三个信任域隔离；Asia/Shanghai 日历语义；customer JWT 不存进业务库；无支付、AI 主链路、消息推送或资料认领；接龙入口默认关闭；商家工作台没有已读状态，只能显示“待确认订单”；未知默认价格只显示“商家默认价”；人工门禁不得由自动化替代

**Scale/Scope**: 1 个实际 seller、微信群低并发顾客；自动化覆盖至少 2 seller × 2 openid；每批次/顾客提交最多 20 个坐标，单次接龙最多 100 个数据行；M2～M4 可自动化实现已完成，商家“今日工作台”呈现层重构待按本计划实施

## Brownfield Baseline

- `origin/main@c6643bc` 已包含 M0/M1、M2-A/B、M2-C1～C6、M2-D1～D4 与 D2R（PR #214、#217～#227、#230 中的对应切片）：顾客登记、自助管理、H5 E2E 与 weapp 自动化均已合并。
- `packages/kith-inn-v1-payload` 已有 `kiv1_booking_batches` 的 publicId/title/status/mealSlots/createdBy、meal slot 的 orderStatus/orderDeadline/priceCents、profile 的 openid/lastUsedAt/active 和 order 的 customerOpenid/source/snapshot/三状态轴；M2 无需修改 collection。
- `packages/kith-inn-v1-shared` 已有按公开 `{date, occasion}` 坐标的 reservation contract，以及 own-order/edit/cancel/deactivate strict contract。
- `apps/cms/src/lib/kiv1-internal.ts` 与 `/api/internal/kiv1/customer/*` 已有 seller+openid owner、profile deactivate、own-order list/update 与取消持久化边界。
- M1 meal-slot PATCH 只允许菜单快照；M2-A 使用独立的 `booking-config` child route 增加 priceCents/orderDeadline/orderStatus 白名单，复用同一 operator owner/service guard，但不把“是否可 open”的领域决策下沉 CMS。
- M1 order PATCH 需要 operator JWT + service secret，状态机在 BE；M2 customer order 写必须使用独立 customer scope 并同样要求 service secret，不能让持有 customer token 的客户端直连 persistence 决策。
- `apps/kith-inn-v1-be` 已有 `/auth/operator`、`/auth/customer`、`/public/booking-batches`、`/customer/profiles`、`/customer/reservations`、顾客订单 list/edit/cancel 与 `/merchant/*`，每次顾客写入均重查 batch/slot/deadline/status。
- `apps/kith-inn-v1-fe` 已有 merchant 页面、顾客登记/自助管理页面和隔离的 operator/customer storage；M3/M4 只增量扩展既有 app。
- 商家登录目前默认进入菜品库，订单页混合筛选、汇总、状态动作和手动加单表单；本目标保留其 API client、session store 与可复用纯逻辑，新增今日首页并把手动加单拆为专用页面，不创建平行前端应用。
- 现有 merchant API 已提供按日期读取餐次、按餐次读取订单、读取/创建顾客资料和创建/更新/重提 manual 订单。顾客写入由服务端强制 batch/slot/deadline 门禁；merchant manual 写入不受顾客截止或餐次关闭限制，因此本目标无需新增 dashboard endpoint 或修改 BE/CMS/shared。
- `ORDER_SOURCES` 与 Payload order 已预留 `jielong-import`、nullable profile/address，但共享 order DTO、CMS create route 与 BE/FE consumer 仍按 profile/address 必填，必须先做向后兼容的 nullable 读模型切片。
- `main` 已有共享 `apps/cms` production migration baseline、production runner 和 readiness gate；本目标不修改其范围外文件，只在最终验收中只读确认。若需修复这些文件则停止并请求扩权。
- Playwright 已能在无头模式重置 SQLite、seed 桃子并启动 CMS/BE/H5；M2 继续扩展同一套纵向测试，不打开可见浏览器。
- 微信官方文档页面在当前检索环境无法直接打开；本计划沿用仓库长期文档中已记录的 `wx.login`、code2Session、`open-type=share`/页面分享回调和隐私边界，真实 API 行为由 weapp 真机 smoke 验证。

## Constitution Check

*GATE: Phase 0 前通过；Phase 1 设计后复核仍通过。*

- **I. 功能规格承载功能工作**: 通过。M2 使用新的全套 `specs/010-*`，长期文档仅作为输入。
- **II. Monorepo 作用域必须明确**: 通过。允许修改 `apps/kith-inn-v1-be/**`、`apps/kith-inn-v1-fe/**`、`packages/kith-inn-v1-shared/**`、`apps/cms/src/lib/kiv1-internal.ts`、`apps/cms/src/app/api/internal/kiv1/**`、相关 CMS tests、`docs/kith-inn-v1/**`（仅决策漂移时）、本规格目录；`packages/kith-inn-v1-payload/**` 和旧 `@cfp/kith-inn-*` 业务源码只读。
- **III. 先承认 Brownfield 事实**: 通过。上一节记录现有实体、route、身份、页面、测试和明确缺口，不重写 M1 架构。
- **IV. 最小可交付与可审查切片**: 通过。M2 已完成；M3/M4 已按十个依赖有序切片交付；M5 再按规划、纯状态模型、真实数据页面、专用手动加单拆为四片，每片一个核心不变量并独立验证，默认人工 diff `<400` 行。
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
├── src/logic/{bookingBatches,customerBooking,customerOrders,merchantHome}.ts
└── src/pages/
    ├── merchant/home/index.tsx
    ├── merchant/orders/add/index.tsx
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

商家页面重构继续沿用同一 Taro app、API client、store 与后端 contract：页面层通过纯逻辑模型消费既有接口，页面内 `MerchantNav` 承担商家导航，不配置会暴露给顾客入口的全局 tabBar。首页首版只请求 `listMealSlots(today, today)`，再对实际存在的午/晚餐并行请求订单；手动加单页复用现有 profile/manual-order API，不增加聚合接口或第二套状态管理。

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

**状态**: 已由 PR #221 rebase merge。

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
| M2-C5R | reservation 输入与逐项结果只使用公开 `{date, occasion}`，BE 在指定 batch 内解析内部餐次 | `packages/kith-inn-v1-shared/src/{api.ts,api.test.ts,types.ts,index.ts}`、`apps/kith-inn-v1-be/src/domain/customerOrders/{service.ts,service.test.ts}`、`apps/kith-inn-v1-be/src/routes/{customerOrders.ts,customerOrders.test.ts}` | shared/BE 100% coverage；拒绝 `mealSlotId` 注入、坐标唯一解析、按公开坐标返回结果、未知错误净化 | 已合并 PR #222 |
| M2-C6 | booking UI 完成资料选择、确认摘要和多餐次提交 | `apps/kith-inn-v1-fe/src/{services/api.ts,services/api.test.ts,logic/customerBooking.ts,logic/customerBooking.test.ts,pages/booking/index.tsx,app.css}`、`apps/kith-inn-v1-fe/tests/e2e/customer-booking.spec.ts` | FE 100% coverage、无头 H5 E2E、weapp build、维护者真机登记 smoke | 已合并 PR #223；T028 仍未完成 |

**独立交付**: C1～C6 产品实现与 H5/weapp 自动化已合并；H5 流程覆盖首次/回访顾客的多餐次 draft 登记，桃子可在 M1 订单页看到结果。微信分享卡片 → 目标页 → 真实 `wx.login`/query 恢复仍待 T028 真机验证，不据此宣称卡片登记可用或可发布。

### M2-D1～D4：我的预订、修改/取消与资料软停用

| PR | 单一目标 / 核心不变量 | 精确路径 | 独立验证 | 依赖 / 人工 diff |
|---|---|---|---|---|
| M2-D1 | own-order/edit/cancel/deactivate strict contract 不允许顾客覆盖 owner 或状态轴 | `packages/kith-inn-v1-shared/src/{api.ts,api.test.ts,types.ts,index.ts}` | strict contract/100% coverage，额外 seller/openid/source/status 字段全部拒绝 | 已合并 PR #224 |
| M2-D2 | CMS own-order 与 deactivate/update 统一按 owner 过滤并保留历史 | `apps/cms/src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route.ts`、`apps/cms/src/app/api/internal/kiv1/customer/orders/{route.ts,[id]/route.ts}`、`apps/cms/tests/{kiv1-customer-profiles.test.ts,kiv1-customer-orders.test.ts}` | SQLite/PostgreSQL 幂等停用、历史可见、跨顾客 404、service guard | 已合并 PR #225；D2R 纠偏 PR #226 |
| M2-D3 | BE 修改/取消前重查 batch/slot/deadline/status，confirmed 即时锁单 | `apps/kith-inn-v1-be/src/domain/customerOrders/{service.ts,service.test.ts}`、`apps/kith-inn-v1-be/src/lib/cms/{customerProfiles.ts,customerProfiles.test.ts,orders.ts,orders.test.ts}`、`apps/kith-inn-v1-be/src/routes/{customerProfiles.ts,customerProfiles.test.ts,customerOrders.ts,customerOrders.test.ts}`、`apps/kith-inn-v1-be/src/{app.ts,app.test.ts}` | domain/route 测试覆盖 own list、edit/cancel/deactivate、截止重查与 confirmed lock | 已合并 PR #227 |
| M2-D4 | 顾客页面只显示自有订单，并仅在允许窗口修改/取消 | `apps/kith-inn-v1-fe/**` | FE 100% coverage、无头 H5 E2E、weapp build | 已合并 PR #230；人工 diff 363 行 |

**独立交付**: M2 自动化闭环已完成；原生分享卡片/真实 `wx.login` smoke 仍受 T028 约束。

### M3/M4：体验兜底与发布前自动化收口

| PR | 单一目标 / 核心不变量 | 主要路径 | 独立验证 | 依赖 |
|---|---|---|---|---|
| M3-A | `jielong-import` 订单可为空 profile/address，其他来源仍严格 | shared order contract、CMS normalize、BE summary、FE order parser/logic/page | shared/CMS/BE/FE coverage；“无地址”呈现 | D4 |
| M3-B | 确定性接龙 grammar、canonical input 与 preview/commit contract | `packages/kith-inn-v1-shared/src/**` | strict schema/parser 100% coverage；非法整批拒绝 | M3-A |
| M3-C | CMS 只允许 operator + service 创建 owner-scoped 导入订单，并保留内部幂等标记 | `/api/internal/kiv1/orders`、`apps/cms/src/lib/kiv1-internal.ts`、v1 CMS tests | SQLite/PostgreSQL tenant/relationship/nullable/marker 白名单 | M3-B |
| M3-D | BE preview 只读、commit 重查文本/餐次/价格并按 hash+行号幂等 | BE domain、CMS client、merchant routes | BE 100% coverage；零写预览、价格变化失效、重复提交零增量 | M3-C |
| M3-E | FE API/logic 只消费 strict preview 并要求显式确认 | FE services/logic | FE 100% coverage；篡改 hash/未确认不发 commit | M3-D |
| M3-F | 默认关闭的弱入口完成预览→确认→结果闭环 | FE page/config/css、headless E2E | H5 E2E、weapp build；默认主导航入口数 0 | M3-E |
| M3-G | 顾客公开文案统一并提供个人信息用途说明页 | FE customer pages、privacy page、E2E | 禁用公开风险词审计、H5/weapp；不冒充后台配置 | M3-F |
| M4-A | 顾客复制 owner-scoped JSON 并批量软停用资料 | FE customer logic/page/E2E | 跨 owner 字段 0、历史订单 100% 可读 | M3-G |
| M4-B | 错误、空数据、截止和关闭状态一致可执行 | FE pages/logic/E2E | H5 状态矩阵、weapp build | M4-A |
| M4-C | 只记录 latest-main 自动门禁与独立人工门禁 | `specs/010-kith-inn-v1-customer-booking/**` | migration readiness 只读检查、全量 headless/verify；真机/后台证据不阻塞前序自动化 | M4-B |

所有实现片从前一片 rebase merge 后的最新 `main` 开始，不 stacked。每片人工 diff 默认 `<400`；超过 400 行先继续拆，无法拆时在 PR 说明解释，超过 800 行停止。

T028、T087、T090、T097 是独立发布门禁，不属于任一自动化 PR 的合并依赖；缺少真机、微信后台或审核证据时继续后续可自动化切片，并在 M4-C 保持这些任务未完成。

### M5：商家今日工作台与手动加单呈现层重构

**呈现层策略**：保留 `src/services/api.ts`、`src/store/**`、仍适用的 `src/logic/**`、shared schema、后端接口和数据库结构；逐页重写商家呈现层、页面级样式和少量共享设计 token。不得创建第二套 API client、状态管理、平行应用或后端聚合系统。

**业务边界**：

- 首页的“今日”以 Asia/Shanghai 计算，午餐和晚餐分别呈现尚未排菜单、已排菜单但未开放、预订中、已截止或已关闭。
- 当前没有订单已读/未读模型，所有 draft 汇总均称“待确认订单”，不得显示“新订单”。
- `priceCents` 有值时显示金额；为空时仅显示“商家默认价”，不推测默认金额。
- 顾客新建、修改和取消继续由服务端截止门禁控制；只要餐次存在，商家在已排菜单但未开放、正在预订、已截止或已关闭状态都可手动补录私信订单。
- “标已付”仍只表示线下付款记录；不增加聊天、AI 主链路或在线支付。

| PR | 单一目标 / 核心不变量 | 精确路径 | 独立验证 | 依赖 / 人工 diff |
|---|---|---|---|---|
| M5-P | 只记录呈现层重构需求、决策与依赖有序任务，不修改业务代码 | `specs/010-kith-inn-v1-customer-booking/{spec.md,plan.md,tasks.md}` | 用户故事/FR/SC/Task 追踪、文档链接、`git diff --check`、`pnpm verify` | latest `origin/main`；默认 `<400` |
| M5-H1 | 建立可测试的今日工作台状态模型，不注册或渲染新页面 | `apps/kith-inn-v1-fe/src/logic/merchantHome.{ts,test.ts}` | FE 100% coverage；Asia/Shanghai 跨日、截止时间等于当前时刻、五种餐次状态、订单汇总、价格文案和手动加单资格 | M5-P；目标 `<300` |
| M5-H2 | 商家登录后进入使用真实数据的高保真今日工作台 | `apps/kith-inn-v1-fe/src/{app.config.ts,app.css,logic/login.ts,logic/login.test.ts,components/MerchantNav.tsx,pages/merchant/login/index.tsx,pages/merchant/home/index.tsx}`、`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` | 登录/session 落点、午晚餐状态、待确认汇总、空态/部分失败/重试、快捷导航、FE coverage、无头 H5 E2E、weapp build | M5-H1；默认 `<400`；超过 400 行先继续拆，确实不可拆才说明原因、风险与验证 |
| M5-H3 | 用专用页面显式完成未开放、开放、截止和关闭餐次的 manual draft 补录 | `apps/kith-inn-v1-fe/src/{app.config.ts,app.css,logic/orders.ts,logic/orders.test.ts,pages/merchant/home/index.tsx,pages/merchant/orders/index.tsx,pages/merchant/orders/add/index.tsx}`、`apps/kith-inn-v1-fe/tests/e2e/merchant.spec.ts` | 已有/新建资料、正整数份数/备注、重复 manual draft 显式更新、manual canceled 显式重提、customer-card 冲突转查看既有订单、四种餐次状态、无餐次提示、FE coverage、无头 H5 E2E、weapp build | M5-H2；默认 `<400` |

M5 各片从前一片 rebase merge 后的最新 `main` 开始，不 stacked。M5-H2 只编排 `listMealSlots(today, today)` 与存在餐次的 `listOrders`；M5-H3 只复用既有 profile/manual-order contract。若任一片证明确需修改 BE、CMS、shared 或数据库结构，立即停止并请求扩权。

## Complexity Tracking

无宪法违规。nullable 读模型必须先于写入，是保持现有 manual/customer-card 兼容的原子切片；parser、persistence、service 和 UI 继续按层拆分。接龙幂等复用已有 `note` 保存 CMS 保留的内部标记：对外 note 剥离标记，商家编辑时保留标记；它只保证低并发顺序重试，若后续要求并发唯一性需另行迁移设计。M4 “删除”沿用既有 profile 软停用语义并保留历史，不宣称物理删除或合规完成。M5 的首页状态模型先于页面、页面先于专用手动加单，分别隔离领域派生、页面编排与表单状态；这是保持每片可独立审查且不重写业务内核的最小切分。
