# Tech Spec：街坊味 v1（kith-inn-v1）

> 状态：草稿 v0.2
>
> 日期：2026-07-10
>
> 目标：基于 [USER-STORIES.md](./USER-STORIES.md) 新建 `kith-inn-v1`，共享仓库基础设施和 `apps/cms` Payload 进程，但不复用旧 `kith-inn` 业务代码或业务数据。

## 1. 架构原则

1. **业务另起炉灶**：v1 不 import `apps/kith-inn-be`、`apps/kith-inn-fe`、`packages/kith-inn-shared`、`packages/kith-inn-payload` 的业务代码。
2. **共享 Payload 运行时**：除 `website` 外，小项目共用 `apps/cms` 的 Payload 实例、端口和 PostgreSQL `cms` schema，控制 ECS 常驻资源。
3. **前缀隔离**：v1 collection/table/API slug 全部以 `kiv1_` 开头；v1 relationship 不指向旧 kith-inn collection。
4. **可以参考，不抽公共业务包**：菜单避重、JWT、CMS internal route、关系守卫和 seed 写法可以参考旧实现后重写。
5. **不用 agent**：MVP 主链路没有 AI 对话；菜单、预订登记和订单生命周期都走确定性 UI + 后端。
6. **顾客轻身份**：顾客不显式登录；小程序 `wx.login` → v1 后端 code2Session → openid → v1 customer JWT。
7. **身份不混用**：共享 Payload Admin、v1 operator JWT、v1 customer JWT 是三种不同信任域。
8. **商家确认锁单**：顾客提交是 `draft`；桃子确认后 `confirmed`，顾客不能再自助改份数或取消。
9. **公开文案降风险**：顾客可见文案优先使用“预订登记”，避免“点餐/外卖/团购/平台”等表述。
10. **最小数据模型**：MVP 只有套餐份数和单次送达，先用七个 collection；出现多商品或多履约任务后再拆表。
11. **多租户坐标从第一天存在**：所有业务读写包含 seller；operator 唯一键是 `seller + wechatOpenid`，同一微信可管理多个 seller。

## 2. Monorepo 结构

最终结构按 milestone 逐步创建：

```text
apps/kith-inn-v1-fe             # M1 创建，Taro 商家侧 + 顾客侧
apps/kith-inn-v1-be             # M1 创建，Hono 业务 API
packages/kith-inn-v1-shared     # M0 创建，枚举/schema/API 类型
packages/kith-inn-v1-payload    # M0 创建，v1 collections/hooks/seed
apps/cms                        # 既有共享 Payload host，M0 装配 v1 collections
```

仍可复用 pnpm、Turborepo、TypeScript、Vitest、Taro、Hono、Payload 和 PostgreSQL 等工程底座。v1 不创建第二套 Payload/Next app，也不增加 CMS 端口。

`apps/cms` 继续使用 `schemaName = "cms"`。旧 collection 保持原 slug；v1 使用 `kiv1_` 前缀避免 `orders/customers/offerings` 等名称碰撞。

## 3. 模块职责

| 模块 | 技术 | 职责 |
|---|---|---|
| `apps/kith-inn-v1-fe` | Taro + React | 同一个小程序内的商家侧和顾客侧页面。 |
| `apps/kith-inn-v1-be` | Hono | 微信登录、v1 JWT、菜单生成、预订批次、订单生命周期和顾客权限。 |
| `packages/kith-inn-v1-shared` | TypeScript + Zod | v1 枚举、schema、API 契约类型和 `YYYY-MM-DD` 校验。 |
| `packages/kith-inn-v1-payload` | Payload collections | 七个 `kiv1_` collection、同 seller 关系守卫、索引和 v1 seed。 |
| `apps/cms` | Next + Payload | 聚合各项目 collections/seed；后续承载命名空间隔离的薄 internal persistence routes，不做 v1 领域决策。 |

`apps/cms` 的旧 internal routes 不复用。v1 后续 route 使用 `/api/internal/kiv1/*` 前缀和独立 JWT/header；route 只做鉴权、seller/owner 校验和 Payload local API 转换，业务状态机留在 v1 backend/domain。

## 4. 前端页面

### 商家侧

- `/pages/merchant/menu`：菜品池、批量录入、菜单生成、换菜。
- `/pages/merchant/batches`：选择日期/餐次，生成预订登记批次，分享小程序卡片。
- `/pages/merchant/orders`：按日期/餐次看订单，确认、标记到账、标已送、取消、手动补单。
- `/pages/merchant/jielong-import`：审核兜底入口，默认隐藏或弱入口。

### 顾客侧

- `/pages/booking/index?batchId=...`：顾客从分享卡片进入，做预订登记。
- `/pages/customer/orders`：顾客查看自己的订单；draft 且未截止时可改份数或取消。

分享 path 只在代码中由固定 route + batch publicId 生成，不存数据库字段。

## 5. 认证与权限

### 5.1 共享 Payload Admin

- `apps/cms.admin.user` 继续使用旧 `operators`，M0 不改现有 Admin 登录。
- 共享 Admin 是可信运维入口，可以检查 `cms` schema 中多个项目的数据。
- `kiv1_operators` 是普通 v1 业务 collection，不设置 `auth: true`，不接管 Payload Admin。
- 未认证请求直接访问 v1 Payload collection 时默认 deny。
- Payload Admin token 不作为 v1 商家或顾客产品 token。
- M0 只有一个 v1 seller，允许现有共享 Admin 检查全部 v1 数据；第二个 v1 seller 上线前，必须把共享 Admin 收口为明确的平台管理员身份或关闭其 v1 数据访问，不能继续把任意旧 operator 当作全局管理员。

### 5.2 商家侧

```text
wx.login
  → POST /auth/operator/wx-login
  → code2Session 得到 openid
  → 查找该 openid 的全部有效 kiv1_operators membership
  → 只有一个 seller 时直接选择；多个 seller 时让 operator 选择
  → 为选中的 seller 签发 v1 operator JWT
```

operator JWT 至少包含：

- `operatorId`
- `sellerId`
- `role: operator`
- `exp`

商家 API 只能访问 JWT `sellerId` 下的数据。MVP 只有 owner 行为，不预建没有权限差异的 helper 角色。

`kiv1_operators` 使用 `(seller, wechatOpenid)` 复合唯一，不把 openid 设为全局唯一。同一微信可以管理多个 seller，也可以用同一 openid 在顾客入口建立 customer session；JWT role 决定当前权限。

MVP 假设所有 seller 使用同一个小程序 AppID，因此同一微信得到同一个 openid。若未来一个平台接入多个 AppID，必须先把身份坐标升级为 `appId + openid`，不能跨 AppID 直接比较 openid。

### 5.3 顾客侧

```text
wx.login + batchPublicId
  → POST /auth/customer/session
  → code2Session 得到 openid
  → 从任意状态的现存 batch 解析 sellerId
  → 签发 v1 customer JWT
```

session endpoint 只要求 `batchPublicId` 有效，不要求 batch 为 open。closed/archived batch 仍可建立顾客身份，以便展示禁用的餐次和当前 openid 的历史订单；无效 batch 拒绝。customer JWT 只证明 `seller + openid` 身份，不代表当前批次或餐次可写。

customer JWT 至少包含：

- `sellerId`
- `openid`
- `role: customer`
- `exp`

顾客只能访问：

- 当前 `sellerId + openid` 下绑定且 active 的 customer profiles。
- `customerOpenid` 等于当前 openid 的订单。
- 当前分享批次允许公开的 meal slots 和菜单快照。

顾客不能确认订单、标记到账、标已送，也不能按称呼或地址认领资料/订单。

### 5.4 Backend → CMS

- v1 backend 调用独立的 `/api/internal/kiv1/*` routes。
- internal route 必须验证 v1 JWT，不能只相信请求体中的 seller/openid。
- 使用 Payload local API `overrideAccess` 前，route 显式校验目标记录属于 JWT seller/openid，并校验所有 relationship 同 seller。
- v1 route、header、JWT secret 不复用旧 kith-inn；共享的只有 Payload 进程和数据库 adapter。

## 6. 后端 API 草案

### 商家 API

```text
POST   /auth/operator/wx-login

GET    /merchant/offerings
POST   /merchant/offerings
PATCH  /merchant/offerings/:id        # 编辑或 active=false/true

GET    /merchant/meal-slots?from=&to=
POST   /merchant/meal-slots/generate-menus
POST   /merchant/meal-slots/:id/swap-menu-item
PATCH  /merchant/meal-slots/:id       # 价格、截止时间、预订状态

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
POST   /merchant/orders/:id/mark-pending-delivery
POST   /merchant/orders/bulk-mark-delivered

POST   /merchant/jielong/preview
POST   /merchant/jielong/commit
```

菜品不提供物理删除 API；停用/恢复统一通过 `PATCH active`。

### 顾客 API

```text
POST   /auth/customer/session

GET    /public/booking-batches/:publicId

GET    /customer/profiles
POST   /customer/profiles
PATCH  /customer/profiles/:id
DELETE /customer/profiles/:id          # 软停用 active=false

GET    /customer/orders
POST   /customer/orders
PATCH  /customer/orders/:id
POST   /customer/orders/:id/cancel
```

`POST /customer/orders` 必须另行校验 batch 为 open、目标 meal slot 属于该 batch 且仍 open、未过 deadline。`PATCH /customer/orders/:id` 和 cancel 只允许当前 openid 的 draft order，且 meal slot 仍 open、未过 deadline。profile DELETE 不删除历史订单。

## 7. 核心业务规则

### 菜单与餐次

- 菜品池只维护菜名、主料、分类、启用状态。
- 菜品页默认是只展示启用菜品的浏览态，分类筛选固定按“全部、荤菜、素菜、汤”排列，并可从菜品卡直接停用；浏览态与管理态都保持服务返回顺序。
- 管理态按“启用中、已停用”分组，集中提供新增、编辑、停用/恢复和批量导入入口；视觉层把新增按钮固定在底部导航上方，并把新增/编辑表单呈现为底部操作面板。
- 菜品页分别呈现首次加载、无启用菜、分类筛选为空、整页加载失败和后台刷新失败；后台刷新失败时保留当前列表并明确提示。
- 前端按菜品标识维护独立的启停 pending/revision；同项处理中拒绝重复提交，只有当前 revision 的响应可以更新并解锁该菜品，其他菜品不受阻塞。
- 编辑结果按稳定标识原位替换，新增结果追加；启用/停用分组通过过滤原数组形成，不按菜名二次排序。
- 批量导入预览绑定原文快照和单调 revision；原文变化立即清除旧预览、冲突选择和提交结果，过期响应不得写回当前界面。
- 批量导入确认仅接受与当前原文 revision 匹配的预览；请求发出后锁定原文和冲突选择至结束，避免客户端切换文本后服务端仍按旧快照写入。
- 菜单直接保存为 `meal_slot.menuItems` 快照，不建立独立 menu plan。
- 默认结构先写死为 2 荤 2 素 1 汤。
- 生成只从启用菜品选；“近期”固定为目标日期前 7 个日历日，同周同菜、同日同主料和近期同菜/主料按固定优先级尽量避开，放宽时返回明确说明。
- 菜品池不足时返回明确错误，不发明菜。
- 日历日保存为合法 `YYYY-MM-DD`，统一按 Asia/Shanghai 解释。

### 分享批次

- `booking_batch` 直接 has-many 关联多个 meal slots，不建立连接 collection。
- publicId 使用不可顺序猜测的随机 id，不暴露数据库 id。
- 分享 path 由 `/pages/booking/index?batchId=<publicId>` 派生，不落库。
- 关闭 batch 只关闭这张分享入口；关闭 meal slot 会阻止所有批次继续提交该餐次。
- 关闭不自动取消已有订单。

### 顾客资料

- profile 是“称呼 + 地址”的绑定资料，不拆成自由组合。
- 顾客自己创建 profile 时 openid 必须来自 customer JWT。
- 桃子手动创建的 profile 可以没有 openid；这类资料只在商家侧可见。
- 不按称呼/地址自动绑定 openid。
- 无 openid profile 后续只能通过显式认领/合并流程绑定；MVP 允许顾客先新建一条 openid-bound profile，旧手动订单保持商家侧可见。
- profile 修改不影响订单中的称呼/地址快照；删除是 `active=false`。

### 订单

- 一个 order = 一个 customer profile + 一个 meal slot 的套餐份数。
- 同一 `seller + mealSlot + customerProfile` 只保留一条记录；重复提交和取消后重订复用该记录。
- 顾客提交生成/更新 draft；桃子确认后变 confirmed 并锁单。
- confirmed 才进入备餐、未标到账、未送口径。
- paymentStatus 与 deliveryStatus 直接放在 order 上，互相独立。
- 桃子可修改/取消 confirmed order，但必须提示影响备餐/送餐。
- 手动订单只有在保存了已验证的 customerOpenid 时才会出现在该顾客“我的订单”。
- 桃子进入同一小程序时也有自己的 openid；同一个值可以出现在 operator membership 和她自己的 customer profile/order 中，不发生角色冲突。

## 8. 数据模型摘要

MVP 七个 collection：

```text
kiv1_sellers
kiv1_operators
kiv1_customer_profiles
kiv1_offerings
kiv1_meal_slots
kiv1_booking_batches
kiv1_orders
```

不建立：

- `kiv1_menu_plans`：菜单快照并入 meal slot。
- `kiv1_booking_batch_slots`：batch 直接 has-many meal slots。
- `kiv1_order_items`：套餐份数和单价快照直接在 order。
- `kiv1_fulfillments`：送达状态直接在 order。

完整字段与状态机见 [DATA-MODEL.md](./DATA-MODEL.md)。

## 9. AI 使用

MVP 主链路不使用 AI。

唯一保留的后置入口是审核兜底/迁移工具：

- 输入微信群接龙文本。
- 解析日期、餐次、顾客名、份数。
- 没地址也允许写 order，且不创建 customer profile。
- 必须预览确认后才写库。

如果不启用兜底入口，v1 完全没有 LLM 依赖。

## 10. 测试策略

- `packages/kith-inn-v1-shared`：枚举、日期、金额和实体 schema 单测。
- `packages/kith-inn-v1-payload`：collection 前缀/数量、索引、同 seller relationship guard、seed 单测。
- `apps/cms`：旧 + v1 collection 聚合、同 `cms` schema 共存、seed 编排回归。
- `apps/kith-inn-v1-be`：纯函数、JWT、owner guard、状态机和 Hono route 单测。
- `apps/kith-inn-v1-fe`：逻辑函数单测；H5 关键流 e2e；weapp 真机 smoke。

最小必测：

- 未认证请求不能直接访问 v1 Payload collection。
- 所有 v1 slug/table 使用 `kiv1_` 前缀，旧 collection 不变。
- 跨 v1 seller relationship 被拒绝，包括 batch has-many 和菜单嵌套 offering。
- 同一 openid 可拥有多个 seller membership；operator 登录在多个 seller 时必须显式选择，JWT 只含一个 sellerId。
- 顾客只能看到当前 openid 的 profiles/orders；无 openid 手动资料不暴露。
- closed/archived batch 仍可建立 customer session 并读取自己的历史订单，但不能新增订单；无效 batchId 不能建立 session。
- draft 可由顾客改份数/取消，confirmed 不可改。
- batch/meal slot 关闭后不能新增订单。
- 菜单生成不选停用菜、不发明菜。

所有 milestone 最终通过仓库质量门禁 `pnpm verify`。

## 11. Milestones

### M0：共享 CMS 骨架与数据层

- 新建 `packages/kith-inn-v1-shared` 和 `packages/kith-inn-v1-payload`。
- 建立七个 `kiv1_` collection、索引、关系守卫和幂等桃子 seller/operator seed。
- `apps/cms` 聚合 v1 collections/seed，继续使用同一进程、端口和 `cms` schema。
- 验证旧表与 `kiv1_` 表同 schema 共存，旧 Admin、health、routes 和 seed 不回归。
- 不创建空的 v1 FE/BE workspace。

交付：只启动现有 `apps/cms` 即可看到旧 + v1 collections；M0 不增加 Payload 常驻进程。

### M1：菜单与商家侧订单

- 按 M1-A“operator 登录 + 菜品池”、M1-B“单餐/一周菜单 + 换菜”、M1-C“商家手动订单闭环”三个顺序 PR 交付；后一个只在前一个合并后开始。
- 创建 `apps/kith-inn-v1-be` 和 `apps/kith-inn-v1-fe`。
- 实现 v1 operator 登录和 `/api/internal/kiv1/*` persistence routes。
- 菜品池 CRUD + 批量导入。
- 单餐/多餐菜单生成、换菜。
- 商家手动补单、改单、确认、标记到账、标已送、取消。

交付：不依赖顾客侧，也能让桃子手动跑通“菜单 → 补单 → 确认 → 送达/到账记录”。

### M2：顾客预订登记

- 顾客静默 openid 会话。
- 顾客 profile select/新增/软停用。
- booking batch 创建与分享。
- 顾客提交、改份数、取消 draft。
- confirmed 锁单与顾客只读生命周期。

交付：顾客从分享卡片进入完成预订登记；桃子确认后顾客不可再改。

### M3：体验版验证与审核兜底

- 文案统一为“预订登记”。
- 隐私指引文案与页面提示。
- H5/e2e + weapp 真机体验版 smoke。
- 接龙文案导入兜底入口。

交付：若顾客侧审核风险不可接受，可切换到“微信群接龙 + 老板侧导入订单”。

### M4：发布前收口

- 数据导出/删除能力最小闭环。
- 错误态、空态、截止/关闭态打磨。
- 小程序类目/资质路径确认。
- 建立共享 `apps/cms` migration baseline，停止对真实数据环境使用 schema push。
- `pnpm verify` 全绿。

交付：可提交体验版/审核版。
