# Contract: kith-inn 生产候选、smoke 与体验版验收

## 1. 配置边界

| 消费者 | 必填变量 | 规则 |
|--------|----------|------|
| CMS runtime/migration | `NODE_ENV=production`、`PAYLOAD_DATABASE_URL`、`PAYLOAD_SECRET`、`JWT_SECRET`、`CMS_INTERNAL_TOKEN` | DB 必须为 PostgreSQL；禁止 dev secret、SQLite 与生产 push |
| BE runtime | `NODE_ENV=production`、`JWT_SECRET`、`CMS_BASE_URL`、`CMS_INTERNAL_TOKEN`、`WX_APPID`、`WX_SECRET`、`DEEPSEEK_API_KEY` | CMS URL 必须显式；secret 不能为空/占位；生产无 dev-login |
| H5/weapp build | `NODE_ENV=production`、`BE_BASE_URL` | 只允许有效 `https://` 主机；拒绝 IP、localhost、局域网、查询/片段和隐式默认值 |
| 桃子 provisioning/smoke | `KITH_INN_TRIAL_OPENID` | OpenID 仅为 Environment secret；provisioning 以机器可读结果输出非敏感 seller ID，流水线直接传给 smoke，禁止把 seller ID 配成 Environment 输入或人工复制/猜测 |
| 体验版上传 | `WX_APPID`、`KITH_INN_MINIPROGRAM_PRIVATE_KEY` | 私钥只写临时 0600 文件并在 finally 删除；上传 IP 白名单开启 |

非敏感 URL、镜像名、版本说明可用 GitHub Environment variable；secret 缺失时 kith-inn job 必须失败关闭或明确保持未配置，不能影响无关项目 job。任何值不得由工作流拼入 PR 或普通 artifact。

## 2. 构建与版本契约

- CMS runtime、短生命周期 CMS ops、BE、H5 四个镜像 tag 使用同一 `releaseSha`，部署记录使用 registry 返回的四个 digest；容器均以非 root 用户运行。ops image 只运行 migration/provision，结束后不承载流量；不得用未纳入 marker 的临时 builder 代替。
- H5 与 weapp 必须在构建前调用同一个 `BE_BASE_URL` 校验器；源码中本地默认值只允许非生产开发。
- weapp 上传入口接收 `--version`、`--desc`、`--project-path`，版本说明必须含短 SHA；重复执行同一输入得到同一构建摘要，但微信上传记录可有新的执行时间。
- 正式目标入口：`pnpm --filter @cfp/kith-inn-fe upload:weapp -- --version <version> --desc <redacted-description>`；`--dry-run` 完成全部本地校验/构建但不调用微信。

## 3. 健康与 readiness

| 入口 | 成功条件 | 失败时不得泄露 |
|------|----------|----------------|
| CMS `GET /api/health` | 进程 liveness，200 | 配置值、DB 地址 |
| CMS `GET /api/ready` | DB 可查询、`cms` migration head 一致，200 | SQL、凭据 |
| BE `GET /` | 进程 liveness，200 | secret |
| BE `GET /ready` | CMS readiness/内部认证可用，200 | internal token、上游正文 |
| H5 `GET /` | 静态入口与 SPA fallback 可读，200 | source map、环境变量 |

失败返回 503 与稳定错误类别；公开响应只允许 `ok`、`service`、`releaseSha` 和类别，不返回堆栈。

## 4. 部署后 smoke

标准入口 `bash deploy/smoke-test.sh kith-inn` 顺序执行：

1. 检查 CMS/BE liveness 与 readiness、H5 静态入口。
2. provisioning 输出只含状态与 `sellerId` 的机器可读结果；同一 workflow job 解析该结果并直接传给 BE 容器内一次性 `smoke:deployed` CLI。CLI 用 `KITH_INN_TRIAL_OPENID` 调 CMS operator lookup，并要求返回 seller ID 精确等于该结果；seller ID 不是部署输入，不允许人工复制或猜测。
3. CLI 在内存签发 TTL ≤60 秒 JWT，再对公开 BE 执行 `GET /offerings`；不打印 token/OpenID，并在退出前清除引用。
4. 对旧 kith-inn 全部业务/关系表读取行数与内容指纹基线；前后必须完全相等，写入变化为 0，且不得把行内容写入输出。
5. 输出只含 release SHA、各检查状态、耗时与错误类别；任一步失败返回非零并触发发布阻断/回滚。

该 CLI 不是 HTTP route，不可从公网调用。真实 `wx.login → code2session` 成功只由真机验收证明。

## 5. 网络与部署拓扑

- 微信只请求 `https://${KITH_INN_BE_HOST}`；该子域已备案、证书有效且已加入微信 request 合法域名。
- `CMS_BASE_URL=http://cms:3304` 只存在于 Compose 私网；CMS admin 如需公网访问必须单独 HTTPS 且有 IP/额外认证限制。
- H5 经独立 HTTPS host 提供，但由 IP allowlist/VPN/额外认证限制为内部入口；不得作为桃子正式入口。
- CMS/BE/H5 容器端口不直接暴露公网；host Nginx 是唯一 80/443 入口，80 只重定向 443。
- `demo.codeforpeople.cn`、IP、localhost、局域网 URL 与关闭域名校验均为不合格证据。

## 6. Schema、seed 与回滚

- 部署顺序：为目标 RDS 创建或验证可恢复备份 → 记录非敏感 backup ID/时间 → 单次 `payload:migrate:production` → 幂等 `seed:kith-inn`/provision → 启动候选 → readiness → smoke。备份缺失、不可恢复或无法绑定目标数据库时必须在 migration 前失败关闭。
- migration/seed 失败不得启动候选；生产禁止 `push`、`migrate:fresh/reset`、`seed:*:reset:dev`。
- 应用失败先回滚到 `previousReleaseSha`；若 migration 与旧版不兼容，停止流量并选择已审计 down、前向修复或 RDS 恢复，不自动猜测。
- 应用回滚不重跑旧 ops image；记录的 `cmsOpsImageDigest` 用于追溯已执行 DDL/seed 供应链，schema 处置仍以 migration head 与备份为准。

## 7. 体验版与证据

PR7 只在 smoke 全部成功后生成 `smoke-passed.json`，内容为 schema version、完整 `releaseSha`、deploy run ID、CMS runtime/CMS ops/BE/H5 四镜像 digest、migration head、非敏感 backup ID/时间与 `smokeStatus: passed`，并上传为按 SHA 命名且设置 `retention-days: 30` 的 GitHub Actions artifact；失败路径不得产生该 marker。

上传 workflow 必须显式选择 main commit，随后通过 GitHub Actions API 查询、下载并校验该 SHA 对应且未过期的 `smoke-passed.json`；artifact 缺失/过期，或 SHA、run ID、digest、migration head、状态任一不一致均失败，不能信任手填 SHA 或手工抄录结果。校验通过并经 GitHub Environment 审批后才可上传；不得由任意 PR 或无关 main push 自动上传。

证据至少记录：release SHA、镜像 digest、migration head、脱敏 host/TLS 检查、smoke run、weapp version/上传 run、体验成员确认、`domainValidationEnabled=true`、微信登录与 7 个核心步骤结果。证据不得含 secret、OpenID、JWT、顾客姓名/地址、私钥内容或完整生产 env。
