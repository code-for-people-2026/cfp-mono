# 验证指南：kith-inn 缺地址确认守卫

## 前置条件

- Node.js、pnpm 按仓库基线安装。
- 真实事务测试先运行 `pnpm db:up`，使用 kith-inn PostgreSQL。
- 只创建/检查 kith-inn 数据，不操作 `kith-inn-v1` 或 `kiv1_*`。

## PR1：确认守卫

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54324/cfp PAYLOAD_SECRET=test-secret pnpm --filter @cfp/cms test -- tests/order-atomicity.test.ts
pnpm --filter @cfp/kith-inn-be test
pnpm verify
```

准备 null、空字符串、纯空白和有效地址四张 draft，从订单 route 与 Agent 口头入口确认。前三张均得到“请先补地址”，status/slot/fulfillment 零变化；有效地址订单沿用既有确认结果。

## PR2：CMS 原子补地址

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54324/cfp PAYLOAD_SECRET=test-secret pnpm --filter @cfp/cms test -- tests/order-atomicity.test.ts
pnpm verify
```

验证：

1. 缺地址 draft 补为 `3A-2701` 后，目标 order 与 customer 地址相同，另一张历史 order 不变。
2. 在 customer/order 任一步注入失败，两处均保持旧值。
3. 相同地址重复请求返回既有结果；不同地址、非 draft、空白输入和跨 seller id 均失败关闭。
4. 用一个受控并发请求同时执行补地址与确认；无论执行顺序如何，最终都不出现 confirmed+空地址或重复 fulfillment。
5. 直接调用 CMS 通用订单 PATCH 发送 `{address: "旁路"}`，请求被拒绝且订单快照不变。

## PR3：BE 补地址适配

```bash
pnpm --filter @cfp/kith-inn-be test
pnpm verify
```

验证 operator JWT、trim 后 body、CMS 响应透传，以及 `invalid-address`、`not-found`、`not-draft`、`address-present` 和未知失败的稳定映射；BE 不自行连续写 customer/order，通用订单 PATCH 也不会把 `address` 等禁用字段透传给 CMS。

## PR4：订单页闭环

缺地址 draft 行显示“待补地址”、地址输入和“保存地址”；空白保存不发请求，成功保存刷新为普通地址行，再点击既有“确认订单”进入送餐清单。后端 `missing-address` 文案直接显示，不降级成“操作失败”。

```bash
pnpm --filter @cfp/kith-inn-fe test
pnpm verify
```

## PR5：订单录入确认卡与最终验收

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-fe test
pnpm verify
```

新客无输入、既有顾客无默认地址、顾客有默认地址但 active order 快照为空三类候选都显示“待补地址”；有有效快照/默认地址时不误报。卡片仍能保存缺地址 draft；新客填入有效地址后提示消失。

最终运行：

```bash
pnpm verify
git diff --check
git diff --name-only origin/main...HEAD | rg 'kith-inn-v1|kiv1' && exit 1 || true
```

预期全仓门禁通过、无 v1 文件变化，并逐项核对 [spec.md](./spec.md) 的 SC-001–SC-006。
