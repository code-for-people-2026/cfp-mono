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
- `apps/cms` + `apps/kith-inn-be` + `apps/kith-inn-fe` H5：同一 ECS 上的独立 Compose override；四个不可变镜像（含短生命周期 CMS ops）共用 RDS 实例但固定使用 `cms` schema，website 拓扑不变。
- 桃子正式入口是 weapp 体验版；BE 使用已备案并配置到微信后台的 HTTPS request 合法域名，CMS/H5 仅限内部 allowlist。

## 从 Vercel 迁移（两步）

website 原先部署在 Vercel。迁移分两步、Vercel 全程不停：

1. **并行验证**：把 website 部署到阿里云的**临时子域**（如 `website-staging.codeforpeople.cn`，照搬现有 `demo.codeforpeople.cn` 的 IP+HTTPS 模式），Vercel 继续服务正式域名。在临时子域验证通过。
2. **切换并撤 Vercel**：DNS 把正式域名从 Vercel 切到 ECS；在 Vercel 后台删除 website（及已归档的 duanwu）项目，删掉 `apps/website/vercel.json` 和本地 `.vercel/`。

## 阿里云准备清单

1. ECS / Docker / ACR / RDS 均已就绪（`apps/site` 第一阶段已建好，website 复用）。
2. 创建 website 临时子域的 DNS 记录 -> ECS 公网 IP。
3. 为该子域签发 SSL 证书（acme.sh DNS-01，见 RUNBOOK）。
4. 中国大陆**正式**域名指向 ECS 前，先完成 ICP 备案；验证阶段用临时子域即可。

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
- `NEXT_PUBLIC_SITE_URL`（指向 website 的子域 / 正式域名）
- `DEEPSEEK_API_KEY`（对话/摘要 API 必需；可选 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`）

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

kith-inn 的 `cms` schema 不沿用上述 website 自动迁移：候选发布必须先创建/验证 RDS 可恢复备份，再由同 SHA 的 CMS ops image 显式执行 committed migration 与幂等桃子 provision；两者成功后才启动 runtime。部署后运行 `RELEASE_SHA=<sha> bash deploy/smoke-test.sh kith-inn`，验证 readiness、动态 seller 的认证只读请求及 15 张业务/关系表零写入。完整失败处理见 `deploy/RUNBOOK.md` §9。

## 回滚

在服务器上保留上一个镜像标签。部署后如果冒烟测试失败，手动把镜像标签改回上一个版本，然后运行：

```bash
docker compose pull
docker compose up -d
```

kith-inn 应用回滚恢复上一组 CMS/BE/H5 digest，但不重跑旧 ops image；如新 schema 与旧应用不兼容，停止流量并选择已审计 down、前向修复或发布前 RDS 备份恢复，不得用 reset 代替数据恢复。

## 临时验证

website 可继续使用临时域名验证。kith-inn 的 H5 也仅可内部验证；桃子真机体验版必须使用已备案、有效 TLS 且已加入微信后台的合法域名，不能以公网 IP、临时未备案域名或关闭域名校验代替。
