# 官网 PR Preview

官网采用单一 `main` 分支：PR 在合并前通过 Vercel Preview 验收，合并后仍由现有 CI 自动
部署到 ECS 生产环境。Vercel 项目不连接 Git 仓库，避免 Hobby 账号直接访问组织仓库；
GitHub Actions 使用 Vercel CLI 部署精确的 PR head commit。

## 触发与门禁

- PR 目标分支必须是 `main`。
- `deploy/resolve-deploy-targets.sh` 判断官网是否受影响；无官网改动时 Preview job 以 no-op
  方式成功。
- `verify` 和 Docker `preview-build` 必须先成功。
- 只允许来自本仓库分支的 PR。Fork PR 无法使用仓库 secrets，必须由维护者把已审核提交移到
  本仓库分支后再部署。
- 部署固定到 `github.event.pull_request.head.sha`，`/api/health` 和 `/api/ready` 必须返回相同
  的 40 位 commit SHA，数据库探针也必须成功。

## Vercel 与 Neon

Vercel 项目只用于 Preview，不配置 Production 域名或 Production 部署。项目的 Root
Directory 是 `apps/website`，Preview 环境包含：

- Neon 集成注入的 Preview-only Postgres 连接变量；
- Preview-only、Sensitive 的 `PAYLOAD_SECRET`；
- GitHub Actions 每次部署注入的 `RELEASE_SHA`。

Neon 的 Vercel 集成会为部署提供隔离的 Preview 数据库分支。新数据库允许为空：公开页面会
回退到仓库内的静态内容，而 `/api/ready` 仍会验证 Payload 能连接 Postgres 并完成迁移。
`DEEPSEEK_API_KEY` 未作为 Preview 的必需配置；需要测试相关 AI 路由时，应单独创建 Preview
凭据，不得复用生产 secret。

## GitHub Actions 配置

仓库 Actions secrets：

- `VERCEL_WEBSITE_PREVIEW_TOKEN`：专供该 workflow 使用、范围只包含 `cfp-website-preview`
  项目的 Vercel token。它必须与本机管理 token 分开创建；workflow 还会通过固定 project ID 和
  删除前校验，防止误操作其他项目。

仓库 Actions variables：

- `VERCEL_WEBSITE_PREVIEW_ORG_ID`
- `VERCEL_WEBSITE_PREVIEW_PROJECT_ID`

不要把 token、数据库 URL 或 Payload secret 写入仓库、PR 评论、Actions variables 或日志。

## 生命周期

`.github/workflows/ci.yml` 创建部署、验证健康检查并更新一条带隐藏 marker 的 PR 评论。同一
PR 推送新 commit 后，新部署成功才删除旧部署；部署失败时保留上一个可用 Preview 供排查。
新部署如果未通过健康检查则立即删除。
`.github/workflows/website-preview-cleanup.yml` 在 PR 关闭时读取该评论、校验部署属于预期 Vercel
项目，再删除部署。

如果自动清理失败：

1. 从 PR 评论取得 `*.vercel.app` URL。
2. 在有相同项目级 token 的可信环境设置 `DEPLOYMENT_URL`、`VERCEL_PROJECT_ID`、
   `VERCEL_ORG_ID` 和 `VERCEL_TOKEN`。
3. 从可信的 `main` checkout 运行 `bash deploy/remove-vercel-preview.sh`。

该脚本会先通过 Vercel API 校验项目 ID，避免误删其他项目的部署。
