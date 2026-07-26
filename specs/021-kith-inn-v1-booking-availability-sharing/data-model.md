# Data Model: 营业预订与分享定位

## SellerBookingSettings

- `sellerId`: 当前租户。
- `defaultPriceCents`: 非负整数；仅作未开放餐次的默认模板。

## MealSlot

沿用 `date + occasion`、五项菜单、`priceCents`、`orderDeadline`、`orderStatus`。开放必须有明确价格和未来截止时间；停止不取消已有订单；停止后在截止前允许重新开放。

顾客展示派生状态：`hidden | bookable | deadline-passed | stopped`。`draft` 为 hidden；`open` 按截止时间派生；`closed` 为 stopped。

## ServiceClosure

- `id`、`sellerId`
- `date`: 营业日期
- `occasion`: `null | lunch | dinner`；null 表示整天
- `note`: 可选短说明

约束：整天目标使用 `UNIQUE (seller, date) WHERE occasion IS NULL`，单餐目标使用 `UNIQUE (seller, date, occasion) WHERE occasion IS NOT NULL`；整天与单餐互斥，且与对应开放 MealSlot、已有订单冲突。打烊、开放/恢复餐次和顾客订单写入必须共享 seller/date 级事务锁并做并发测试，不能依赖先查后写。

## BookingShareTarget

- `{ kind: day, date }`
- `{ kind: meal, date, occasion }`

新 BookingBatch 保存目标并继续拥有随机 `publicId`、标题、状态和关联餐次。旧批次目标为空时由关联餐次兼容展示；目标用于定位，不改变 seller 和 MealSlot 的业务校验。

## 状态优先级

1. 整天 ServiceClosure 覆盖当日午晚餐。
2. 某餐 ServiceClosure 覆盖对应餐次。
3. 没有关闭记录时按 MealSlot 派生展示。
4. 没有 MealSlot 或仅 draft 时隐藏。
