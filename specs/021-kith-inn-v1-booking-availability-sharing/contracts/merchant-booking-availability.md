# Contract: 商家营业预订与分享定位

所有商家端点沿用 operator JWT 和 seller scope。

## 设置

- `GET /merchant/booking-settings` → `{ defaultPriceCents }`
- `PATCH /merchant/booking-settings` ← `{ defaultPriceCents }`

## 营业关闭

- `GET /merchant/service-closures?from&to` → `{ docs }`
- `POST /merchant/service-closures` ← `{ date, occasion?, note? }`
- `DELETE /merchant/service-closures/:id`

写入与开放餐次或已有订单冲突时返回 `409`；非法日期、范围或说明返回 `422`。

## 批量餐次状态

`POST /merchant/meal-slots/bulk-booking-status`

```json
{ "mealSlotIds": [11, 12], "action": "open" }
```

响应逐项返回 `updated` 或 `{ id, error, message }`。开放逐项要求完整菜单、明确价格和未来截止时间；停止不取消订单。

## 分享目标和详情

targeted 创建契约增加：

```json
{ "target": { "kind": "meal", "date": "2026-07-27", "occasion": "lunch" }, "mealSlotIds": [11] }
```

日期目标只关联当天已开放餐次；餐次目标只关联该餐。`GET /merchant/booking-batches/:id` 在 `doc.target` 返回可空定位，并附带 share 和实时餐次摘要。公开路径继续使用 `/pages/booking/index?batch=<publicId>`，小程序页面可额外携带非敏感日期/餐次定位参数。

## 兼容约束

- 旧批次缺少 target 时仍可列出、读取和分享。
- 现行 `bookingBatchCreateSchema` 在持久化与路由接线完成前继续拒绝 target；PR2/PR3 端到端保存后切换到 `bookingBatchTargetedCreateSchema`，不得返回 201 后静默丢弃。
- 本功能不改变现有顾客 session 和订单端点；“target 不作为未来访问白名单”是后续顾客端重构必须遵循的业务约束。
