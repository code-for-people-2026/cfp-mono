# 契约：共享 CMS 装配

## Payload config

`apps/cms/payload.config.ts` 只做集合聚合：

```text
old kith-inn collections
  + kith-inn-v1 collections
  = shared Payload collections
```

装配必须保持：

- 数据库 adapter、连接环境变量和 `schemaName = "cms"` 不变。
- `admin.user = "operators"` 不变。
- `onInit: ensureConstraints` 的旧约束逻辑不变；M0 v1 只使用 Payload 可表达的普通索引。
- REST/GraphQL/Admin 路由不变。
- 健康检查继续返回现有 `{ "status": "ok" }`。
- 本地/生产端口继续为 3304。

## package 依赖

`apps/cms` 新增且只新增以下 v1 workspace 依赖：

```text
@cfp/kith-inn-v1-payload: workspace:*
```

`@cfp/kith-inn-v1-shared` 由 payload package 传递使用，CMS host 不直接 import 业务 schema。

## Seed 编排

单一命令保持不变：

```bash
pnpm --filter @cfp/cms seed
```

执行顺序：

1. 旧 kith-inn `applySeed`。
2. kith-inn-v1 `applySeed`。
3. 分别输出 seeded/skipped 结果。

重复执行不得清空数据。显式 reset 时，先按各 package 的 FK-safe 顺序删除，再分别 seed；reset 安全守卫仍只在 `apps/cms/seed/run.ts` 维护一份。

## 数据库验收

- 旧表继续位于 `cms` schema。
- 七个 v1 主表也位于 `cms` schema，表名以 `kiv1_` 开头。
- `public` 和 `website` schema 不出现 `kiv1_` 表。
- v1 不新增第二张 Payload migration metadata 表；共享 config 统一管理 schema 生命周期。
