# CMS 本地开发

`apps/cms` 共享承载多个产品的 Payload collections，但 seed 与开发重置必须始终按项目隔离。仓库有意不提供“seed/reset 整个 CMS”的入口。

## 项目级 seed

在仓库根目录运行：

```bash
pnpm --filter @cfp/cms seed:kith-inn
pnpm --filter @cfp/cms seed:kiv1
```

前者只访问 kith-inn collections，后者只访问 `kiv1_*` collections；两者都保持幂等。

## 项目级开发重置

重置会删除目标项目的本地开发数据并重新 seed，但不会访问另一项目：

```bash
KITH_INN_ALLOW_DEV_SEED_RESET=1 pnpm --filter @cfp/cms seed:kith-inn:reset:dev
KITH_INN_ALLOW_DEV_SEED_RESET=1 pnpm --filter @cfp/cms seed:kiv1:reset:dev
```

破坏性命令必须显式设置 `KITH_INN_ALLOW_DEV_SEED_RESET=1`，只接受 localhost / loopback PostgreSQL 或 SQLite fallback，并拒绝 production、staging、preview 与 Vercel 环境。没有无项目名的 `seed`、`seed:reset:dev` 或 `reset:all` 命令；需要处理两个项目时必须分别运行并逐次确认作用域。
