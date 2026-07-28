# kith-inn-v1 生产与微信体验版手册

本文只记录配置名称和操作边界，不记录任何真实账号、OpenID、主机、域名或 secret。

## 当前结论

- website 的 CMS 内建于 `apps/website`（生产端口 3302、Postgres schema `website`），不属于本发布链。`kith-inn` 与 `kith-inn-v1` 另行共用唯一的 `apps/cms` 常驻进程（生产端口 3304、schema `cms`）；该 CMS 已包含 `kiv1_*` collections、迁移、内部 API 和 v1 身份校验。当前只发布 v1，因此由 v1 workflow 部署这一个 kith CMS，不要求旧版 `kith-inn` 先部署。
- `Deploy kith-inn-v1 Production` 是独立 workflow；website workflow 不调用、不等待 v1，website-only 变更不会部署 v1，v1/CMS-only 变更也不会部署 website。两者只复用同名 `production` concurrency 锁，防止同一 ECS/RDS 上的高风险操作并发。旧版 `kith-inn` production target 已关闭，旧 BE/FE 变更不会再启动第二个 CMS。v1 构建共享 CMS runtime、CMS migration/provision job 和 v1 BE。截至本次审计，历史 Actions 没有 v1 BE smoke artifact；因此只能确认“当前 CI 未部署 v1”，不能据此排除人工部署。
- v1 领域模型支持多个 seller；当前产品入口只自动 provision 一个“桃子”seller 和一个 operator，尚无自助开店或运营后台。

## ECS 自动部署

相关代码合入 main 后，`.github/workflows/deploy-kith-inn-v1-production.yml` 独立监听 push，并由 `deploy/resolve-kith-inn-v1-production-target.sh` 只判断共享 kith CMS、v1 BE、它们的 workspace 依赖和 v1 部署契约；也可通过 `workflow_dispatch` 显式重发。`.github/workflows/deploy-production.yml` 只负责 website 和已关闭的旧版 target，不再调用 v1。两个 workflow 共享 `production` 并发锁以串行化同一 ECS/RDS 的发布，但一个项目的变更不会触发另一个项目的部署。旧版 `kith_inn` 输出固定为 `false`，不要求其微信或部署配置。v1 workflow 还会等待同 SHA 的 `ci.yml`。缺任一 v1 配置时发布失败关闭，且不会产生 smoke marker；这不算一次已验证发布，必须补齐配置后重新触发。

Production Environment 需配置：

- 复用基础设施/共享 CMS Secrets：ALIYUN_ACR_REGISTRY、ALIYUN_ACR_NAMESPACE、ALIYUN_ACR_USERNAME、ALIYUN_ACR_PASSWORD、ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET、ECS_HOST、ECS_USER、ECS_SSH_KEY、ECS_SSH_KNOWN_HOSTS、DATABASE_URL、KITH_INN_PAYLOAD_SECRET。
- v1 Secrets：KITH_INN_V1_JWT_SECRET、KITH_INN_V1_INTERNAL_TOKEN、KITH_INN_V1_OPERATOR_OPENID、KITH_INN_V1_WX_APPID、KITH_INN_V1_WX_SECRET。前两个还需注入共享 CMS runtime，供 v1 内部 API 校验使用。
- 仅轮换 v1 JWT/internal token 时，额外暂存旧值到成对的 KITH_INN_V1_PREVIOUS_JWT_SECRET、KITH_INN_V1_PREVIOUS_INTERNAL_TOKEN。先发布“新值为 primary、旧值为 previous”，等共享 CMS 与 v1 BE 都切到新值后，下一次发布清空 previous。两项必须同时设置或同时清空；不得在日志或 PR 中记录值。
- Variables：ALIYUN_REGION_ID、ALIYUN_RDS_INSTANCE_ID、KITH_INN_V1_BE_BASE_URL；生产值固定为 `https://api.codeforpeople.cn/kith-inn-v1`。它是小程序请求使用的完整 HTTPS base URL，不得带尾斜杠、query 或 fragment。

v1 发布顺序固定为：构建共享 CMS runtime、CMS ops 与 v1 BE 三个镜像 → 推送并固定 digest → ECS 候选 preflight → 停止旧共享 CMS 与 v1 BE 写入口 → 创建并验证 RDS 恢复点 → 执行 schema migration → 事务化幂等 provision → 同时等待共享 CMS 与 v1 BE healthcheck → loopback 与真实 HTTPS 只读 smoke（精确核对 release SHA，并由 BE `/ready` 从容器网络验证共享 CMS/service auth）→ 原子提升 current release → 仅保留 current/previous 敏感快照 → 上传同 SHA smoke marker。首次接管会按 Compose service label 记录并停止旧 `kith-inn` runtime；旧 v1 快照即使只有 BE 也可识别。候选失败时用记录的容器 ID 恢复接管前 runtime；数据库只通过发布前恢复点人工恢复，不自动回滚。

ECS 的 Nginx/证书需一次性配置：`deploy/nginx.example.conf` 已包含 `api.codeforpeople.cn` 的 `/kith-inn-v1/` 路径到 `127.0.0.1:3311/` 的去前缀反代示例，其他路径不交给 v1 BE；公网只开放 80/443。先验证 DNS、完整证书链和 `nginx -t`，再 reload。微信小程序后台的 request 合法域名只填写 origin `https://api.codeforpeople.cn`，不填写 `/kith-inn-v1` 路径。

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

真实运行生产 workflow 或上传微信体验版前，必须另行取得明确外发授权。
