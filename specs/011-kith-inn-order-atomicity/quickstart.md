# 验证指南：kith-inn 订单写入与生命周期原子性

## 前置条件

- Node.js、pnpm 已按仓库基线安装。
- 真实约束验证需要 Docker 可用，并通过 `pnpm db:up` 启动 PostgreSQL。
- 测试数据使用 kith-inn collection，不操作任何 `kiv1_*` collection。

## 快速自动化验证

```bash
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/cms test
pnpm verify
```

预期：BE client/service/route 测试全绿；CMS 在有 `DATABASE_URL` 时验证事务与唯一索引；全仓 lint、typecheck、100% coverage、knip、build 全绿。

## 场景 1：草稿中途失败

1. 构造含至少两条 item 的草稿。
2. 在第二条 item create 注入异常。
3. 查询相同 seller/customer/date/occasion。

预期：没有 order 与 order_items；移除故障后相同请求成功且 items 完整。

## 场景 2：确认失败与重试

1. 创建完整 draft。
2. 分别在 slot、fulfillment、order status 写入处注入异常。
3. 每次失败后读取 order、slot、fulfillment，再用同一 order id 重试。

预期：失败后只观察到原始完整 draft 且无新增经营副作用；重试成功后为 confirmed、slot open、恰好一条 pending fulfillment。

## 场景 3：重复与并发确认

1. 对同一 draft 近同时发送两次 confirm。
2. 完成后再重复 confirm，并执行至少 100 次混合重试序列。

预期：最终始终一张 confirmed order、一个业务坐标 slot、最多一条 fulfillment；成功后的重复请求返回已完成结果。

## 场景 4：取消失败与重试

1. 准备 confirmed order 与 pending fulfillment。
2. 在 fulfillment 或 order 更新处注入异常并取消。
3. 读取状态，移除故障后重复取消两次。

预期：失败不产生半取消；成功后 order 与 fulfillment 同为 canceled；再次取消仍返回成功且不新增记录。

## 场景 5：归档餐次

1. 准备 draft，并把同坐标 slot 设为 archived。
2. 确认订单。

预期：返回 `slot-archived`；order 仍为 draft，slot 仍 archived，不存在 fulfillment。
