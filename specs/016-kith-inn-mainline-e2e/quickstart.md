# Quickstart: kith-inn 主链路真实 E2E 与 CMS 集成验证

## 1. 前置条件

- Node.js 22
- pnpm 10.2.0
- Docker（本地 PostgreSQL）
- 已执行 `pnpm install --frozen-lockfile`

本 suite 不需要真实 DeepSeek key、微信 code、微信群或支付账户。固定外部模型服务由测试编排启动；CMS/BE/业务校验仍使用生产代码。

## 2. 启动本地 PostgreSQL

```bash
pnpm db:up
```

默认测试连接：

```text
postgresql://postgres:postgres@127.0.0.1:54324/cfp
```

项目级 reset 仍需 `KITH_INN_ALLOW_DEV_SEED_RESET=1`，并且只允许 localhost 与非 production/staging/preview 环境。mainline Playwright config 将设置测试所需 env，不要手工执行全库 reset。

## 3. 运行 CMS/PostgreSQL 租户证据

PR2 落地后的目标命令：

```bash
PAYLOAD_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54324/cfp \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54324/cfp \
PAYLOAD_SECRET=mainline-e2e-payload-secret \
PAYLOAD_DB_PUSH=true \
KITH_INN_ALLOW_DEV_SEED_RESET=1 \
pnpm --filter @cfp/cms exec vitest run tests/kith-inn-mainline-integration.test.ts
```

期望：双 seller internal route/relationship 矩阵与 v1 sentinel 均通过；没有 PostgreSQL 时不得用 SQLite 结果替代。

## 4. 运行 H5 主链路

PR3 落地后的 package 命令：

```bash
CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e:mainline
```

最终根级发现验证：

```bash
CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e
```

期望：先保留 #185 快速换菜回归，再运行 PostgreSQL mainline；mainline 包含登录、接龙、订单、菜单、收款、送达以及失败/重试边界。

## 5. 验证 affected 选择

实现阶段使用与 `.github/workflows/ci.yml` 相同的 `origin/main...HEAD` changed-path 逻辑做 dry-run，记录实际 `test:e2e` task。至少验证：

- 旧 kith-inn BE/CMS/order helper 变化会选中 `@cfp/kith-inn-fe`。
- 纯 v1 或 website 业务变化不会误选旧 kith-inn FE。
- 共享 CMS host/config 同时选中两套时 `--concurrency=1` 生效。

PR5 使用不修改工作树的 synthetic Git tree 逐类执行 workflow 等价 dry-run：旧 kith FE、BE、CMS menu route、`packages/kith-inn-shared` 与 mainline helper 均选中 `@cfp/kith-inn-fe#test:e2e`；纯 v1 只选 v1 suite，纯 website/community-cooking 只选各自 suite；共享 `apps/cms/payload.config.ts` 同时选中旧/v1 条件，最终仍由 `--concurrency=1` 串行。

## 6. 全量门禁

```bash
pnpm verify
git diff --check
```

PR5 合并前，连续运行 mainline 3 次并记录每次耗时与结果。失败 trace/report/service log 应位于 [场景契约](./contracts/e2e-scenarios.md#5-证据契约) 指定目录并被 CI artifact 收集。

PR5 最终证据（2026-07-14）：

- `CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e:mainline` 连续三次均为 4/4，通过耗时 21s、21s、22s。
- 停止 PostgreSQL 的受控 webServer failure 会先清空 service 目录，只留下本次 `cms.log`，其中明确记录 `ECONNREFUSED 127.0.0.1:54324`。
- 受控 assertion failure 生成场景 `trace.zip`、`error-context.md`、HTML report，以及 CMS/BE/H5/fixed-LLM/fixed-LLM-request 日志；临时失败断言已还原。
- 根入口使用 `pnpm turbo run test:e2e --dry=json` 枚举所有 workspace E2E target；CI affected 命令再按上述路径矩阵缩小实际执行集合。

## 7. 本地清理

需要停止仓库 PostgreSQL 时：

```bash
pnpm db:down
```

不要在有其他本地任务依赖该容器时执行；测试自身只 reset kith-inn 项目数据，不负责停止共享容器。
