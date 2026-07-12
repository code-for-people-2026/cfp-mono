# 内部 API 契约：订单快照与增量对账

端点只供 kith-inn-be 调用，继续要求 `x-kith-inn-operator`；seller/operator 从已验证 JWT 推导。请求中的 customer/order/offering 都必须再次校验属于当前 seller。

## 原子应用对账

`POST /api/internal/orders/reconcile`

请求由服务端 pending 预览构造，包含：

```json
{
  "mode": "snapshot",
  "operationKey": "opaque-random-operation-key",
  "scope": [{ "date": "2026-07-13", "occasion": "lunch" }],
  "expectedFingerprint": "opaque-stable-fingerprint",
  "candidates": [
    {
      "customer": 12,
      "date": "2026-07-13",
      "occasion": "lunch",
      "quantity": 2,
      "offering": 9,
      "unitPriceCents": 3000,
      "totalCents": 6000
    }
  ]
}
```

新顾客候选可使用经确认卡补全的 `newCustomer: { displayName, address? }` 替代 `customer`；CMS 在同一事务创建顾客和订单。#156 会进一步收紧缺地址写入守卫。

increment 请求额外携带 `operation: add | set`。`quantity` 在 add 时是增加量，在 set/snapshot 时是最终数量。

## 事务行为

CMS 在一个事务中：

1. 读取 scope 内所有 active orders、items 与必要 fulfillment，生成稳定 fingerprint。
2. 与 `expectedFingerprint` 比较；不同则不写入并返回 `stale-preview`。
3. 校验候选坐标属于 scope、customer/offering 租户归属、数量和价格。
4. snapshot 计算 scope 全集差异；increment 只计算唯一坐标。
5. 创建新 draft、替换 existing items/total、取消退出项并同步 fulfillment。
6. 为实际变化的订单写入由 operationKey 派生的坐标级 idempotencyKey，全部成功后一次提交；任一步失败全部回滚。

成功 `200`：

```json
{
  "ok": true,
  "created": [{ "orderId": 101 }],
  "updated": [{ "orderId": 90, "beforeQuantity": 1, "afterQuantity": 2 }],
  "canceled": [{ "orderId": 88 }],
  "unchanged": [{ "orderId": 87 }]
}
```

## 错误

- `400 invalid-reconciliation`：模式、scope、候选、数量或 operation 非法。
- `403 not-owned`：customer/order/offering 不属于当前 seller。
- `409 stale-preview`：不同 operationKey 下目标 active 集合或任一相关订单在预览后变化；BE 清除旧 pending 并提示重新预览。
- `409 inconsistent-order`：existing active order 不满足既有 order/items/fulfillment 一致性。
- `5xx`：事务回滚或结果未知；相同 operationKey 可安全重试，若首次已提交则返回 `alreadyApplied=true`，不得重复增加数量。

## 指纹规范

指纹输入按业务坐标排序，至少包含每张 active order 的：

- `id`、`customer id`、`date`、`occasion`
- `status`、`paymentStatus`、`updatedAt`
- 按 id 排序的 items：`id`、`offering id`、`quantity`、`unitPriceCents`

指纹为内部 opaque 值，FE 不解析。新增/取消/付款/数量变化都会使旧卡失效。

## 确认卡契约

snapshot 行类型：`create | update | cancel | unchanged`；increment 行类型：`create | add | set`。每行展示日期、餐次、顾客及最终数量；update/add/set 展示当前值和运算。确认卡不展示或区分订单录入来源；涉及未结算 confirmed 时显示“会同步影响备餐、送餐和收款口径”。若 update/cancel 命中 paid/reconciled 或 fulfillment=done，预览失败关闭；确认阶段再次校验并返回 `settled-order`，整次不写入。
