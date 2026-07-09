# Tech Spec：街坊味 v1（kith-inn-v1）

> 状态：草稿 v0.1
>
> 日期：2026-07-09
>
> 目标：基于 [USER-STORIES.md](./USER-STORIES.md) 新建 `kith-inn-v1`，不影响旧 `kith-inn`。

## 1. 架构原则

1. **另起炉灶**：v1 不 import `apps/kith-inn-be`、`apps/kith-inn-fe`、`packages/kith-inn-shared`、`packages/kith-inn-payload` 的任何业务代码。
2. **可以参考，不复用逻辑**：菜单避重、订单状态机、Payload access 写法可以照着重写；不要抽公共包。
3. **不用 agent**：MVP 主链路没有 AI 对话。顾客侧下单、菜单生成、订单确认、送达/收款都走确定性 UI + 确定性后端。
4. **顾客轻身份**：顾客不显式登录；小程序 `wx.login` → 后端 code2Session → openid → customer JWT。
5. **商家确认锁单**：顾客提交是 `draft`；桃子确认后 `confirmed`，顾客不能再自助改份数/取消。
6. **公开文案降风险**：顾客可见文案优先用“预订登记”，避免“点餐/外卖/团购/平台”等公开表述。

## 2. Monorepo 结构

```text
apps/kith-inn-v1-fe
apps/kith-inn-v1-be
packages/kith-inn-v1-shared
packages/kith-inn-v1-payload
```

仍可复用仓库基础设施：pnpm、Turborepo、TypeScript、Vitest、Taro、Hono、Payload、共享 `apps/cms` host。这里的“复用”只指工程底座，不复用旧 kith-inn 业务逻辑。

`apps/cms` 作为共享 Payload host 可继续装配 v1 collections；v1 collection slug 必须带 `kiv1_` 前缀，避免和旧 `kith-inn` 的 `orders/customers/offerings` 撞名。

## 3. 应用职责

| 模块 | 技术 | 职责 |
|---|---|---|
| `apps/kith-inn-v1-fe` | Taro + React | 同一个小程序内的商家侧 + 顾客侧页面。 |
| `apps/kith-inn-v1-be` | Hono | 认证、菜单生成、预订批次、订单生命周期、顾客权限。 |
| `packages/kith-inn-v1-shared` | TS + zod | v1 枚举、schema、API 契约类型。 |
| `packages/kith-inn-v1-payload` | Payload collections | v1 数据集合、access、hooks。 |
| `apps/cms` | Next + Payload | 共享 CMS host，只装配 collections，不写 v1 业务逻辑。 |

## 4. 前端页面

### 商家侧

- `/pages/merchant/menu`：菜品池、菜单生成、换菜。
- `/pages/merchant/batches`：选择日期/餐次，生成预订登记批次，分享小程序卡片。
- `/pages/merchant/orders`：按日期/餐次看订单，确认、标已付、标已送、取消、手动补单。
- `/pages/merchant/jielong-import`：审核兜底入口，默认隐藏或弱入口。

### 顾客侧

- `/pages/booking/index?batchId=...`：顾客从分享卡片进入，做预订登记。
- `/pages/customer/orders`：顾客看自己的订单，draft 且未截止时可改份数/取消。

## 5. 认证与权限

### 商家侧

桃子使用 operator 身份登录：

```text
wx.login → POST /auth/operator/wx-login → operator JWT
```

operator JWT 只能访问自己的 `seller` 数据。

### 顾客侧

顾客进入分享卡片时静默建会话：

```text
wx.login + batchPublicId → POST /auth/customer/session → customer JWT
```

customer JWT 包含：

- `sellerId`
- `openid`

顾客只能读写 `sellerId + openid` 范围内的数据：

- 自己的 `customer_profiles`
- 自己的订单
- 当前分享批次的可见餐次

顾客不能确认订单、标已付、标已送。

## 6. 后端 API 草案

### 商家 API

```text
POST   /auth/operator/wx-login

GET    /merchant/offerings
POST   /merchant/offerings
PATCH  /merchant/offerings/:id
DELETE /merchant/offerings/:id

GET    /merchant/menu-plans?from=&to=
POST   /merchant/menu-plans/generate
POST   /merchant/menu-plans/:id/swap

GET    /merchant/meal-slots?from=&to=
PATCH  /merchant/meal-slots/:id

POST   /merchant/booking-batches
PATCH  /merchant/booking-batches/:id

GET    /merchant/orders?date=&occasion=
POST   /merchant/orders
PATCH  /merchant/orders/:id
POST   /merchant/orders/:id/confirm
POST   /merchant/orders/:id/cancel
POST   /merchant/orders/:id/mark-paid
POST   /merchant/orders/:id/mark-unpaid
POST   /merchant/orders/:id/mark-delivered
POST   /merchant/orders/bulk-mark-delivered

POST   /merchant/jielong/preview
POST   /merchant/jielong/commit
```

### 顾客 API

```text
POST   /auth/customer/session

GET    /public/booking-batches/:publicId

GET    /customer/profiles
POST   /customer/profiles
PATCH  /customer/profiles/:id
DELETE /customer/profiles/:id

GET    /customer/orders
POST   /customer/orders
PATCH  /customer/orders/:id
POST   /customer/orders/:id/cancel
```

`PATCH /customer/orders/:id` 只允许改 draft 订单的份数；`cancel` 也只允许 draft 且未截止/未关闭。

## 7. 核心业务规则

### 菜单

- 菜品池只维护菜名、主料、分类、启用状态。
- 菜单生成只从启用菜品选。
- 默认结构先写死：2 荤 2 素 1 汤。
- 尽量避开近期同菜和同主料。
- 菜品池不足时返回明确错误，不发明菜。

### 分享批次

- `booking_batch` 是落库记录，保存本次分享的多个 `meal_slots`。
- 分享 path 带随机 `publicId`，不暴露数据库 id。
- 关闭 batch = 这张卡片整体不再接受新增订单。
- 关闭 slot = 这个餐次不再接受新增订单。

### 订单

- 顾客提交生成/更新 `draft` order。
- 同一 `seller + customerProfile + date + occasion` 只能有一个 active order。
- 桃子确认后变 `confirmed`，进入备餐、未付、未送口径。
- `confirmed` 锁单：顾客不能自助修改/取消，只能联系桃子。
- 桃子可修改/取消 confirmed 订单，但必须提示影响备餐/送餐。

### 顾客资料

- `customer_profile` 是“称呼 + 地址”的绑定资料。
- 不做称呼表和地址表自由组合。
- 订单保存 `displayName` 和 `address` 快照。
- profile 修改不影响历史订单。

## 8. AI 使用

MVP 主链路不使用 AI。

唯一保留的 AI/LLM 入口是审核兜底或迁移工具：

- `POST /merchant/jielong/preview`
- 输入微信群接龙文本。
- 解析日期、餐次、顾客名、份数。
- 没地址也允许写订单，地址为空。
- 必须预览确认后才写库。

如果不启用兜底入口，v1 可以完全没有 LLM 依赖。

## 9. 测试策略

- `packages/kith-inn-v1-shared`：schema/enums 单测。
- `apps/kith-inn-v1-be`：纯函数 + Hono route 单测。
- `packages/kith-inn-v1-payload`：tenant access、hooks、collection traversal 单测。
- `apps/kith-inn-v1-fe`：逻辑函数单测；H5 关键流 e2e。

最小必测：

- 顾客 openid 只能看到自己的资料和订单。
- draft 订单可由顾客改份数/取消。
- confirmed 订单顾客不可改。
- 桃子确认订单后进入经营口径。
- booking batch/slot 关闭后不能新增订单。
- 菜单生成不选停用菜、不发明菜。

## 10. Milestones

### M0：骨架与数据层

- 新建 4 个 v1 workspace。
- `packages/kith-inn-v1-shared`：枚举、schema、契约。
- `packages/kith-inn-v1-payload`：collections + tenant/customer access。
- `apps/cms` 装配 v1 collections。
- seed 桃子 seller/operator。

交付：能在 CMS 看到 v1 的 seller、operator、菜品、餐次、订单集合。

### M1：菜单与商家侧订单

- 菜品池 CRUD + 批量导入。
- 单餐/多餐菜单生成、换菜。
- 商家手动补单、改单。
- 商家确认订单、标已付、标已送、取消。

交付：不依赖顾客侧，也能让桃子手动跑通“菜单 → 补单 → 确认 → 送达/收款”。

### M2：顾客预订登记

- 顾客静默 openid 会话。
- 顾客 profile select/新增。
- booking batch 创建与分享。
- 顾客提交、改份数、取消 draft。
- confirmed 锁单。

交付：顾客从分享卡片进入，完成预订登记；桃子确认后顾客不可再改。

### M3：体验版验证与审核兜底

- 文案统一为“预订登记”。
- 隐私指引文案与页面提示。
- H5/e2e + weapp 真机体验版 smoke。
- 接龙文案导入兜底入口。

交付：若顾客侧审核风险不可接受，可切换到“微信群接龙 + 老板侧导入订单”。

### M4：发布前收口

- 数据导出/删除能力最小闭环。
- 错误态、空态、截止/关闭态打磨。
- `pnpm verify` 全绿。
- 小程序类目/资质路径确认。

交付：可提交体验版/审核版。
