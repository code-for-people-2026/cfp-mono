# kith-inn-v1 生产与微信体验版手册

本文只记录配置名称和操作边界，不记录任何真实账号、OpenID、主机、域名或 secret。

## 当前结论

- `kith-inn` 与 `kith-inn-v1` 共用唯一的 `apps/cms` 常驻进程；该 CMS 已包含 `kiv1_*` collections、迁移、内部 API 和 v1 身份校验。当前只发布 v1，因此由 v1 workflow 部署这一个共享 CMS，不要求旧版 `kith-inn` 先部署，也不会再启动第二个 Payload/Next 进程。
- `Deploy Production` 在同一个 `production` 发布锁内调用 v1 workflow；v1 构建共享 CMS runtime、CMS migration/provision job 和 v1 BE。截至本次审计，历史 Actions 没有 v1 BE smoke artifact；因此只能确认“当前 CI 未部署 v1”，不能据此排除人工部署。
- v1 领域模型支持多个 seller；当前产品入口只自动 provision 一个“桃子”seller 和一个 operator，尚无自助开店或运营后台。

## ECS 自动部署

相关代码合入 main 后，`.github/workflows/deploy-production.yml` 的 target resolver 选择 v1 目标并直接调用 `.github/workflows/deploy-kith-inn-v1-production.yml`；两者属于同一次 workflow run 和同一个 `production` 并发锁。`apps/cms` 变更只选择 v1，不会要求旧版 `kith-inn` 的配置或触发其部署。v1 workflow 还会等待同 SHA 的 `ci.yml`。缺任一 v1 配置时所有外部发布步骤都会跳过，且不会产生 smoke marker；这不算一次已验证发布，必须补齐配置后重新触发。

Production Environment 需配置：

- 复用基础设施/共享 CMS Secrets：ALIYUN_ACR_REGISTRY、ALIYUN_ACR_NAMESPACE、ALIYUN_ACR_USERNAME、ALIYUN_ACR_PASSWORD、ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET、ECS_HOST、ECS_USER、ECS_SSH_KEY、ECS_SSH_KNOWN_HOSTS、DATABASE_URL、KITH_INN_PAYLOAD_SECRET。
- v1 Secrets：KITH_INN_V1_JWT_SECRET、KITH_INN_V1_INTERNAL_TOKEN、KITH_INN_V1_OPERATOR_OPENID、KITH_INN_V1_WX_APPID、KITH_INN_V1_WX_SECRET。前两个还需注入共享 CMS runtime，供 v1 内部 API 校验使用。
- 仅轮换 v1 JWT/internal token 时，额外暂存旧值到成对的 KITH_INN_V1_PREVIOUS_JWT_SECRET、KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN。先发布“新值为 primary、旧值为 previous”，等共享 CMS 与 v1 BE 都切到新值后，下一次发布清空 previous。两项必须同时设置或同时清空；不得在日志或 PR 中记录值。
- Variables：ALIYUN_REGION_ID、ALIYUN_RDS_INSTANCE_ID、KITH_INN_V1_BE_BASE_URL；BE URL 必须是无 path 的真实 HTTPS origin。

v1 发布顺序固定为：构建共享 CMS runtime、CMS ops 与 v1 BE 三个镜像 → 推送并固定 digest → ECS 候选 preflight → 停止旧共享 CMS 与 v1 BE 写入口 → 创建并验证 RDS 恢复点 → 执行 schema migration → 事务化幂等 provision → 同时等待共享 CMS 与 v1 BE healthcheck → loopback 与真实 HTTPS 只读 smoke（精确核对 release SHA，并由 BE `/ready` 从容器网络验证共享 CMS/service auth）→ 原子提升 current release → 仅保留 current/previous 敏感快照 → 上传同 SHA smoke marker。候选失败时恢复上一版共享 CMS 与 v1 BE runtime；数据库只通过发布前恢复点人工恢复，不自动回滚。

ECS 的 Nginx/证书需一次性配置：`deploy/nginx.example.conf` 已包含 `v1.codeforpeople.cn` 到 `127.0.0.1:3311` 的反代示例，只公开 80/443；先验证 DNS、完整证书链和 `nginx -t`，再 reload。该 HTTPS host 还要加入微信小程序的 request 合法域名。

## 三个微信测试账号

建议固定一个账号为商家，另外两个只作为顾客：

1. 在微信公众平台把三人加入该小程序的体验成员；需要调试者再加入开发者。三人必须打开同一个 AppID 构建。
2. 商家账号在体验版中执行 wx.login，得到一次性 code。只在你控制的受信环境内，用该 AppID/AppSecret 调微信 code2Session 得到该账号针对本 AppID 的 OpenID，并直接保存为 GitHub Production secret KITH_INN_V1_OPERATOR_OPENID。不要把 AppSecret、code 或真实 OpenID 发到聊天、提交、Actions 日志或 shell history。
3. 部署时幂等 seed 创建/调和唯一一条 kiv1_operators membership：seller=桃子、wechatOpenid=该商家 OpenID、active=true。只有命中 active membership 的 OpenID 能取得商家 JWT。
4. 两个顾客账号无需预写 membership。顾客从商家分享的 batchPublicId 进入，客户端 wx.login；BE 用 OpenID 加 batchPublicId 解析 seller 并签发顾客 JWT。顾客 profile/order 始终按 sellerId + openid 隔离。

OpenID 是 AppID 作用域内标识，不是微信号、手机号或登录密码；换 AppID 后必须重新取得。若任何旧 AppSecret 曾经出现在聊天、日志或代码中，先在微信公众平台轮换，再更新 GitHub Environment secret，旧值不得继续使用。

## 体验版准备

后续独立切片要把现有 `release-kith-inn-weapp.yml` 从旧 `@cfp/kith-inn-fe` 改为 v1：

- checkout 已在 main 且有 kith-inn-v1-smoke-passed-<SHA> 的完整 SHA；
- 用同一 KITH_INN_V1_BE_BASE_URL 构建 @cfp/kith-inn-v1-fe，生产构建禁止 customer dev OpenID；
- 使用 v1 AppID 和小程序代码上传私钥，经已校验的固定出口上传体验版；
- 上传后在微信公众平台选为体验版，由三名体验成员在开启域名校验的真机上验收商家登录、分享 batch、两名顾客分别登录和下单隔离。

在取得明确外发授权前，不 push、不开 PR、不运行生产 workflow，也不上传微信体验版。
