# Quickstart：验证街坊味 v1 商家核心闭环

## 1. 前置条件

- Node.js 20+
- pnpm 10.2
- Docker/PostgreSQL
- 本地环境只使用测试数据；M4 migration baseline 前不要写入需长期保留的真实订单

## 2. 环境

```bash
pnpm install
pnpm db:up
```

`apps/cms/.env` 与 `apps/kith-inn-v1-be/.env` 使用相同的独立 v1 secrets：

```text
KITH_INN_V1_JWT_SECRET=<local-secret>
KITH_INN_V1_INTERNAL_TOKEN=<local-service-secret>
```

BE 另配置：

```text
CMS_BASE_URL=http://localhost:3304
WX_APPID=<weapp smoke only>
WX_SECRET=<weapp smoke only>
KITH_INN_V1_ALLOW_DEV_LOGIN=1
BE_PORT=3311
```

FE H5 默认访问 `http://localhost:3311`，dev server 使用 10087；真机 weapp 通过构建环境指定可访问的 BE URL，不使用 localhost。

## 3. M1-A：登录与菜品池

1. 初始化共享 seed：

```bash
pnpm --filter @cfp/cms seed
```

2. 启动 CMS、v1 BE、v1 H5：

```bash
pnpm --filter @cfp/cms dev
pnpm --filter @cfp/kith-inn-v1-be dev
pnpm --filter @cfp/kith-inn-v1-fe dev:h5
```

3. 打开 `http://localhost:10087`：

- 显式 dev login 进入桃子唯一 seller。
- 创建、编辑、停用、恢复菜品。
- 粘贴包含 valid/invalid/conflict 的文本，确认 preview 无写入。
- conflict 默认 skip，显式 overwrite 后逐行结果正确。
- 未绑定 openid、另一个 seller id、被停用 membership 均不能读取桃子数据。

## 4. M1-B：菜单

- 准备至少 4 个 meat、4 个 veg、2 个 soup active offerings。
- 生成一个 lunch，确认恰好 2/2/1、无停用/重复菜、保存 snapshot。
- 生成 5 个工作日 lunch+dinner；足量时无同周同菜和同日同主料。
- 对已有 target 再生成先返回 conflict；确认 replace 后只有一条 slot。
- 换一道菜只改变目标项；无候选时原菜单不变。

## 5. M1-C：订单

### M1-C1：顾客资料与草稿补单

- 新建无 openid 的“王阿姨 · 3A-1201” profile 和 manual draft order。
- 重复补同一 profile+slot 得到 conflict，不新增。
- 明确选择更新后仍复用同一 order id；修改 draft 后刷新数据一致。

### M1-C2：订单生命周期

- 确认 draft 后汇总增加；再标 paid、done 并验证时间。
- confirmed 编辑需要二次确认；取消后退出汇总。
- canceled 普通操作拒绝；明确 resubmit 后同一 id 回到 draft 且时间/付款/送达重置。

### M1-C3：批量与清单

- 批量 mark-delivered 只改选中且 confirmed 的当前 seller orders。
- 复制清单只含 confirmed active orders。

## 6. 自动化验证

每个实现 PR 至少运行：

```bash
pnpm --filter @cfp/kith-inn-v1-shared test:coverage
pnpm --filter @cfp/kith-inn-v1-be test:coverage
pnpm --filter @cfp/kith-inn-v1-fe test:coverage
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54324/cfp \
PAYLOAD_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54324/cfp \
PAYLOAD_SECRET=test-secret \
KITH_INN_V1_JWT_SECRET=test-v1-secret \
KITH_INN_V1_INTERNAL_TOKEN=test-v1-internal \
pnpm --filter @cfp/cms test
pnpm --filter @cfp/kith-inn-v1-fe test:e2e
pnpm verify
```

## 7. Weapp smoke

- 构建 `pnpm --filter @cfp/kith-inn-v1-fe build:weapp`。
- 微信开发者工具中验证真实 `wx.login`；失败时只显示错误，不自动 fallback dev login。
- 验证登录、菜品、菜单、订单四个商家页面；M1 不出现顾客/分享/AI/支付入口。

## 8. 完成判定

- M1-A/B 与 M1-C1/C2/C3 各自 quickstart 和 H5 关键流通过。
- old + v1 CMS 共存、旧 routes/Admin/health 继续通过。
- 所有 tenant negative path fail closed。
- 新增 workspace 都承载实际页面/route，没有空壳或预建 M2 目录。
- `pnpm verify` 和 Codex review 闭环通过。
