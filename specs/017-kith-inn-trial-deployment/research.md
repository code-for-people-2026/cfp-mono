# Research: kith-inn 桃子体验版部署与真机发布

## R1 生产承载路径

**Decision**: 复用现有 ECS + RDS + ACR + GitHub Actions，host Nginx 终止 TLS；微信云托管仅保留为未实施备选。

**Rationale**: CMS/BE 已是普通 Node/Next 服务，仓库已有相同基础设施、镜像和回滚基线；改为云托管会同时改变运行与小程序请求方式，超出 #158 最小边界。微信官方说明云托管可用私有协议免配通讯域名，但这不是采用它的理由：[小程序网络文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)。

**Alternatives considered**: 微信云托管/云开发代理；因引入新平台和 `callContainer` 适配而不实施。`demo.codeforpeople.cn` 未备案且仅内部使用，不能作为主路径。

## R2 合法域名与 TLS

**Decision**: 使用已备案主体依法持有的 HTTPS 子域名作为微信 request 合法域名，微信后台显式配置，真机保持域名校验开启。

**Rationale**: 微信官方要求请求域名为 HTTPS、不能使用 IP/localhost、必须 ICP 备案并校验证书；工信部现行规则要求境内非经营性互联网信息服务履行备案，且互联网信息服务域名依法依规注册所有。来源：[微信小程序网络要求](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)、[工信部《非经营性互联网信息服务备案管理办法》](https://www.miit.gov.cn/gyhxxhb/jgsj/cyzcyfgs/bmgz/xxtxl/art/2024/art_84a0cfa0ebd049bbbe751dca9a008e56.html)、[工信部域名规范通知](https://domain.miit.gov.cn/policydoc/%E5%B7%A5%E4%B8%9A%E5%92%8C%E4%BF%A1%E6%81%AF%E5%8C%96%E9%83%A8%E5%85%B3%E4%BA%8E%E8%A7%84%E8%8C%83%E4%BA%92%E8%81%94%E7%BD%91%E4%BF%A1%E6%81%AF%E6%9C%8D%E5%8A%A1%E4%BD%BF%E7%94%A8%E5%9F%9F%E5%90%8D%E7%9A%84%E9%80%9A%E7%9F%A5.pdf)。

**Alternatives considered**: IP、局域网、未备案 demo 域名、关闭域名校验；均不能形成真机验收。

## R3 CMS schema 生命周期

**Decision**: 本地开发可保留 Payload push；生产切到提交的 baseline/incremental migrations，部署先迁移再启动，禁止 `migrate:fresh/reset` 和生产自动 push。

**Rationale**: 当前 `push:true` 与“尚无生产数据”的假设不再成立。Payload 官方将 push 定位为开发同步，并要求 PostgreSQL 非开发环境使用 migration；migration 按事务执行，失败应拒绝部署。来源：[Payload PostgreSQL](https://payloadcms.com/docs/database/postgres)、[Payload Migrations](https://payloadcms.com/docs/database/migrations)。

**Alternatives considered**: 首次生产继续 push 后再补 baseline；会留下无法审计的 schema 起点。应用启动时 `prodMigrations`；多副本并发和回滚边界较差，选择部署期单次 migration job。

## R4 桃子初始化与真实身份

**Decision**: schema migration 后执行事务化、按稳定业务键收敛的旧 kith-inn seed；真实 OpenID 从受控 secret 注入，只更新目标 operator，不输出值。重复执行和中途恢复必须得到同一 seller/offering/operator 结果。

**Rationale**: 当前 seed 在发现 seller 后整体跳过，无法修复半成品；固定 `taozi-dev-openid` 只适合 H5 本地登录。生产不得运行带 reset 的开发命令，也不能把真实 OpenID写进 fixture。

**Alternatives considered**: Payload Admin 手工修改；不可重复审计。为生产复制第二套 seed；会产生漂移，改为让同一入口接受受控生产覆盖并收敛。

## R5 产物与网络边界

**Decision**: CMS runtime 用最小 Next standalone 镜像，migration/provision 用独立、非 root、短生命周期 CMS ops image；BE 用编译后 Node 镜像，H5 用只读静态 Nginx 镜像。四个镜像绑定同一 commit SHA/各自 digest；服务端口只暴露给 Compose/host loopback，host Nginx 提供公网 TLS。

**Rationale**: Payload 官方支持 Next standalone 多阶段 Docker 构建；该方案沿用仓库 website 模式，同时让 H5 有独立、可回滚产物：[Payload Production Deployment](https://payloadcms.com/docs/production/deployment)。

**Alternatives considered**: ECS 上安装 workspace 并现场构建；不可变性和回滚较弱。把 H5 文件直接覆盖宿主目录；无法按 digest 回滚。

## R6 部署后认证 smoke

**Decision**: BE 镜像提供一次性内部 CLI：用 secret 中的试用 OpenID调用现有 CMS operator lookup，把返回 seller ID 与 provisioning 输出的非敏感目标 ID 比较，在进程内签发最长 60 秒 JWT，再请求部署后的只读 `GET /offerings`；token/OpenID不输出、不落盘。真机另外证明真实 `wx.login → code2session`。

**Rationale**: 微信 code 一次性且不适合无人值守 CI；公开 `/auth/smoke-login` 会成为生产旁路。内部 CLI复用既有 operator lookup、JWT 与 seller middleware，能验证同一认证信任链和只读业务边界。

**Alternatives considered**: 静态 JWT（过期/泄露风险）、公开 smoke endpoint（后门）、只测 401（不能证明可登录）、自动复用微信 code（不可重复）。

## R7 体验版上传

**Decision**: 使用锁定版本的微信官方 `miniprogram-ci`，独立 `workflow_dispatch` 上传指定已部署提交；私钥从 GitHub Environment secret 写入临时 0600 文件，用后删除，IP 白名单开启。

**Rationale**: 官方工具提供 upload/preview，要求 AppID、项目目录和私钥；微信文档建议开启上传 IP 白名单，并指出密钥具有预览/上传权限。来源：[微信小程序 CI 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html)。

**Alternatives considered**: 手工开发者工具上传；无法重复、无法稳定关联提交。主分支每次 push 自动上传；会制造无意体验版，采用人工批准的独立发布工作流。

## R8 回滚与证据

**Decision**: 应用按上一镜像 digest 回滚；schema 默认 forward-only，只有已演练且不丢数据的 down 才执行，否则前向修复或从 RDS 快照恢复。自动与真机证据统一绑定 Release Candidate 且全程脱敏。

**Rationale**: 应用回滚不能假设新 schema 可逆；把 release、migration、smoke、上传和真机版本绑定后才能判断交付状态。

**Alternatives considered**: 任意 `migrate:down`、仅保留 workflow 绿色截图；前者可能丢数据，后者无法证明实际版本或真机链路。
