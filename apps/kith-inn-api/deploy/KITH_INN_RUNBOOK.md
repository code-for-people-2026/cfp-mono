# 街坊味 API 部署与联调手册

适用现有「桃子的摆摊助手」、Issue #360、PR #368。代码已整合 main 的业务实现；
准备、部署、验证分别记录在[发布证据](../../../specs/022-kith-inn-menu-mvp/checklists/release-evidence.md)。
以下命令从仓库根执行，仅使用本应用 compose。不得执行官网发布、全局 prune 或重启 ECS/RDS。

## 1. 当前云端事实与启动门槛

2026-10-01 数据库报告优先于旧计划：RDS PG17 测试库 `kith_inn_staging`、迁移账号
`kith_inn_staging_migrator`、运行账号 `kith_inn_staging_app` 已存在，五表及迁移记录已建好。
ECS 经 VPC 的 psql 读取已验证；不是 API 部署证据。不重建、不重授予更宽权限。
迁移 0001 SHA-256：`135f419388a1dfb97b5d1247d9acf7551f5bde1c6ef3eab2521c0d4fadf46276`。

- 先核对 ECS 架构、可用内存/磁盘、Docker/Compose 版本、占用端口及既有服务状态。
- 本配置为测试环境：项目 `cfp-kith-inn-staging`，宿主机 `127.0.0.1:3306` → 容器 3305。
  每个 API 进程连接池硬上限 5；单容器 0.5 CPU、512 MiB、128 PID，tmpfs 64 MiB，日志 10 MiB × 3。
  不自动扩副本。正式环境未来另建项目/库/私密配置，不能复用测试数据。
- 当前 RDS SSL 关闭，实测 ssl=false。测试阶段如沿用内网明文必须如实记录；不能标为加密。
  不设 rejectUnauthorized=false 或 NODE_TLS_REJECT_UNAUTHORIZED=0。启用共享 RDS SSL 前先说明对其他应用的影响、证书及维护安排。
- 运行密码曾经聊天传递。2026-10-01用户明确决定本轮暂不轮换，继续部署；轮换保留为后续待办，不作为本轮启动门槛。现有密码仍通过无回显输入写入服务器私密配置，不从旧聊天复制。将来通过控制台改密码时，由操作者亲自输入并提交。
- AppID/AppSecret/本环境经营者的真实 OpenID 缺失时，镜像可构建、配置可验证，但运行入口会拒绝启动。
  测试环境可用用户本人的真实微信身份，正式环境另绑定桃子；每套环境仍只允许一个经营者。
  不提供绕过鉴权模式、不填假身份。现有自动化测试只运行独立 `_test` 库，绝不指向 staging。

## 2. 私密配置和已有授权

建议目录 `/etc/kith-inn/staging` 权限 700，`runtime.env` 权限 600、部署者所有。
从本目录 `.env.kith-inn.example` 取字段名，通过受控交互输入填写；不打印文件、不用命令参数传密码。
Compose >= 2.30 的 raw env_file 避免 `$` 插值：值不加引号，URL 中账号密码仍须按 URL 规则编码。
AppSecret 和完整连接串只在后端文件中；AppID 可用于小程序构建，OpenID 不进入前端或报告。
禁止输出 `docker inspect` 的完整 Env、非 quiet 的真实 compose config、shell `set -x`。

2026-10-01实测ECS原Compose为2.27.0，已在`/opt/kith-inn/tools/docker-compose-v5.5.1`
单独安装并核验官方5.5.1二进制，未替换共享工具。**这台ECS执行下文部署命令时，必须把
`docker compose`替换为该绝对路径**。数据库凭据已安全填写，并由实际镜像中的连接池与结构探针
在只读事务中验证通过。2026-10-02已填入用户提供的现有AppID，并核对`TARO_APP_ID`生成的
微信构建产物与之匹配。同日用户告知已自行重置AppSecret，并经终端无回显输入保存到该文件；
已核对字段非空、文件root/600、目录700，以及真实配置的Compose quiet格式检查通过。
OwnerOpenID仍为空，AppSecret尚未经过微信换码验证，不能据此启动或宣称API已部署。

| 对象 | kith_inn_staging_app 现有权限 |
| --- | --- |
| 本库 / public schema | CONNECT / USAGE |
| merchants、sessions、week_plans | SELECT、INSERT、UPDATE |
| dishes | SELECT、INSERT、UPDATE、DELETE |
| mutation_receipts | SELECT、INSERT、DELETE |
| kith_inn_migrations | SELECT |

连接账号不得使用 migrator。当前应用不启动自动迁移；已有 checksum 相同可直接核对 ready。
未来迁移先备份，用 migrator 的另一份私密配置手动执行 `node --import tsx scripts/migrate.mjs`。
运行账号没有 sessions DELETE，运维清理不得偷偷给它加权。
运行角色的跨库元数据已只读核验：两个学习库拒绝CONNECT；`cfp`和`postgres`仍有CONNECT/TEMP，
但没有数据库/schema CREATE，`cfp`现有21个用户关系没有可用的表读写权限。连接级隔离仍未完成，
其他角色及反向访问尚未全面核验；不据此调整其他库PUBLIC权限或共享白名单。
最新PITR范围及隔离恢复仍待单独核验。
2026-10-01已只读核对共享快照每天备份、快照与日志均保留7天，以及当天成功快照；具体时间见发布证据。
这不等于街坊味恢复演练通过，也不代表已确认业务的RPO/RTO。

## 3. 构建、启动与检查

先完成本地验证、提交并记录 SHA，按 ECS 实际架构构建；镜像 tag 使用完整提交或 digest，不用 latest。
专用 image CI 只构建，不推送、不部署官网。部署文件位于 API 工程内，未改共享发布识别逻辑。
以下Git命令适用于有干净checkout的构建端。本次ECS未安装Git，使用已核验SHA-256的固定提交
归档，路径和对应提交见发布证据；不得在归档目录把`git rev-parse`的失败当作有效版本。

```sh
set -eu
test -z "$(git status --porcelain)"
export KITH_INN_RELEASE_SHA="$(git rev-parse HEAD)"
export KITH_INN_IMAGE="your-registry/kith-inn-api:$KITH_INN_RELEASE_SHA"
docker build --build-arg RELEASE_SHA="$KITH_INN_RELEASE_SHA" \
  -f apps/kith-inn-api/Dockerfile -t "$KITH_INN_IMAGE" .
export KITH_INN_ENV_FILE=/etc/kith-inn/staging/runtime.env
# 在服务器检查文件权限和镜像来源后；下条不会输出配置。
docker compose -f apps/kith-inn-api/deploy/docker-compose.kith-inn.yml config --quiet
docker compose -f apps/kith-inn-api/deploy/docker-compose.kith-inn.yml up -d --wait kith-inn-api
curl --fail http://127.0.0.1:3306/api/kith-inn/health
curl --fail http://127.0.0.1:3306/api/kith-inn/ready
```

health 只表示进程活着；ready 校验数据库、迁移 checksum 和五表，Docker HEALTHCHECK 使用 ready。
断库/结构不符应 ready503；健康检查不自动重启容器，告警接收者与监控仍须落实。
未登录 `/dishes` 应401；非法 JSON 应400；响应及日志不得包含连接串、token 或微信 code。
记录实际镜像 ID、端口、HostConfig 的资源限制及官网部署前后的容器启动时间，避免输出完整 Env。

`nginx.kith-inn.example.conf` 是未安装的示例。实际域名、DNS、证书、现有 Nginx 位置核对后，
只加本域名 vhost，`nginx -t` 成功后才 reload，不 restart 官网容器；3306不开放公网安全组。
Nginx 覆盖 X-Real-IP，API 仅在 socket peer 严格匹配 `KITH_INN_TRUSTED_PROXY_IP` 时信任它。
该值必须现场确认（容器 bridge gateway 不一定是127.0.0.1），不能填网段或通配符。
核验两来源各自20次登录预算、伪造 X-Real-IP 无法改变来源；不盲信 X-Forwarded-For。

真实登录后经 API 做：新增/读回菜品→批量失败不留部分数据→同幂等键重试不重复→
旧版本冲突409→保存周菜单→只重启街坊味容器→同会话重新读取菜品/周菜单。
数据保留须通过重启后的 API 响应和数据库对应记录共同确认。
缺微信身份时可在全新本地 `_test` 库使用显式测试替身验证上述行为；不写云 staging 身份表，不计微信或云端验收。

备份仍沿用私密 PGSERVICEFILE/PGPASSFILE，文件权限600。备份目标须新文件且存于受控存储：
`pg_dump --dbname=service=kith_source --format=custom --no-owner --no-acl --file="$KITH_BACKUP"`。
先核对 service 指向本应用；`pg_restore --list` 仅检查归档结构，下面的应用读回才验证可恢复。

## 4. 隔离恢复（不原地覆盖）

1. 记录开始时间、原库/镜像版本、备份时间/hash和恢复目标。管理员新建隔离数据库/角色，禁止覆盖现有库；隔离服务无公网入口，不调用真实微信。
2. 对照上方权限表限制角色、库和 schema 权限。用私密 PG service `kith_restore` 指向全新目标，执行下列命令；不使用 `--clean`。

```sh
set -eu
pg_restore --dbname=service=kith_restore --exit-on-error --single-transaction \
  --no-owner --no-acl "$KITH_BACKUP"
psql service=kith_restore -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM sessions;
DELETE FROM mutation_receipts;
COMMIT;
SELECT (SELECT count(*) FROM merchants) AS merchants,
       (SELECT count(*) FROM dishes) AS dishes,
       (SELECT count(*) FROM week_plans) AS weeks;
SQL
```

3. 使用与备份兼容的 API 镜像，连接隔离库，给 runtime 授权；先在原镜像检查 ready，再尝试新版本迁移。用新 compose 项目名及空闲 loopback端口启动，禁止复用现有生产容器。
4. 旧 token 必须401。人工样本允许仅在隔离测试中注入测试身份/新会话；真实恢复在安全批准环境重新微信登录。测试替身不算微信登录证据。
5. **通过应用读取** `/dishes`、`/weeks` 分页及每个 `/weeks/{weekStart}`。与备份前应用响应比较：菜品状态/版本、周结构、14餐快照、确认时间、同周唯一、账号归属；特意包含已改名/停用菜历史快照和去汤餐。禁止只看表行数或归档目录判通过。
6. 记录恢复结束时间/耗时、丢失窗口与每项差异；恢复结果未核对前不切流量。仅当前菜池可读的演练不能勾选完整菜单恢复。

## 5. 失败停止与回退

构建/备份/迁移/ready任一步失败停止后续操作，保留原实例和原库；根据脱敏 requestId诊断。
已提交 migration 不得改 checksum；失败事务由迁移器回滚。不要手工逆向删除列来尝试修复。
只有旧镜像兼容当前 schema 才切回已记录的旧 digest，重复 health/ready及读写检查。
不兼容时使用第4节恢复到新库，核对后另行批准切流量；恢复可能丢失备份后保存，须先说明实际窗口。

## 6. 日常清理与退出删除

到期会话30天、成功回执24小时是技术期限；业务保留/备份频率和期限、日志期限、RPO/RTO及值班责任人仍待确认。
日常清理可由维护者使用专库受控任务执行（当前未安装调度）：

```sql
BEGIN;
DELETE FROM sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL;
DELETE FROM mutation_receipts WHERE expires_at <= now();
COMMIT;
```

退出操作涉及真实删除，需核实请求者、授权范围、目标资源及操作者。只有得到针对目标数据的明确授权后执行；本轮不执行退出删除。

1. 停止专用 API、备份任务和入口，防止写入/重新登录；在安全配置中撤去经营身份绑定。单纯删 merchant 后仍开着原白名单会重新创建账号。
2. 管理员确认连接的专库名与账号，使用事务锁定唯一 merchant；以下 SQL 仅用于已核对的单账号专库。禁止在其他产品库运行。

```sql
BEGIN;
SELECT id FROM merchants FOR UPDATE;
DELETE FROM mutation_receipts;
DELETE FROM sessions;
DELETE FROM week_plans;
DELETE FROM dishes;
DELETE FROM merchants;
COMMIT;
SELECT (SELECT count(*) FROM merchants) + (SELECT count(*) FROM sessions)
     + (SELECT count(*) FROM dishes) + (SELECT count(*) FROM week_plans)
     + (SELECT count(*) FROM mutation_receipts) AS remaining_rows;
```

3. 验证 remaining_rows=0、旧 token拒绝、入口停止。清除自己控制的备份、恢复库、下载件、测试副本、日志、环境凭据和客户端缓存；逐项记录对象与删除结果，不保留菜名/身份正文。
4. SQL DELETE 不是介质擦除：WAL、PG卷、云盘快照、对象版本、异地副本、PITR与宿主备份都需核查。优先采用独立存储/加密密钥可撤销方案，由存储管理员完成对应销毁和证明；不要对共享实例执行整库/整卷删除。
5. 托管服务无法立即删除时，标记阻塞并解决存储安排或取得明确重新约定；不能用自然到期替代退出即删除。退出记录也须约定最少信息与保留期限。
6. 恢复旧归档前核对退出处置记录，已退出数据不得重新出现；未能证明备份与托管残留处置完毕，不宣布退出删除完成。

## 7. 管理员必须配合的事项

开发版/体验版可以在正式发布前联调。沿用现有账号，不重新注册。

| 配合事项 | 具体交付 | 是否阻塞体验版 |
| --- | --- | --- |
| 核对现有小程序 | 名称、AppID、主体与当前线上用途；确认本次可上传该账号 | 是 |
| 成员权限 | 把实际开发者加入项目成员并授予开发/上传所需权限；实际测试者加入体验成员，桃子参加验收时也需加入 | 是 |
| 私密配置 | 由授权者把现有 AppSecret 安全配置到服务器；不要为方便直接重置共享密钥 | 是 |
| 本环境经营者身份 | 测试可用用户本人，正式使用绑定桃子；同一 AppID 的真实 wx.login code 仅交后端换码，安全核对 OpenID 后绑定；不自动认领首位访客 | 是，测试不必等桃子 |
| request 合法域名 | 添加最终测试 HTTPS 域名；实际证书、域名校验必须开启后验收 | 是 |
| 选为体验版 | 开发者上传已核验 AppID/API 地址的包，授权者在后台设置体验版并安排实际测试者扫码 | 是 |
| 正式发布准备 | 按当前后台核对备案/认证/服务类目/隐私要求、审核体验路径及现有用途替换影响 | 正式上线前 |

首次取得本环境经营者OpenID在HTTP服务启动前完成，避免与启动必填配置互相等待：

1. 先核对现有AppID，将AppSecret安全填入ECS；确认取得登录码的微信账号确实属于本环境选定的经营者（测试可用用户本人，正式使用为桃子）。
2. 该经营者在该AppID的授权开发环境/真实设备取得`wx.login`返回的一次性code，通过受控输入交给ECS。
3. 运维一次性换码复用镜像中的`src/auth.ts`/`createWechatExchanger`，无需启动HTTP服务，
   不创建测试会话、不把第一个访客自动当经营者。code和返回的OpenID不输出到日志、报告或命令参数。
4. 核对身份来源后仅将真实OpenID保存到私密配置，再启动服务并做真实登录及非本环境经营者拒绝检查。

上述换码步骤尚未执行；微信资料未取得时保持服务未启动，不用占位值满足配置校验。
`sessions.ts`在首次合法登录时把AppID/OpenID写入数据库的单一经营者记录，后续登录会核对两者；
已有绑定时仅改环境变量不能切换经营者，会返回403。保留用户的测试数据，正式环境使用独立数据库和
配置绑定桃子；桃子参与测试验收前另行安排隔离环境或明确的身份交接，不直接覆盖或删除已有记录。

审核体验路径在单一桃子白名单约束下尚未解决；需要管理员/业务负责人确认平台可接受的路径。
不添加后门、不临时关鉴权或悄悄扩大允许使用者。
本轮未进入该小程序后台，成员权限及具体页面名称必须以管理员看到的当前后台为准。
官方入口：[发布流程](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)、
[网络要求](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)。

微信测试联调：本环境经营者真实登录、其他账号拒绝、菜池→生成→换菜→保存→本餐做汤切换→复制、
退出重进及第二台设备读回；保留业务规则Q1～Q3，不重做界面。H5与构建通过不能代替真机证据。
用户本人完成测试不代表桃子的正式身份绑定或实际使用验收已通过，后者仍需单独记录。
