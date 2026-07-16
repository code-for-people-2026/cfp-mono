# 部署运维手册（Runbook）

> ⚠️ 本仓库为**公开仓库**。此文档**不得**写入真实的服务器 IP、数据库地址、实例 ID、密钥等敏感信息。具体数值请保存在私密笔记中，这里只用占位符。

把 `apps/website` 部署到阿里云 ECS（地域：华南/深圳），通过 GitHub Actions 实现 push → 自动构建 → 部署。早期的 `apps/site` 试验站已退役，website 复用其 ECS / ACR / RDS 流水线。

## 1. 架构分层（先理解这个就不会乱）

```
┌─ 阿里云账号层（云资源）──── 用 aliyun CLI / 控制台管
│   ECS、RDS(PostgreSQL)、ACR(镜像仓库)、安全组、DNS(云解析)、备案
│
├─ 服务器 OS 层（ECS 内部）── 系统包 + 宝塔面板
│   nginx 反向代理 + SSL、Docker、监控、日志
│
└─ 应用交付层（构建+上线）──── GitHub Actions
    跑测试 → 构建镜像 → 推 ACR → SSH 到 ECS → docker compose up → 冒烟
```

- **宝塔**：本机这台 ECS 的网页管理后台（看容器/日志/监控）。注意宝塔防火墙与阿里云安全组是**两层**，放行端口两边都要开。
- **nginx**：用系统包 `dnf install nginx` 安装（**不是**宝塔的 nginx，二者只能留一个，否则抢 80 端口）。

## 2. 线上资源（数值见私密笔记，这里只列形态）

| 资源 | 说明 |
|---|---|
| ECS | `<ECS_PUBLIC_IP>`，Alibaba Cloud Linux 3，已装 Docker + Compose |
| RDS | PostgreSQL 17，内网 `<RDS_ENDPOINT>:5432`，与 ECS **同 VPC**（走内网）；库 `cfp`，账号 `cfpadmin` |
| ACR | 个人版实例 `<ACR_REGISTRY>`，命名空间 `<ACR_NAMESPACE>`，开启「仓库自动创建/私有」|
| 域名 | website 临时子域（A 记录指向 ECS）；正式域名验证通过后再从 Vercel 切来 |
| 端口 | ECS 内部：website 容器 `3302`；nginx `80`/`443` |

## 3. 部署流程（GitHub Actions）

工作流：`.github/workflows/deploy-production.yml`，触发：push 到 `main` 或手动 `workflow_dispatch`。

步骤：`pnpm verify`（lint/类型/测试/构建）→ 登录 ACR → 构建并推送 `cfp-website` 镜像 → SSH 到 ECS（`docker login` + `docker compose pull && up -d`）→ 冒烟测试。容器只跑 `next start`；建/升级表由 Payload 适配器在首次连库时自动应用迁移（`prodMigrations`），部署流程里没有单独的 `payload migrate` 步骤。

`prepare` 任务会先检查所需 Secret 是否齐全，缺则跳过部署。

### 所需 GitHub Secrets（仅名称，值不入库）
`ALIYUN_ACR_REGISTRY`、`ALIYUN_ACR_NAMESPACE`、`ALIYUN_ACR_USERNAME`、`ALIYUN_ACR_PASSWORD`、`ECS_HOST`、`ECS_USER`、`ECS_SSH_KEY`、`DATABASE_URL`、`PAYLOAD_SECRET`、`NEXT_PUBLIC_SITE_URL`、`DEEPSEEK_API_KEY`（可选 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`）

> 注意：这些 Secret 里**没有**阿里云主 AccessKey。AccessKey 只用于人工跑 CLI/签证书，见第 7 节。

### 手动触发
```bash
gh workflow run deploy-production.yml --ref <branch> --repo code-for-people-2026/cfp-mono
gh run watch --repo code-for-people-2026/cfp-mono
```

## 4. 服务器侧一次性配置（已完成，留作复现/重建参考）

1. **Docker**：ECS 上已有（宝塔装的 docker-ce）。
2. **部署 SSH key**：CI 用独立 ed25519 key 登录 ECS（公钥在 `~/.ssh/authorized_keys`，私钥存 `ECS_SSH_KEY`）。
   - ⚠️ 写私钥时必须保留结尾换行（`printf '%s\n'`，不能用 `printf '%s'`，否则 `error in libcrypto`）。
3. **nginx**：`dnf install -y nginx`，反代配置在 `/etc/nginx/conf.d/`：
   - `demo.codeforpeople.cn.conf`：80 → `127.0.0.1:3302`
   - `demo-ssl.conf`：443（SSL）→ `127.0.0.1:3302`
   - nginx 1.24 用 `listen 443 ssl http2;`（**不支持** `http2 on;` 新语法）。
   - 反代 502 排查：先确认后端容器已就绪；若系统启用了 SELinux，需 `setsebool -P httpd_can_network_connect 1`。
4. **HTTPS 证书**：用 acme.sh + **DNS-01** 验证签发 Let's Encrypt 证书（不需要 80 端口）。
   ```bash
   export Ali_Key=<ID>; export Ali_Secret=<SECRET>   # 临时，勿入库
   acme.sh --issue --dns dns_ali -d demo.codeforpeople.cn --server letsencrypt --keylength ec-256
   ```
   证书放 `/etc/nginx/ssl/`，`nginx -t && systemctl reload nginx`。

## 5. ICP 备案：现状与通过后的切换

**关键认知**：阿里云在大陆 ECS 上对**明文 HTTP** 流量按 `Host` 头拦截未备案域名（**与端口无关**，3302 也拦）；**HTTPS 加密了 Host，拦不到**，故 HTTPS 可暂时访问。但这只是技术现象——

> **未备案不得对公众提供网站服务。** 当前 `https://demo.codeforpeople.cn` 仅供内部/团队测试，**不可公开推广**。阿里云仍可能人工巡检/整改。

**备案通过后**应做：
1. 关掉对外暴露的 `3302`（安全组删除该入方向规则），只留 80/443。
2. 配置 80 → 443 跳转。
3. 证书续期改用宝塔一键 SSL 或服务器侧 acme.sh 定时任务（见第 8 节）。
4. 如需对外，可接入已购的 CDN。

## 6. 运维操作

**查看部署状态**（任选）：
- 宝塔面板 → Docker → 容器：看状态/端口/日志/资源。
- SSH：`docker ps`、`docker compose -f ~/cfp-mono/docker-compose.yml logs --tail=50 website`。

**健康检查**：`curl http://127.0.0.1:3302/api/health`（ECS 本地）。

**回滚**：镜像按 commit SHA 打标签。回滚时在 ECS 的 `~/cfp-mono/.env` 把 `WEBSITE_IMAGE` 改回上一个 SHA，然后 `docker compose pull && docker compose up -d`。

## 7. 凭据与安全

| 凭据 | 存放位置 | 说明 |
|---|---|---|
| 阿里云 AccessKey（RAM `cfp-deploy-cli`） | **仅本机** `~/.aliyun/config.json`（profile `cfp-deploy`）+ `~/.acme.sh/account.conf` | 不在仓库、不在 GitHub、不在 ECS |
| 部署相关密钥 | GitHub Secrets | 见第 3 节名单 |
| RDS 密码 / PAYLOAD_SECRET | GitHub Secrets，ECS 上 `~/cfp-mono/.env.production` | 不入库 |

**AccessKey 轮换**（key 泄漏或定期）：
1. RAM 控制台给 `cfp-deploy-cli` **新建** AccessKey（新值只留本地，**勿贴聊天/日志/git**）。
2. 更新本机 CLI：`aliyun configure set --profile cfp-deploy --mode AK --region cn-shenzhen --access-key-id <新> --access-key-secret <新>`。
3. 如用 acme.sh 续期，重新 `--renew --force` 一次以保存新值。
4. RAM 里**禁用并删除旧 key**（这一步才是轮换的意义）。

## 8. 已知缺口

- **Payload 生产建表 — 已解决**：website 使用正式的、提交进仓库的 migrations（`apps/website/src/payload/migrations/`），作为 `prodMigrations` 传给 Postgres 适配器，**生产首次连库时自动幂等应用**（不依赖 push，push 在 `NODE_ENV=production` 下本就被禁用），容器只跑 `next start`、无单独 migrate 步骤。构建用普通 `next build`（Turbopack），import 不带 `.js` 扩展名。
- **website / site 共用库 — 已解决**：`apps/site` 已退役。website 的表固定落在独立的 `website` schema（`schemaName: "website"`，写死在 migration 里），与 site 时代的 `public` schema 隔离，**互不冲突**——所以首次上线无需为了避免冲突而清库。
- **首次上线清旧表（可选）**：`cfp` 库 `public` schema 里可能残留 site 时代的 Payload 表。它们和 website 的 `website` schema 不冲突，可在确认 website 正常后再清理，不是上线前置条件。
- **Payload 生成类型未提交（类型安全 follow-up）**：`payload-types.ts` 是生成物、未提交，CI 在其缺席下按宽松类型通过。若要完整 schema 类型安全，需提交它并修 `seed.ts` / `lib/content` 里 6 处严格类型不匹配（slug/target 联合类型、`as Raw` 改 `as unknown as`）。属独立改进。
- **证书自动续期未对接服务器**：当前证书在本机签发、手动传到 ECS。备案后改为服务器侧自动续期 + reload。
- **临时放行的 3302**：备案后关闭。

## 9. kith-inn 桃子体验版

本节只描述受控候选；是否已备案、证书是否有效、微信合法域名和体验成员是否配置，必须在每次发布现场复核，仓库文档不代表外部状态已完成。

### 9.1 配置与上线顺序

1. `cp deploy/.env.verify.example deploy/.env.kith-inn`，设为 `0600` 并只在目标主机填值；该文件、真实 OpenID、数据库 URL 与任何 secret 都不得提交或粘贴到日志。
2. 四个镜像变量必须为 ACR digest；secret 至少包括 kith-inn 专用 Payload/JWT/CMS token、桃子 OpenID、微信 AppID/AppSecret、DeepSeek key，以及由可信通道取得的 ECS host key 行 `ECS_SSH_KNOWN_HOSTS`。体验版上传另用无 shell/无 sudo/仅端口转发的 `KITH_INN_UPLOAD_PROXY_SSH_USER` / `KITH_INN_UPLOAD_PROXY_SSH_KEY`；不得复用 website 的 `PAYLOAD_SECRET` 或部署 SSH key，不得用 `StrictHostKeyChecking=no` 传输生产 secret。
3. 先执行 `docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.kith-inn.prod.yml --env-file deploy/.env.kith-inn config --quiet`、`bash deploy/verify-kith-inn-compose.sh deploy/.env.kith-inn` 和 `bash deploy/verify-nginx-example.sh`。
4. DNS A/AAAA 必须指向目标 ECS；证书 SAN、有效期与完整链必须匹配已备案且已加入微信 request 合法域名的 BE host。`nginx -t` 成功后才 reload，公网只开放 80/443，CMS/H5 保持内网或 loopback。
5. 工作流先无副作用地 stage 候选，并在停写前验证候选 Compose/env、预拉全部 digest；通过后再停止 CMS/BE/H5 关闭用户写入口。随后用固定版本 Alibaba Cloud CLI 调用 `CreateBackup`，轮询 `DescribeBackupTasks` 到 `Finished`，再用 `DescribeBackups` 验证唯一 `Success` 备份集。只有取得并写入 job summary 的非敏感 backup ID/UTC 时间才可进入 migration；gate、备份或部署失败都会幂等恢复 last-good runtime。官方接口约束见 [CreateBackup](https://help.aliyun.com/en/rds/developer-reference/api-rds-2014-08-15-createbackup) 与 [DescribeBackupTasks](https://help.aliyun.com/en/rds/api-query-backup-tasks)。禁止 `push`、fresh/reset 和开发 seed reset。
6. 工作流把同 SHA 四个 digest 与 secret 写入目标机 `0600` 的 `.env.kith-inn.next`，并把候选 Compose 写入独立 `.next`；远程脚本按 pull→单次 migration→单次 provision→三项 runtime rollout→smoke 执行。smoke 成功后才把 env+Compose 固化为不可变 release bundle，并通过单一指针 rename 原子提升为 current；seller ID 只从 provision JSON 在进程内直传。以下命令仅用于受控人工复现：

```bash
compose=(docker compose -f deploy/docker-compose.kith-inn.prod.yml --env-file deploy/.env.kith-inn)
"${compose[@]}" pull
"${compose[@]}" up -d kith-inn-h5
provision_result="$("${compose[@]}" logs --no-color --no-log-prefix kith-inn-cms-provision | tail -n 1)"
seller_id="$(jq -er 'select(.project == "kith-inn") | .sellerId' <<<"$provision_result")"
: "${KITH_INN_TRIAL_OPENID:?必须由受控 secret 环境注入，禁止回显}"
KITH_INN_BE_BASE_URL="https://<已备案且微信后台已配置的-BE-host>" \
  RELEASE_SHA="<40位main提交>" KITH_INN_ENV_FILE=deploy/.env.kith-inn \
  KITH_INN_PROVISIONED_SELLER_ID="$seller_id" bash deploy/smoke-test.sh kith-inn
```

smoke 会核对五个容器的 release SHA、Compose 实际 loopback 健康、H5，以及与 weapp 构建相同的 `KITH_INN_BE_BASE_URL` 所经过的真实 TLS/Nginx liveness、readiness 和 `/offerings` 未认证边界；JWT 认证只读仍在 BE 容器 loopback 内执行，避免域名误配外送 token。它还验证 operator/seller、60 秒 JWT、只读 offerings，以及目标 seller 全业务 collection 的前后哈希；成功必须为 `writeCount: 0`。seller ID 只能由本次 provision JSON 直传，不能配置为 Environment 输入。任一步失败都不得生成上传凭据或进入体验版上传。

### 9.2 诊断与 15 分钟回滚

- `database_unavailable`/migration head 错误：停止候选，不改 schema；检查 RDS 网络、备份和 migration 日志。
- `internal_auth_failed`/token 错误：轮换并一致更新 CMS/BE token 后重新部署，不打印旧值。
- `operator_not_provisioned`/`seller_mismatch`：核对 provision 输出与受控 OpenID，重跑幂等 provision；禁止手改 seller ID 或删除生产数据。
- TLS/DNS/Nginx 失败：保持候选不对外，修复证书链/host/allowlist 后重新 `nginx -t`；关闭域名校验不算修复。

计时从 smoke 失败开始：候选 Compose 不覆盖 last-good Compose，且 `.kith-inn-current` 指向同时包含 env/Compose 的已验证 bundle；rollout 后失败只用该 pair 恢复上一组三项应用 digest 并复跑完整只读 smoke（不运行旧 migration/provision），workflow 为本地镜像复验及 pull 重试预留 30 分钟。失效的 `.kith-inn-previous` 只按无历史版本处理，不得阻断有效 current 的恢复。复验失败即停止三项 runtime 并返回 `manual_data_recovery_required`，选择已审计 down、前向修复，或从 job summary 记录的 backup ID 恢复到独立 RDS 后验证再切换；不得自动回退数据库。首次部署没有上一应用时只停止候选并保留备份/日志供人工处置。

上传前还必须确认同一 SHA 的部署 smoke 凭据、微信上传私钥/IP 白名单、体验成员和合法域名。微信白名单只加入 ECS 固定公网出口；workflow 会用严格 host key 校验建立临时 SOCKS 隧道，核对实际出口等于 `ECS_HOST` 后才调用 `miniprogram-ci`，不得放行 GitHub-hosted runner 的动态 IP 范围或关闭白名单。真实微信登录与核心链路只由开启域名校验的桃子真机验收证明。
