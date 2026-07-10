# 契约：kith-inn-v1 Payload 边界

## Collection 清单

M0 向共享 Payload config 增加且只增加以下 v1 collection：

```text
kiv1_sellers
kiv1_operators
kiv1_customer_profiles
kiv1_offerings
kiv1_meal_slots
kiv1_booking_batches
kiv1_orders
```

字段、关系和状态以 [data-model.md](../data-model.md) 为准。

## Admin 身份

- `apps/cms.admin.user` 继续是旧 `operators`；M0 不修改。
- `kiv1_operators` 不启用 Payload auth，不需要 email/password。
- 已认证共享 CMS Admin 是可信运维身份，可以检查 v1 collections；这项权限不等于 v1 商家/顾客产品权限。
- 上一条只适用于单 v1 seller 的 M0；第二个 seller 上线前必须引入明确的平台管理员边界或关闭共享 Admin 的 v1 全局访问。
- 未认证请求对全部 v1 collection 默认 deny。

## V1 产品身份

- 一条 `kiv1_operators` 记录是一条 seller membership，按 `(seller, wechatOpenid)` 复合唯一；同一 openid 可以属于多个 seller。
- 同一 openid 可以同时绑定 customer profile，operator/customer 由当前入口和 v1 JWT role 区分。
- MVP 的全部 seller 共用一个小程序 AppID；未来接入多个 AppID 前，身份坐标必须增加 appId。
- 桃子手工创建的无 openid customer profile 只在商家侧可用；未来只能显式认领/合并，不按称呼或地址自动绑定。

## Admin 命名

所有 v1 collection 的 Admin group 必须以 `街坊味 v1` 开头，例如：

```text
街坊味 v1 / 平台
街坊味 v1 / 菜单
街坊味 v1 / 预订
街坊味 v1 / 订单
```

## Relationship guard

- 每个 seller-owned v1 collection 的 relationship 必须在写入前检查目标记录 seller。
- `kiv1_booking_batches.mealSlots` 必须逐项检查。
- `kiv1_meal_slots.menuItems[].offering` 是嵌套 relationship，必须显式遍历数组。
- 目标 seller 不一致时整个写入失败，不允许部分保存。
- 关系不得指向无 `kiv1_` 前缀的旧业务 collection。

## 产品 API 边界

- 顾客和桃子的小程序不直接使用共享 Payload Admin token。
- 后续 `apps/kith-inn-v1-be` 使用独立 v1 JWT；operator 登录命中多个 seller 时先选择一个，CMS internal route 再从 claims 推导 role/seller/openid。
- internal route 使用 Payload local API `overrideAccess` 时，必须显式验证记录 owner、状态机和跨 seller 引用。
- v1 internal route/header/secret 必须使用独立命名，不复用旧 kith-inn 的 route 或 JWT。

## Seed 边界

- v1 普通 seed 幂等，只创建 `kiv1_sellers` 和 `kiv1_operators`。
- v1 seed 不查询、修改或删除旧 collection。
- 共享 `apps/cms` seed 只负责依次调用各 package 的 seed/reset，不包含项目业务 fixture。
- destructive reset 继续受 `KITH_INN_ALLOW_DEV_SEED_RESET=1` 和本地数据库检查保护；每个 package 只返回自己的 FK-safe collection 顺序。
