# 部署运维手册（Runbook）

> ⚠️ 本仓库为**公开仓库**。此文档**不得**写入真实的服务器 IP、数据库地址、实例 ID、密钥等敏感信息。具体数值请保存在私密笔记中，这里只用占位符。

第一阶段把 `apps/site` 部署到阿里云 ECS（地域：华南/深圳），通过 GitHub Actions 实现 push → 自动构建 → 部署。`apps/website` 留待第二阶段。

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
| 域名 | `demo.codeforpeople.cn`（A 记录指向 ECS）；根域名/其它子域在 Vercel |
| 端口 | ECS 内部：site 容器 `3300`；nginx `80`/`443` |

## 3. 部署流程（GitHub Actions）

工作流：`.github/workflows/deploy-production.yml`，触发：push 到 `main` 或手动 `workflow_dispatch`。

步骤：`pnpm verify`（lint/类型/测试/构建）→ 登录 ACR → 构建并推送 `cfp-site` 镜像 → SSH 到 ECS（`docker login` + `docker compose pull && up -d`）→ 冒烟测试。

`prepare` 任务会先检查所需 Secret 是否齐全，缺则跳过部署。

### 所需 GitHub Secrets（仅名称，值不入库）
`ALIYUN_ACR_REGISTRY`、`ALIYUN_ACR_NAMESPACE`、`ALIYUN_ACR_USERNAME`、`ALIYUN_ACR_PASSWORD`、`ECS_HOST`、`ECS_USER`、`ECS_SSH_KEY`、`DATABASE_URL`、`PAYLOAD_SECRET`、`NEXT_PUBLIC_SITE_URL`

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
   - `demo.codeforpeople.cn.conf`：80 → `127.0.0.1:3300`
   - `demo-ssl.conf`：443（SSL）→ `127.0.0.1:3300`
   - nginx 1.24 用 `listen 443 ssl http2;`（**不支持** `http2 on;` 新语法）。
   - 反代 502 排查：先确认后端容器已就绪；若系统启用了 SELinux，需 `setsebool -P httpd_can_network_connect 1`。
4. **HTTPS 证书**：用 acme.sh + **DNS-01** 验证签发 Let's Encrypt 证书（不需要 80 端口）。
   ```bash
   export Ali_Key=<ID>; export Ali_Secret=<SECRET>   # 临时，勿入库
   acme.sh --issue --dns dns_ali -d demo.codeforpeople.cn --server letsencrypt --keylength ec-256
   ```
   证书放 `/etc/nginx/ssl/`，`nginx -t && systemctl reload nginx`。

## 5. ICP 备案：现状与通过后的切换

**关键认知**：阿里云在大陆 ECS 上对**明文 HTTP** 流量按 `Host` 头拦截未备案域名（**与端口无关**，3300 也拦）；**HTTPS 加密了 Host，拦不到**，故 HTTPS 可暂时访问。但这只是技术现象——

> **未备案不得对公众提供网站服务。** 当前 `https://demo.codeforpeople.cn` 仅供内部/团队测试，**不可公开推广**。阿里云仍可能人工巡检/整改。

**备案通过后**应做：
1. 关掉对外暴露的 `3300`（安全组删除该入方向规则），只留 80/443。
2. 配置 80 → 443 跳转。
3. 证书续期改用宝塔一键 SSL 或服务器侧 acme.sh 定时任务（见第 8 节）。
4. 如需对外，可接入已购的 CDN。

## 6. 运维操作

**查看部署状态**（任选）：
- 宝塔面板 → Docker → 容器：看状态/端口/日志/资源。
- SSH：`docker ps`、`docker compose -f ~/cfp-mono/docker-compose.yml logs --tail=50 site`。

**健康检查**：`curl http://127.0.0.1:3300/api/health`（ECS 本地）。

**回滚**：镜像按 commit SHA 打标签。回滚时在 ECS 的 `~/cfp-mono/.env` 把 `SITE_IMAGE` 改回上一个 SHA，然后 `docker compose pull && docker compose up -d`。

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

## 8. 已知缺口 / 第二阶段（website）

- **Payload 生产建表**：✅ 已解决。`apps/website` 已引入正式 migrations（`src/payload/migrations/`），并在 `payload.config.ts` 里把它们作为 `prodMigrations` 传给 postgres adapter。生产（`NODE_ENV=production`）首次连接 DB 时 adapter 会**自动 apply** 这些 migration 建表，已落库的则按 `payload_migrations` 跳过——**部署无需单独的 `payload migrate` 步骤**。需要新增 migration 时（改了 collection/global 字段）跑 `pnpm --filter @cfp/website payload:migrate:create <name>`（连本地库，`PAYLOAD_DB_PUSH` 留空）后提交生成的文件。
- **website 与 site 共用 `cfp` 库**：✅ 已解决。`apps/website` 的 postgres adapter 固定用 `schemaName: "website"`（schema 名写死在 migration 的建表 SQL 里，故不做成 env 可覆盖，避免“配置的 schema”与“migration 建表的 schema”不一致），与 `apps/site` 的 `public` schema 隔离，两个 Payload 应用各管各的表（含各自的 `cms_admins`，即两套独立后台登录），不再争抢同一 schema。
- **证书自动续期未对接服务器**：当前证书在本机签发、手动传到 ECS。备案后改为服务器侧自动续期 + reload。
- **临时放行的 3300**：备案后关闭。
