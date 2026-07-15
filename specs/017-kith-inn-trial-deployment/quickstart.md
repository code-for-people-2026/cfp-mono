# Quickstart: 验证 kith-inn 桃子体验版交付

本指南描述全部实现 PR 合并后的标准验收入口；PR1 阶段命令中的新增 script/workflow 尚未实现。只使用占位变量名，禁止在 shell history、日志或截图中粘贴真实 secret。

## 1. 仓库与生产构建门禁

```bash
pnpm verify
: "${KITH_INN_BE_BASE_URL:?请从外部注入已备案且已配置 TLS 的真实 HTTPS BE URL}"
release_sha="$(git rev-parse HEAD)"
BE_BASE_URL="$KITH_INN_BE_BASE_URL" pnpm --filter @cfp/kith-inn-fe build:h5
BE_BASE_URL="$KITH_INN_BE_BASE_URL" pnpm --filter @cfp/kith-inn-fe build:weapp
docker build --build-arg RELEASE_SHA="$release_sha" \
  -f apps/cms/Dockerfile -t kith-inn-cms:verify .
docker build --target jobs --build-arg RELEASE_SHA="$release_sha" \
  -f apps/cms/Dockerfile -t kith-inn-cms-ops:verify .
docker build --build-arg RELEASE_SHA="$release_sha" \
  -f apps/kith-inn-be/Dockerfile -t kith-inn-be:verify .
docker build -f apps/kith-inn-fe/Dockerfile \
  --build-arg RELEASE_SHA="$release_sha" \
  --build-arg BE_BASE_URL="$KITH_INN_BE_BASE_URL" \
  -t kith-inn-h5:verify .
RELEASE_SHA="$release_sha" \
  KITH_INN_CMS_IMAGE=kith-inn-cms:verify \
  KITH_INN_CMS_OPS_IMAGE=kith-inn-cms-ops:verify \
  KITH_INN_BE_IMAGE=kith-inn-be:verify \
  KITH_INN_H5_IMAGE=kith-inn-h5:verify \
  bash deploy/verify-kith-inn-images.sh
```

预期：外部变量为空或不是已备案、已配置 TLS 的合法 HTTPS host 时，上述参数检查/构建校验立即失败；成功时四个镜像与 weapp 产物均可关联当前 SHA。再对 `https://api.example.invalid`（仅负例）、HTTP、IP、localhost、局域网 URL 运行前端配置窄测，全部必须在构建前失败；不要把真实域名写入仓库。

## 2. Schema 与桃子基线

在一次性 PostgreSQL 中运行 CMS migration 集成测试，并分别验证 fresh DB、已迁移 DB、seed 重跑和中途失败恢复：

```bash
pnpm --filter @cfp/cms test -- migration-production seed-production
pnpm --filter @cfp/cms test:coverage
```

预期：`cms` migration head 一致；第二次 seed 不产生重复 seller/offering/operator；真实 OpenID用测试占位 secret 注入且不出现在输出；所有 reset 入口在生产 env 下拒绝。

## 3. 本地生产等价编排

使用仓库提交的假值模板生成被忽略的本地验证 env，再按本机环境覆盖；不得修改模板或复用 GitHub Production secret：

```bash
cp deploy/.env.verify.example deploy/.env.verify
# 仅在 deploy/.env.verify 写本地验证覆盖；该文件不得提交
export KITH_INN_CMS_IMAGE="$(docker image inspect --format '{{.Id}}' kith-inn-cms:verify)"
export KITH_INN_CMS_OPS_IMAGE="$(docker image inspect --format '{{.Id}}' kith-inn-cms-ops:verify)"
export KITH_INN_BE_IMAGE="$(docker image inspect --format '{{.Id}}' kith-inn-be:verify)"
export KITH_INN_H5_IMAGE="$(docker image inspect --format '{{.Id}}' kith-inn-h5:verify)"
WEBSITE_ENV_FILE=./.env.website.verify.example docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.kith-inn.prod.yml --env-file deploy/.env.verify config --quiet
bash deploy/verify-kith-inn-compose.sh deploy/.env.verify
bash deploy/verify-nginx-example.sh
# 指定 kith-inn 叶子服务，只按依赖启动本项目，不拉取或重启独立 website。
WEBSITE_ENV_FILE=./.env.website.verify.example docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.kith-inn.prod.yml --env-file deploy/.env.verify up -d kith-inn-h5
RELEASE_SHA="$release_sha" bash deploy/smoke-test.sh kith-inn
```

预期：CMS/BE liveness+readiness、H5 静态入口、operator lookup、短时 JWT 与只读 offerings 全绿，写入变化为 0。随后制造缺 token、DB 不可达、错误 migration head 和失效 operator，候选均不得标记健康。

## 4. 受控部署与回滚演练

1. 在 GitHub `Production` Environment 由维护者配置 issue #158 列出的缺失 secrets/variables；只核对名称与存在性，不回显值。
2. 手动触发 `deploy-production.yml` 的 kith-inn target，指定最新 main SHA。
3. 核对 migration 前可恢复 RDS 备份的非敏感 ID/时间、ACR digest、单次 migration、幂等 seed、Compose health 和部署后 smoke 均绑定该 SHA。
4. 下载该 run 成功末尾生成的 `smoke-passed.json` artifact，核对 SHA、run ID、CMS runtime/CMS ops/BE/H5 四镜像 digest、migration head、backup ID/时间和 passed 状态；失败 run 不得存在该 artifact。
5. 在候选健康后执行一次受控服务失败，按 `deploy/RUNBOOK.md` 回滚至上一 digest；记录耗时和 schema 处置，目标 ≤15 分钟。

缺少备案/微信合法域名、TLS、任一 secret 或 smoke 失败时必须停在这里，不上传体验版。

## 5. 体验版上传

先执行无外部写入的 dry-run：

```bash
: "${KITH_INN_BE_BASE_URL:?请从外部注入已备案且已配置 TLS 的真实 HTTPS BE URL}"
BE_BASE_URL="$KITH_INN_BE_BASE_URL" \
  pnpm --filter @cfp/kith-inn-fe upload:weapp -- \
  --version 0.0.0 --desc "trial-<short-sha>" --dry-run
```

实际上传只通过 `release-kith-inn-weapp.yml`：选择第 4 步已通过部署的 main SHA，由 workflow 查询并下载该 SHA 的 `smoke-passed.json`，逐字段验证后经 Environment 审批运行；手填 SHA 不是通过凭据。预期上传日志不显示私钥/OpenID，微信版本说明和构建摘要可关联同一 SHA；桃子已加入体验成员，请求合法域名与上传 IP 白名单均开启。

## 6. 桃子白名单真机验收

在真机保持域名校验开启，按 [发布契约](./contracts/release-contract.md) 记录脱敏证据：

1. 打开指定体验版并用桃子微信成功登录，确认只见自己的 seller 数据。
2. 粘贴接龙并确认预览、草稿与订单。
3. 生成菜单，换一道菜并发布。
4. 将目标订单标已付，选择目标履约并批量送达。
5. 核对最终订单、菜单、收款、履约状态；不得截图顾客姓名、地址、OpenID或 token。

全部步骤成功才把 Release Candidate 标为 `device_accepted`。任一步失败均为 `rejected`，修复/重新部署后从登录开始完整复验，不沿用旧成功证据。
