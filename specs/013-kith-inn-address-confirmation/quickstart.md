# 验证指南：kith-inn 配送地址选填与自动带出

## 前置条件

- Node.js、pnpm 按仓库基线安装。
- 真实事务测试先运行 `pnpm db:up`，使用 kith-inn PostgreSQL。
- 只创建/检查 kith-inn 数据，不操作 `kith-inn-v1` 或 `kiv1_*`。

## PR0R：规格纠正

```bash
git diff --check
rg -n '缺地址订单不能|缺地址.*拒绝确认|HTTP 409.*missing-address|请先补地址再确认订单' specs/013-kith-inn-address-confirmation --glob '!quickstart.md'
```

第二条命令预期无结果。逐项确认 [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[契约](./contracts/address-confirmation.md) 和 [tasks.md](./tasks.md) 都把地址定义为选填。

## PR1：订单快照 PATCH 边界

```bash
pnpm --filter @cfp/cms test -- 'src/app/api/internal/orders/[id]/route.test.ts'
pnpm --filter @cfp/kith-inn-be test -- src/routes/orders.test.ts
pnpm verify
```

验证 BE/CMS 通用 PATCH 对 `address`、`status`、`customer`、`seller` 和未知字段都不透传；仅含禁用字段时 400，混合请求只应用普通字段，原订单地址快照不变。

## PR2：回归证据与长期文档

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54324/cfp PAYLOAD_SECRET=test-secret pnpm --filter @cfp/cms test -- tests/order-atomicity.test.ts tests/order-reconciliation.test.ts
pnpm --filter @cfp/kith-inn-be test -- src/routes/chat.test.ts
pnpm verify
```

验证场景：

1. 新顾客地址留空，创建出的 customer/order 地址均为空；该 draft 仍可确认并产生一个 fulfillment。
2. 新顾客首次填写 `3A-2701`，本次 customer/order 都保存该值。
3. 下一次独立接龙只按同一顾客名字记单，不再提供地址；新 order 自动得到 `3A-2701`。
4. 顾客默认地址改变后，旧 order 地址保持不变，之后创建的 order 使用新值。
5. 无地址 fulfillment 仍出现在“（无地址）”分组，既有送达流程不受影响。
6. Agent 对新顾客明确说地址选填，不再要求“填好地址”才确认。

最终运行：

```bash
git diff --check
git diff --name-only origin/main...HEAD | rg 'kith-inn-v1|kiv1' && exit 1 || true
```

预期全仓门禁通过、无 v1 文件变化，并逐项核对 [spec.md](./spec.md) 的 SC-001–SC-005。
