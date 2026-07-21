# 部署说明

本项目第一阶段采用低运维成本的阿里云部署路线，尽量适合原本更熟悉 Vercel、但还不熟悉云基础设施的人。

## 心智模型

- ECS：一台运行容器的 Linux 服务器。
- Docker Compose：在 ECS 上启动和更新应用容器。
- RDS PostgreSQL：Payload CMS 使用的托管 PostgreSQL。
- ACR 个人版：容器镜像仓库。
- Nginx 和 SSL：通过 HTTPS 将域名路由到容器。
- GitHub Actions：负责构建、推送、SSH 部署和冒烟测试。

第一阶段先不引入 Kubernetes/ACK。

## 生产目标

- `apps/website`：官方网站 + Payload 管理后台 + 对话/摘要 API，容器端口 `3302`。
- 镜像：`cfp-website`，由 GitHub Actions 构建并推送到 ACR。
- 数据库：复用现有 RDS PostgreSQL（`apps/site` 退役后接管）。

kith-inn 是独立发布目标，不改变上述 website 路径：CMS runtime、短生命周期 CMS ops、BE、内部 H5 四镜像绑定同一提交；CMS 使用同一 RDS 的独立 `cms` schema，外部流量只经 Nginx 80/443。标准顺序为可恢复备份 → 单次 migration/provision → runtime 启动 → readiness → `bash deploy/smoke-test.sh kith-inn`。完整变量、DNS/TLS、上传前置与应用/数据回滚见 [中文 Runbook](./deploy/RUNBOOK.md#9-kith-inn-桃子体验版)。

## Website 生产入口

website 已从 Vercel 迁移到阿里云，稳态链路为：

- `www.codeforpeople.cn` → 阿里云 CDN → ECS Nginx → `127.0.0.1:3302`。
- `codeforpeople.cn` → ECS Nginx → `https://www.codeforpeople.cn`。
- 生产 workflow 以正式域名保留 Host/SNI/证书校验，并用 `curl --connect-to` 绕过 CDN 直连 ECS 做发布 smoke；不保留公开的临时验证域名。
- Vercel website 项目及 Git 集成已退役，不再参与构建或发布。

## 阿里云准备清单

1. ECS / Docker / ACR / RDS 均已就绪（`apps/site` 第一阶段已建好，website 复用）。
2. `www` 的 DNS 指向阿里云 CDN CNAME，CDN 以正式域名作为回源 Host/SNI 并经 HTTPS 回源 ECS。
3. 根域 DNS 指向 ECS，只提供到 `www` 的永久重定向；ECS 证书覆盖根域和 `www`。
4. 中国大陆正式入口上线前必须完成 ICP 备案；发布验证直接连接源站，不另建公开临时域名。

## GitHub 密钥

生产部署工作流需要这些 GitHub Secrets：

- `ALIYUN_ACR_REGISTRY`
- `ALIYUN_ACR_NAMESPACE`
- `ALIYUN_ACR_USERNAME`
- `ALIYUN_ACR_PASSWORD`
- `ECS_HOST`
- `ECS_USER`
- `ECS_SSH_KEY`
- `DATABASE_URL`
- `PAYLOAD_SECRET`
- `NEXT_PUBLIC_SITE_URL`（固定为 website 正式 canonical 域名）
- `DEEPSEEK_API_KEY`（对话/摘要 API 必需；可选 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`）

kith-inn 另用专属的数据库/Payload/JWT/CMS token、桃子 OpenID、微信登录与小程序上传凭据；只在 GitHub `Production` Environment 或目标主机权限受限文件中配置。缺任一项只阻断 kith-inn，不得影响 website，也不得把 seller ID 当作 secret 输入（它由 provision 结果直传 smoke）。

## 部署流程

```txt
GitHub 推送
  -> CI 运行 lint、typecheck、knip、测试、e2e 和构建
  -> 构建 Docker 镜像
  -> 推送 Docker 镜像到 ACR
  -> SSH 到 ECS
  -> docker compose pull
  -> docker compose up -d   # 容器只跑 next start；首次连库时适配器自动应用迁移
  -> 冒烟测试
```

## 数据库迁移（Payload）

website 用**正式的、提交进仓库的 Payload migrations**（`apps/website/src/payload/migrations/`），不用生产 `push`（Payload 在 `NODE_ENV=production` 下禁用 push）。**迁移由 Postgres 适配器自动应用**：`payload.config.ts` 把这些迁移作为 `prodMigrations` 传给适配器，生产首次连库时适配器幂等地应用未执行的迁移（已应用的按 `payload_migrations` 表跳过）。因此**容器只跑 `next start`，部署流程里没有单独的 `payload migrate` 步骤**。

改了 Payload 集合/全局结构后，本地用 Postgres 重新生成迁移并提交：

```bash
pnpm --filter @cfp/website payload:migrate:create <name>   # 需要本地 Postgres + DATABASE_URL
```

> 迁移 CLI 能加载 TS 配置，依赖 `apps/website` 的 `package.json` 标了 `"type":"module"`。构建用普通 `next build`（Turbopack），import 不带 `.js` 扩展名。生成迁移时若本地出现 `apps/website/payload-types.ts`（已 gitignore），删掉即可，不要提交。

## 回滚

在服务器上保留上一个镜像标签。部署后如果冒烟测试失败，手动把镜像标签改回上一个版本，然后运行：

```bash
docker compose pull
docker compose up -d
```

kith-inn 应用回滚只恢复上一 CMS/BE/H5 digest，不运行旧 ops image；schema 默认 forward-only。若旧应用不兼容新 migration，停止流量并按 Runbook 选择前向修复、已审计 down 或 RDS 备份恢复。

## 发布验证

workflow 通过正式 URL 配合 `SITE_CONNECT_TO` 直连 ECS，在不依赖 CDN 缓存或额外公开域名的情况下验证源站 TLS、Nginx、root、health、readiness 与 release SHA。公网验收再独立验证 CDN 和根域重定向。
