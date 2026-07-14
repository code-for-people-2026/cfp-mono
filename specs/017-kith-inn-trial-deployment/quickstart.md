# Quickstart: 验证 kith-inn 桃子体验版交付

本指南描述全部实现 PR 合并后的标准验收入口；PR1 阶段命令中的新增 script/workflow 尚未实现。只使用占位变量名，禁止在 shell history、日志或截图中粘贴真实 secret。

## 1. 仓库与生产构建门禁

```bash
pnpm verify
BE_BASE_URL=https://api.example.invalid pnpm --filter @cfp/kith-inn-fe build:h5
BE_BASE_URL=https://api.example.invalid pnpm --filter @cfp/kith-inn-fe build:weapp
docker build -f apps/cms/Dockerfile -t kith-inn-cms:verify .
docker build -f apps/kith-inn-be/Dockerfile -t kith-inn-be:verify .
docker build -f apps/kith-inn-fe/Dockerfile -t kith-inn-h5:verify .
```

预期：四类产物均成功且可关联当前 SHA。再对缺失、HTTP、IP、localhost、局域网 URL 运行前端配置窄测，全部必须在构建前失败；不要把真实域名写入仓库。

## 2. Schema 与桃子基线

在一次性 PostgreSQL 中运行 CMS migration 集成测试，并分别验证 fresh DB、已迁移 DB、seed 重跑和中途失败恢复：

```bash
pnpm --filter @cfp/cms test -- migration-production seed-production
pnpm --filter @cfp/cms test:coverage
```

预期：`cms` migration head 一致；第二次 seed 不产生重复 seller/offering/operator；真实 OpenID用测试占位 secret 注入且不出现在输出；所有 reset 入口在生产 env 下拒绝。

## 3. 本地生产等价编排

使用只含假值的本地验证 env，不复用 GitHub Production secret：

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.verify config
nginx -t -c "$PWD/deploy/nginx.example.conf"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.verify up -d
bash deploy/smoke-test.sh kith-inn
```

预期：CMS/BE liveness+readiness、H5 静态入口、operator lookup、短时 JWT 与只读 offerings 全绿，写入变化为 0。随后制造缺 token、DB 不可达、错误 migration head 和失效 operator，候选均不得标记健康。

## 4. 受控部署与回滚演练

1. 在 GitHub `Production` Environment 由维护者配置 issue #158 列出的缺失 secrets/variables；只核对名称与存在性，不回显值。
2. 手动触发 `deploy-production.yml` 的 kith-inn target，指定最新 main SHA。
3. 核对 ACR digest、单次 migration、幂等 seed、Compose health 和部署后 smoke 均绑定该 SHA。
4. 在候选健康后执行一次受控服务失败，按 `deploy/RUNBOOK.md` 回滚至上一 digest；记录耗时和 schema 处置，目标 ≤15 分钟。

缺少备案/微信合法域名、TLS、任一 secret 或 smoke 失败时必须停在这里，不上传体验版。

## 5. 体验版上传

先执行无外部写入的 dry-run：

```bash
BE_BASE_URL=https://api.example.invalid \
  pnpm --filter @cfp/kith-inn-fe upload:weapp -- \
  --version 0.0.0 --desc "trial-<short-sha>" --dry-run
```

实际上传只通过 `release-kith-inn-weapp.yml`：选择第 4 步已 `smoke_passed` 的 main SHA，经 Environment 审批后运行。预期上传日志不显示私钥/OpenID，微信版本说明和构建摘要可关联同一 SHA；桃子已加入体验成员，请求合法域名与上传 IP 白名单均开启。

## 6. 桃子白名单真机验收

在真机保持域名校验开启，按 [发布契约](./contracts/release-contract.md) 记录脱敏证据：

1. 打开指定体验版并用桃子微信成功登录，确认只见自己的 seller 数据。
2. 粘贴接龙并确认预览、草稿与订单。
3. 生成菜单，换一道菜并发布。
4. 将目标订单标已付，选择目标履约并批量送达。
5. 核对最终订单、菜单、收款、履约状态；不得截图顾客姓名、地址、OpenID或 token。

全部步骤成功才把 Release Candidate 标为 `device_accepted`。任一步失败均为 `rejected`，修复/重新部署后从登录开始完整复验，不沿用旧成功证据。
