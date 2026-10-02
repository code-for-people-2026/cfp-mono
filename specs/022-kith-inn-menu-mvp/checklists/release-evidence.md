# 2026-10-03 部署接手记录（当前）

本节优先于下方2026-09-21历史演练。主线业务为已合并PR #377的 `9cd1987`，
PR #368继续使用 `codex/kith-inn-release`，已在本地合入main解决冲突。
主要执行聊天：推进街坊味部署与联调，`01a0f660-ee39-7c60-a89f-72db44ff5da8`。
原 #360 任务 `01a0c162-2567-7be2-ada0-62daeed2c709` 已结束，本聊天接手；未另建Issue或派发任务。

| 状态 | 事实与证据 |
| --- | --- |
| 云数据库已验证（上一轮报告） | `kith_inn_staging`、两账号、五业务表与迁移记录已存在；psql内网读取成功；SSL=false；本轮未重建或更改 |
| 部署准备已实现 | 实现提交 `c618e0e`：pool.max=5；Compose单副本0.5CPU/512MiB/128PID；日志10MiB×3；只读非root；ready健康检查；raw私密env文件 |
| 代理准备已实现 | 默认忽略转发来源；仅信任指定socket peer的合法X-Real-IP，Nginx覆盖客户端输入。实际peer=172.23.0.1已配置；公网HTTPS、两来源独立限流及伪造头拒绝已验证 |
| 独立发布已核验 | 配置迁入 `apps/kith-inn-api/deploy`；共享CI/部署识别文件与main一致。实际main..HEAD识别 website=false、weekly_menu=false；专用工作流仅构建街坊味镜像，无部署步骤 |
| 本地已验证 | Node22.23.3、pnpm10.2、独立Docker PG17，全新三个 `_test` 库；根pnpm verify成功（lint/typecheck/coverage/knip/build）。API全量105项通过，配置/HTTP/runtime定向37项通过；配置渲染检查通过 |
| 本地API已验证 | 全新独立库、受限runtime角色、显式人工测试会话。12项检查：未登录401、菜品写读、幂等重放、批量回滚、周菜单保存、旧版本409、完整进程重启后菜品及周菜单一致、停用403、撤销401、health200/ready503结构故障及恢复 |
| 镜像构建已验证（CI/ECS） | `2bb0e14`的[专用镜像CI](https://github.com/code-for-people-2026/cfp-mono/actions/runs/36832046777)成功；同一提交已在ECS完成构建及缺配置拒绝启动检查，详见下节。镜像未推仓库；同一镜像现已启动测试服务，见10月2日部署记录。后续提交CI结果维护在PR/#360 |
| 镜像连接云库已验证 | 现有运行凭据已受控写入ECS；实际镜像复用createKithInnPool/createReadinessProbe连接测试库通过，pool.max=5、schema_ready=true、ssl=false，五张业务表仍为0行。只读临时容器，未启动HTTP服务 |
| 云端API已部署、基础检查已验证 | 2026-10-02 23:01:43（北京时间）固定镜像`2bb0e14`启动；仅`127.0.0.1:3306`，Docker healthy，health/ready均200，缺少/无效会话401、三类非法登录请求400；容器资源与私密配置限制已实测。真实业务写读及单容器重启持久化也已通过，详见后续记录 |
| 微信换码与真实API登录已验证，真机/正式环境未验证 | 用户扫码账号的真实wx.login换码成功，AppSecret有效；新的code经实际HTTP登录201，首次真实经营者/会话已入库，认证读取200。业务17项检查及重启后API/数据库完整比对通过。HTTPS已验证；request域名未配置、成员/上传权限、非经营者真实拒绝、真机、正式库及桃子身份、共享SSL评估、完整权限隔离、恢复和审核路径待办 |

本地重启演练第一轮脚本误把周PUT预期写为201（契约实际200）；修正测试断言后在新库重跑通过，
未改业务行为。两轮假数据只在本次新建PG容器中；未清理旧学习库和用户试用数据。
本机复核材料：`/tmp/kith-deployment-check-state.json`定位私密测试目录；`verify.log`与
`runtime-result.txt`为本地结果，测试凭据文件不能分享。临时执行脚本为 `/tmp/kith-runtime-smoke.mts`，
只能在新的专属本地PG容器运行，不能重跑到已有云库。

下一步：管理员添加已验证的HTTPS request域名→开发者工具重新获取域名配置并验证登录→
核对成员/上传权限，进入微信开发版/体验版真机联调。测试身份为用户本人，正式环境另绑定桃子。
管理员协作事项和每步命令见[当前手册](../../../apps/kith-inn-api/deploy/KITH_INN_RUNBOOK.md)。

## 2026-10-01 ECS 与共享备份只读核验

- 17:49（北京时间）ECS：x86_64；内存总量3563 MiB、available2391 MiB；无swap；根盘40 GiB、可用25 GiB。Docker26.1.3、原Compose2.27.0，3306未监听。
- 既有服务基线：官网容器启动于2026-08-25T01:03:04.139905313Z，hello-agent容器启动于2026-09-30T12:50:38.76646164Z，restartCount均为0。Nginx主进程PID80536；本次未操作这些服务。
- **云端准备已完成**：提交`2bb0e14982722e884f235fed53de2c187cc82fde`归档放在`/opt/kith-inn/releases/2bb0e14982722e884f235fed53de2c187cc82fde`；归档SHA-256为`3b3cada9726a9a73e2675793566243c38fcf0fc97181853dd2a5e4cd1d4d4e30`，云端校验通过，迁移文件校验仍与已有库一致。没有执行迁移。
- **工具已安装且格式已验证**：原Compose不支持`env_file.format: raw`。官方Compose5.5.1单独放在`/opt/kith-inn/tools/docker-compose-v5.5.1`，SHA-256为`db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576`，传输前后均核对。ECS直连GitHub Release返回空响应后，改由本机下载官方文件并通过Workbench上传；原Compose仍为2.27.0。使用空值示例文件的`config --quiet`成功，不能当作真实凭据或数据库连接验证。
- **应用镜像已在ECS构建，服务未启动**：ECS拉取`node:22-alpine`成功，digest为`sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402`。在固定提交归档目录使用原Dockerfile，构建过程限定0.5CPU/768MiB，退出码0；镜像`kith-inn-api:2bb0e14982722e884f235fed53de2c187cc82fde`，ID`sha256:d3d4496e0a973640698e3658d956bafdd207a6d594a7a12f948a50ed7b8e2c42`，linux/amd64、USER=node、revision对应源提交。日志位于ECS的`/opt/kith-inn/releases/2bb0e14-build.log`。未推镜像仓库、未开放API端口。
- **云端镜像负向启动检查已通过**：临时容器禁用网络、无数据库或微信配置，使用只读/0.5CPU/512MiB/128PID等限制启动实际入口，返回`server_start_failed`、退出码1，符合缺配置拒绝启动的预期。临时容器自动移除，无卷、无身份种子、未连接RDS；不能当作API健康或鉴权验收。
- **私密配置位置已准备**：`/etc/kith-inn`、`/etc/kith-inn/staging`为root所有、700；`runtime.env`为root所有、600。初始只复制空值模板，格式及专用Compose连接Docker检查成功；随后已安全填入数据库连接，结果见下节，微信配置仍为空。
- **既有服务未受影响（本次检查范围）**：镜像准备后官网和hello-agent容器的StartedAt、restartCount与前述基线完全一致；Nginx主/worker PID及启动时间不变。官网loopback根路径HTTP200，hello-agent根路径HTTP307、容器healthy。未把307冒充其业务全流程验收；本轮没有执行官网发布、Nginx reload或重启。
- **共享备份策略已核验，恢复未验证**：控制台显示每天07:00–08:00备份，快照保留7天；日志备份开启、保留7天；秒级备份关闭；实例释放后不保留备份。最新全量快照2026-10-01 07:20:18开始、07:22:55完成，恢复时间点07:20:19（控制台显示时间）。未核验最新PITR终点，未启动恢复或创建新实例。备份用量38.62GB，页面免费额度40GB；不据此承诺后续费用或恢复目标。
- 备份页弹出的DBS服务关联角色授权已取消；未新增权限，未更改SSL、白名单或其他数据库。原账号页加载异常已通过用户可见的新标签解决，已看到运行账号处于激活状态并打开其空白重置窗口；随后用户明确决定本轮暂不轮换，已取消重置窗口，密码未更改。轮换记录为后续待办，不继续阻塞本轮部署；现有凭据已填写并验证，见下节。
- 用户确认可联系现有小程序管理员稍后配合；尚未收到/核验真实微信配置，没有上传小程序。

## 2026-10-01 约18:15 运行配置与镜像连接验证

- **私密配置已填写并验证**：首次使用终端中已保存的配置返回PostgreSQL `28P01`。用户随后授权输入现有密码，使用无回显输入、URL编码、600临时文件和原子替换更新`runtime.env`后复验通过；没有更改RDS密码。只记录文件元数据和字段是否存在，不输出字段值。数据库字段非空，AppID/AppSecret/OwnerOpenID和可信代理字段仍为空；root/600及目录700复核通过；专用Compose读取这份实际私密文件执行`config --quiet`成功，未输出展开内容。
- **实际镜像到RDS已通过**：固定镜像`2bb0e14`在只读/0.5CPU/512MiB/128PID临时容器中运行现有`createKithInnPool`和`createReadinessProbe`。只读事务检查确认库名和角色匹配、pool.max=5、schema_ready=true、ssl=false；五张业务表均0行，随后ROLLBACK并退出。不是HTTP ready、API业务写读、微信身份或重启持久化验收。
- **跨库只读核验（仅运行角色）**：`study_platform`、`study_weekly_menu`、`rdsadmin`的有效CONNECT为false；`cfp`、`postgres`为true。实际连接后只查系统目录和权限函数，未读取其他应用业务行。`cfp`共21个用户表/视图等关系，拥有schema USAGE且具备SELECT/INSERT/UPDATE/DELETE的对象数均为0；`postgres`用户关系为0。两库均无数据库CREATE和用户schema CREATE，但均有TEMP权限。因此不能宣称连接级完全隔离；迁移角色、反向跨应用访问、函数/default privileges仍未全面审计，没有执行REVOKE/GRANT。
- **代理/证书只读核验**：现有Nginx配置检测通过，只有官网和hello-agent对应站点，没有街坊味入口；未reload。官网证书SAN仅覆盖`codeforpeople.cn`、`www.codeforpeople.cn`，hello-agent证书仅覆盖其已有子域名，均不能直接覆盖街坊味新子域名。专用DNS、证书和代理仍需准备，不复用错误证书。
- **服务状态**：临时检查容器已自动退出，`docker ps`仅有既有官网和hello-agent，后者healthy；街坊味HTTP服务未启动。本轮只读检查没有业务写入或共享权限变更。
- 文档提交`e5b4c27`的[仓库CI](https://github.com/code-for-people-2026/cfp-mono/actions/runs/36847158523)与[镜像CI](https://github.com/code-for-people-2026/cfp-mono/actions/runs/36847158038)成功；后续证据提交的检查另以PR页为准。

## 2026-10-02 AppID 接入准备

- 用户从现有小程序后台提供AppID；通过已恢复的ECS免密会话，仅更新`runtime.env`中的`KITH_INN_WECHAT_APP_ID`，保留其余配置。复查数据库/AppID字段非空、AppSecret/OwnerOpenID仍为空；root所有者、文件600及目录700不变。没有重置任何凭据。
- 在`7dd7d67`源码上使用Node22.23.3/pnpm10.2及现有`TARO_APP_ID`构建参数执行`build:weapp`，退出码0。生成的`dist/project.config.json`中AppID与用户提供值一致，`compileType=miniprogram`、`miniprogramRoot=./`、`urlCheck=true`；源代码的默认配置未改。本次没有构建网页或变更前端业务。
- 本次构建未配置API源站，仅用于检查AppID注入，不能当作可上传的联调包；后续填入已验证HTTPS地址后必须重新构建。尚未导入开发者工具、上传小程序或真实登录。
- 浏览器工具的站点安全策略直接阻止访问微信公众平台后台，未绕过限制。因此账号名称/主体/线上用途/成员权限仍需用户或管理员手动核对；AppID目前是用户提供的接入信息，不冒充平台实测证明。
- `main`仍为`9cd1987`；PR #368仍为draft且可合并，`7dd7d67`的[仓库CI](https://github.com/code-for-people-2026/cfp-mono/actions/runs/36848363634)和[镜像CI](https://github.com/code-for-people-2026/cfp-mono/actions/runs/36848363283)均成功。该文档后续提交的检查另以PR页为准；ECS实际镜像仍是固定源提交`2bb0e14`。
- 当前API仍未启动；继续取得同一小程序的现有AppSecret，再由测试经营者真实微信登录换码确认OpenID。合法请求域名、专用证书及真实API/体验版联调尚未完成。

## 2026-10-02 测试身份与密钥用途澄清

- **代码已核对，身份未绑定**：用户提出使用本人OpenID测试。现有实现允许每套后端/数据库环境配置一个经营者，测试可用用户的真实身份；不需要改业务规则或关闭鉴权。此前把桃子OpenID列为测试启动的必需项过于严格，已修正；正式环境和桃子的实际使用验收仍需桃子真实身份。
- `sessions.ts`首次合法登录会持久化唯一经营者的AppID/OpenID；之后只换环境变量会因数据库绑定不匹配而拒绝登录。用户测试数据保留，正式环境另建独立库/配置；未变更云端OwnerOpenID，未创建身份或会话。
- 用户提供的开发设置截图显示AppSecret栏为“重置/冻结”，代码上传密钥栏为“生成”；截图没有展示密钥内容。AppSecret用于后端微信登录换码，代码上传密钥用于自动化预览/上传，不能互相替代。未重置、生成或冻结任何密钥；优先由管理员寻找已保存的AppSecret，重置前须确认现有使用方。

## 2026-10-02 AppSecret 私密配置

- **用户报告已重置，服务器已保存**：用户告知自行完成AppSecret重置，随后通过Workbench终端的无回显输入填写。保存脚本仅替换`KITH_INN_WECHAT_APP_SECRET`，采用同目录600临时文件和原子替换；没有从聊天或旧记录复制密钥，没有调用微信后台重置操作。
- **保存及配置格式已验证**：只读元数据检查确认AppSecret非空、长度32、文件root/600、目录700；数据库/AppID字段仍非空，OwnerOpenID仍为空。专用Compose5.5.1读取实际私密配置执行`config --quiet`成功；未输出配置内容。
- 用户询问是否输入错误并请求重试或明文查看。已核对最近一次`configured: true`的成功保存结果，并解释`wechat_login_verified: false`仅表示尚未进行微信登录验证。没有再次覆盖成功保存的值，也没有将密钥明文显示。
- **真实接入未验证**：没有真实`wx.login`换码结果，不能证明AppSecret与AppID匹配或有效；没有绑定OpenID、创建会话、启动API或上传小程序。下一步由真实测试微信身份取得一次性code，复用现有服务端换码函数验证。

## 2026-10-02 微信开发者工具与原生编译

- **工具已安装、用户已扫码登录**：按用户要求通过Homebrew安装官方腾讯下载源的Apple Silicon版本2.02.2608060；macOS签名核对为Tencent Technology (Shanghai)，系统评估为Notarized Developer ID。安装位置`/Applications/wechatwebdevtools.app`，未清理既有应用或数据。
- **现有项目已导入**：以现有AppID导入`apps/kith-inn-miniapp/dist`，本地项目名“街坊味测试联调”，选择“不使用云服务”（复用阿里云后端）。没有注册小程序、启用微信云开发或上传代码；管理员成员/上传权限仍未完整核验。
- **原生编译问题已修复**：微信编译器报告`app-origin.wxss(1:8090)`的裸伪类选择器解析错误；将现用的直接子元素裸伪类改为对应元素的显式class，删除已无组件使用的旧`day-head`裸伪类规则。只调整CSS选择器及对应className，保留样式属性、布局、文案、业务逻辑和Q1～Q3。
- **已验证**：Node22.23.3、Taro4.2.0重新执行`build:weapp`通过，215模块；小程序包lint/typecheck通过。开发者工具原生WXSS错误消失，模拟器正常显示本周入口及既有“尚未配置街坊味服务”提示。API源站仍为空，这不是业务联调包或云API验收；未以假会话填充页面。
- **真实登录凭证已生成，换码待完成**：当前扫码账号在该AppID运行`wx.login`成功；凭证只进入系统剪贴板，不输出到控制台、报告或命令参数。自动剪贴板转送校验未通过，已准备服务器无回显输入，请用户粘贴一次；此时尚无服务端换码结果，不宣称AppSecret有效、OpenID绑定或API启动。


## 2026-10-02 真实微信换码与云端 API 首次启动

- **真实换码已验证**：用户在现有AppID的微信开发者工具内扫码，以该账号生成的真实`wx.login`凭证经服务器镜像中的`createWechatExchanger`成功换码。结果为`app_secret_verified=true`、`owner_configured=true`；真实OpenID原子写入root/600私密文件，未输出凭证或OpenID。该操作没有创建数据库经营者或会话，不能替代API登录验收。
- **执行问题已修正并复核**：首次一次性验证容器遗漏tmpfs，`tsx`在创建`/tmp/tsx-1000`时失败，未执行微信换码。补齐与Compose相同的64MiB tmpfs后，模块加载和真实换码均成功；正式Compose本来已包含tmpfs，未改业务代码。浏览器自动粘贴曾拿到旧辅助命令，误进入旧AppSecret输入提示；已空输入取消，返回`configuration unchanged`，随后恢复正确输入，由用户完成粘贴。
- **启动前实际检查通过**：可用内存2245MiB、根盘可用23357MiB，loopback3306空闲；库名/运行角色、四项必需配置、root/600及目录700均核对。云端Compose文件SHA-256与当前仓库一致，真实配置`config --quiet`通过。未重建数据库、未执行迁移或更改RDS配置。
- **云端API已部署**：使用独立Compose5.5.1，仅执行`up -d --wait --wait-timeout 60 kith-inn-api`。容器`cfp-kith-inn-staging-kith-inn-api-1`启动于2026-10-02T15:01:43.461499877Z（北京时间23:01:43）；源提交`2bb0e14982722e884f235fed53de2c187cc82fde`，镜像ID仍为`sha256:d3d4496e0a973640698e3658d956bafdd207a6d594a7a12f948a50ed7b8e2c42`，约30.7秒后Docker healthy。只绑定127.0.0.1:3306，没有公网API入口。
- **云端基础HTTP已验证**：health200、ready200；缺少会话401、未知会话401；非法JSON、空登录code、错误Content-Type均400。各响应含no-store和requestId，错误体requestId与响应头一致；检查响应及容器日志未出现数据库连接串、AppSecret或OwnerOpenID。
- **运行限制已实测**：USER=node、根文件系统只读、0.5CPU、512MiB内存且同额memory-swap、128PID、ALL能力移除、no-new-privileges、64MiB tmpfs及loopback端口绑定均与Compose一致。
- **本次部署没有重启其他容器**：官网StartedAt仍为2026-08-25T01:03:04.139905313Z；hello-agent在本次启动前已是2026-10-02T01:55:45.205213883Z，与10月1日旧记录不同，本轮不推测原因。两者在本次启动前后ID/StartedAt/restartCount完全一致，restartCount均0；未执行Nginx reload或其他应用部署。
- **待验证**：真实API会话正在准备（须使用新的微信code），菜品/周菜单写读、业务错误处理、重启持久化、非经营者真实拒绝、HTTPS/request域名与真机体验版尚未完成。
- **当前代码CI**：前端兼容修复`0b873735aa815a77a7371fc5194ec2deffd6d004`的verify和专用image检查均SUCCESS；PR #368仍OPEN/draft且MERGEABLE，未合并。服务运行版本仍为上述固定后端镜像。


## 2026-10-02 真实 API 业务与重启持久化

- **真实API登录已验证**：新的wx.login凭证经`POST /api/kith-inn/sessions/wechat`返回201，随后带真实会话读取菜品返回200、初始0项。该步骤创建真实经营者及会话，没有直接种身份或会话；token仅保存在ECS root/600的验证文件，未输出到参数、日志或报告。
- **云端业务17项检查通过**：初始空菜池、目标周不存在404、缺菜生成422；新增3道带“部署验证-2026-10-02”前缀的荤/素/汤菜；同幂等键重放返回相同结果，不同请求复用键409；包含重名项的批次409且没有留下新菜；有效修改提升版本，旧版本409；生成14餐，保存2026-09-28周并确认，周三午餐保留候选汤但标记不做汤；周保存幂等重放一致，旧周版本409；完整周读取、历史列表与最终3菜读取均200。
- **只重启街坊味容器**：`docker restart --time 15 cfp-kith-inn-staging-kith-inn-api-1`完成；新StartedAt为2026-10-02T15:15:15.180010876Z，随后Docker healthy，health/ready均200。原真实会话继续有效，菜品全部字段、14餐菜单/汤开关/版本/确认时间与重启前完全一致。
- **数据库对应记录已核对**：重启后在实际容器中用既有受限连接池执行BEGIN READ ONLY，核对唯一经营者与配置匹配、该会话有效，并直接查询对应菜品和周菜单的全部API字段；与重启前快照及重启后API结果严格一致。确认3菜、1周，pool.max=5、SSL=false，随后ROLLBACK；不是只用行数判断持久化。
- **影响范围已复核**：官网及hello-agent的ID/StartedAt/restartCount与本次部署前基线一致；运行日志未出现token、数据库连接串、AppSecret或OwnerOpenID。测试菜品和菜单保留，未清理任何既有用户/学习数据，也未更改业务代码。
- 仍未完成：另一真实微信账号被拒绝、HTTPS代理来源/限流、微信手机上的登录与完整业务流程、体验版上传/验收；以上API验证在ECS loopback进行，不冒充真机或公网验收。

## 2026-10-02 HTTPS 入口准备阶段（后续启用结果见下一节）

- 建议测试域名`kith-inn-api-staging.codeforpeople.cn`，按原方案在测试域名中保留staging。阿里云DNS控制台精确查找返回0条，ECS真实DNS解析也为空；本机dig受代理fake-IP影响，不作为公网记录证据。已从ECS详情核对公网IP为47.107.114.112。
- 现有Nginx配置通过检查，没有街坊味vhost。服务器已有`/usr/bin/certbot`、Let’s Encrypt正式ACME账号、webroot`/var/www/certbot`及启用的`certbot-renew.timer`，可以复用；未安装新工具、未改已有证书或续期配置。
- 三份独立候选配置已保存在ECS `/opt/kith-inn/https-staging`：`bootstrap.conf.prepared`仅为目标域名开放ACME验证；`https.conf.prepared`复用现有街坊味代理示例，转到loopback3306；`reload-kith-nginx.sh.prepared`只在该域名证书续期后校验并平滑reload Nginx。文件不在Nginx生效目录。
- Bootstrap合并现有站点做`nginx -t`通过；最终HTTPS候选用现有证书替换路径进行离线语法检查通过，目标域名证书尚未签发，不能宣称TLS有效。未新增DNS记录、未启用vhost、未reload Nginx。
- 实际保持Host→API连接并查看容器socket，确认可信代理候选peer为172.23.0.1；尚未写入私密配置，来源限流和伪造头验证须在代理启用后执行。
- 下一动作会把当前仅本机访问的测试API变成公网HTTPS入口；准备完成后集中确认这一步的域名与公开访问范围，再执行DNS、独立证书及新vhost启用。其他站点配置、数据库和3306公网暴露范围不变。

## 2026-10-02～03 HTTPS 启用与原生登录阻塞

- **公网范围已获用户确认、DNS已添加**：用户同意专用测试域名公开HTTPS访问。阿里云A记录`kith-inn-api-staging.codeforpeople.cn`→`47.107.114.112`于10月2日23:40:04（北京时间）保存，TTL10分钟；ECS解析匹配。未修改其他DNS记录或开放3306安全组。
- **独立证书与vhost已部署**：复用现有Certbot账号/webroot，为该域名签发独立Let’s Encrypt证书，SAN匹配；有效期2026-10-02 14:43:31至12-31 14:43:30 UTC。仅新增`/etc/nginx/conf.d/kith-inn-staging.conf`；HTTP保留ACME路径，其余308跳转HTTPS；HTTPS仅代理`/api/kith-inn/`到loopback3306，其他路径404。bootstrap和最终配置均通过`nginx -t`后平滑reload，Nginx master PID80536不变，既有站点文件未改。
- **可信来源已配置**：现场socket确认的172.23.0.1写入本应用私密配置，Compose quiet校验后只重建街坊味容器；StartedAt=2026-10-02T15:43:05.939869973Z，healthy，restartCount=0，实际镜像仍为2bb0e14。root/600不变，日志未发现配置凭据或验证token。
- **公网与代理已验证**：本机外部网络访问校验证书域名/证书链后health/ready均200，未登录业务401；连续21次非法登录，前20次400、第21次429，逐次伪造X-Real-IP/X-Forwarded-For不能绕过。另一ECS来源独立获得20次预算、第21次429；容器内非可信peer伪造来源仍429。带真实会话经HTTPS读回的完整菜品和菜单与之前快照严格一致；HTTP308、非API路径404实测通过。
- **证书续期已验证**：只对该证书执行`certbot renew --cert-name kith-inn-api-staging.codeforpeople.cn --dry-run --no-random-sleep-on-renew`，退出0、模拟续期成功；webroot及专用deploy hook已持久化，hook语法通过，现有timer active/enabled。hook位于`/opt/kith-inn/https-staging/reload-kith-nginx.sh`；没有手动执行其他证书续期。
- **其他应用保持原样**：官网和hello-agent的容器ID/StartedAt/restartCount与本次启动前一致，未执行其他应用部署。HTTPS现状为根域308、www200、hello-agent子域302且TLS均验证通过；origin3302为200、3310为307。验证脚本最初把origin状态误当HTTPS预期，断言失败；核对协议/站点后修正预期并复验成功，未把正常跳转当作站点故障。
- **小程序HTTPS包已构建、原生兼容缺陷已定位并修复**：配置现有AppID和上述HTTPS源站，保留urlCheck=true及已有私有开发者配置。原生wx.login能返回真实凭证，但Zod对象校验在微信禁用动态Function正文的环境误走JIT，抛TypeError，请求未发出。复用已安装Zod的jitless设置，在小程序入口、页面schema加载前初始化；独立runtime导出不改变后端默认设置、schema或业务规则。临时诊断已移除；无新增依赖、无根锁文件/共享发布配置修改。
- **修复版本与回归检查**：实现提交`fa585b567f3d6cca869a20892408c703b69c2bcc`；新增无动态Function环境的严格输入回归检查，小程序62项、契约43项均通过；根`pnpm verify`成功（lint/typecheck/coverage/knip/build），API105项通过。首次重开本任务独立PG时动态宿主端口变化，旧私密测试URL报ECONNREFUSED；按实际端口修正后完整重跑成功，未连接云库或用户试用库。验证后仅停止本任务PG容器并保留数据。最终重新构建真实HTTPS weapp包，AppID/源站/urlCheck/private配置核对通过，临时诊断已移除；main..该提交发布目标为website=false、weekly_menu=false。
- **当前真实阻塞**：修复后10月3日00:00:41（北京时间）开发者工具明确报`request 合法域名校验出错`，目标域名不在名单。未关闭域名/证书校验；已请用户或管理员保留旧域名并添加该HTTPS request域名。站点安全策略禁止代理操作微信后台，未绕过。当前不能称小程序登录、手机业务或体验版完成；服务端真实API登录与云端数据验证已完成。

---

以下为历史证据，不代表当前云端状态。

# 街坊味运行与试用证据（#360 / PR10）

记录日期：2026-09-21。执行环境：专属 `codex/kith-inn-release` worktree，起点
`aacfdcb613b7e859e4c1710409ce82845a68abaa`（依赖PR尚未合并）。
本文件只记录本Issue；准备完成不代表产品验收、真机完成、部署或上线。

| 项目 | 状态与实际证据 |
| --- | --- |
| T020 独立镜像、配置 | 已实现，ca5b275干净提交镜像、受限PG及实际只读compose复验通过。Node22、非root、3305 loopback、只读根文件系统 |
| T021 目标识别、CI | 已实现且目标识别/compose回归通过：API/契约独立镜像，菜单小程序/文档不选其他产品；共享配置保留原有全目标兜底 |
| T022 运行手册 | 已编写 [KITH_INN_RUNBOOK](../../../apps/kith-inn-api/deploy/KITH_INN_RUNBOOK.md)，已按菜池演练核对；补齐失败停止和干净提交检查 |
| T023 AppID/现有权限 | **未核验**：源码示例不能证明真实现有小程序配置；维护者安全环境核对 |
| T023 HTTPS request域名/证书 | **未核验**：Nginx使用保留示例域名，无生产配置来源 |
| T023 AppSecret/桃子身份绑定 | **未核验**：仅服务端安全配置，未索取或输出密钥；没有真实绑定证据 |
| T023 微信登录/非桃子拒绝/双设备 | **未做**：测试身份和H5不得替代真实微信 |
| T023 完整菜单保存重开/复制 | **未做**：依赖 #358/#359 和真实微信环境，不能以菜池代替 |
| T024 1000菜/104周/3并发 | 已核对并复用#358服务层实测（见下），102次/项、3并发；不含HTTP/公网/微信，未在本片重复运行 |
| T024 备份隔离恢复 | 菜池样本已通过；完整菜单/停用历史快照恢复仍未做，依赖 #358/#359 |
| T024 退出删除 | 五表自有样本事务删除通过；用户主库、备份、托管快照没有执行删除 |
| 保留/RPO/RTO/责任人 | **待定**：7天备份、24小时RPO、4小时RTO仅原技术建议，不是用户承诺 |
| 托管快照/PITR/介质残留处置 | **未核验**：SQL DELETE/删归档不等于介质与托管残留销毁；未解决前不得宣布退出删除完成 |
| 桃子实际使用一周 | **未做**：完整主流程就绪后集中试用，不提前逐模块验收 |

## 用户集中试用清单

第一轮：协调者统一提供**固定本地H5入口（受控测试身份、真实API/PG）**，完整流程就绪后集中检查；无需审代码或PR，不等待真实AppID。入口沿用协调者维护的环境，本任务不替换3317/3319。

1. 菜品池：每行录入一道会做的菜，核对/修正荤素汤，再确认加入。
2. 选目标周，勾选要做的午晚餐，设好本周荤素汤数量，生成菜单。
3. 手选替换一个指定菜；去掉周三午餐、周五晚餐的汤，核对其他餐不变。
4. 保存并确认，退出重开，核对还是同一份菜单。
5. 选一餐复制文字并粘贴检查完整日期、午晚餐、菜名与去汤结果；本地剪贴板不算微信真机证据。
6. 回来继续换菜并保存，再复制，检查新文字；若之前已发送，自行通知邻居旧消息不会更新。

第二轮：维护者安全配置核验后，在**现有微信小程序**验证真实登录/非桃子拒绝、保存重开、另一台设备读取、微信剪贴板及粘贴；实际发送由桃子完成。本地测试身份和浏览器会话不能替代这一轮。

分别记录两轮实际日期、周起始日、设备/浏览器或微信版本、构建提交、看到的问题及是否可直接照菜单供餐。
改结构取消/失败留稿、缺菜整次失败、保存/复制异常由agent验证；不要求用户造错误或读日志。

## 后续补证入口

#358周菜单任务 `01a0c161-57ef-7610-add1-91c01699618f`；
#359复制任务 `01a0c161-b3d5-7f00-8fb0-96e72fe42f9d`。
依赖可用后在同一#360任务继续：完整样本备份→新隔离库恢复→新会话应用读回、历史快照一致；
再执行1000菜/104周/3并发实测。真实微信与运营承诺仍须单独核验，不能用自动化绿灯代替。

## 本轮独立验证记录

2026-09-21，本地 Node22.23.2、pnpm10.2、TZ=UTC，独立 PG17 容器
`kith-release-drill-20260921083746-883a-pg`（56876端口），专库
`release_kith_verify_test` / `release_weekly_verify_test` / `release_website_verify_test`：
根 `pnpm verify` 通过，H5 E2E 6/6通过，H5/weapp构建通过。首次并行build覆盖同一dist使E2E失败，串行重跑6/6通过；没有改业务代码。
目标识别与街坊味部署配置测试通过；未手动调用其他产品发布，现有PR CI保守识别共享文件的行为不变。
本片无业务页面改动，沿用已有 `apps/kith-inn-miniapp/design-qa.md`，无新增原型截图/视觉验收声明。

初次镜像是起点aacfdcb加本片未提交Dockerfile的开发演练，不充作最终提交镜像证明。
2026-09-21 00:37:46–00:38:06 UTC，24项检查（含验证专库准备）通过：
迁移前health200/ready503，两次迁移3.477/3.273秒，runtime DML角色拒绝建角色/建库/建表。
真实HTTP新增/读回3菜；16,307字节custom备份0.115秒，隔离恢复0.801秒；
清会话/回执后旧token401，新人工会话应用读回同样菜品；
退出前五表计数1/2/4/1/1，事务删除后全0，新旧token401，自有归档已删除。
week_plans仅人工占位JSON用于删除约束检查，不能当成完整菜单保存恢复。
源样本与自有Docker卷保留供验证，未做物理擦除或托管快照删除。
复现遵循运行手册；本机临时脚本 `/tmp/kith-release-drill.py`（每次新建唯一资源）、
脱敏结果 `/tmp/kith-release-drill-initial-result.json`；不把含凭据wrapper或真实数据纳入仓库。

## 干净提交镜像复验与审查

2026-09-21 00:44:01–00:44:14 UTC，提交 `ca5b275c256dc37d292b53b0e948d3b171084938`，
镜像 ID `sha256:3ce954f8d58ae25a6edf104cf3f05467468925fad2a16c4dcabb8188ba2a34e2`。
新隔离资源前缀 `kith-release-drill-20260921084401-af9d`，PG17端口60251，
源/恢复API端口60260/60296，实际compose端口60367；未占用共享PG或3317/3319预览。
完整重复上述24项检查通过；备份16,302字节/0.110秒，隔离restore0.688秒，五表退出删除0.340秒。
实际compose的非root、只读根、ALL能力移除、no-new-privileges已检查；根目录写拒绝、tmpfs可写、ready200，
通过compose重复迁移0.602/0.619秒。仅本机PG与人工菜池；不推导RPO/RTO承诺。

修正记录：初版只读容器通过pnpm启动时Corepack试图写缓存失败，ca5b275改为直接Node启动与迁移后通过。
一次演练脚本把PG临时Unix socket就绪误作最终就绪，改TCP检测后重跑；没有修改业务代码。
脱敏证据为 `/tmp/kith-release-drill-result.json`、`/tmp/kith-release-drill-compose-result.json`；
运行步骤见手册，本机复现使用 `KITH_DRILL_IMAGE=cfp-kith-inn-release:verified python3 /tmp/kith-release-drill.py`，
再运行 `/tmp/kith-release-drill-compose.py`。脚本仅创建唯一新资源，测试身份不可用于真实登录。
演练后只停止已核对归属的自有容器，保留假数据卷；不声称物理擦除，临时私密文件不进仓库。

独立审查 `aacfdcb..ca5b275` 无待修问题。PR #368 为取得仓库既有CI而以main为目标，
包含未合并依赖 #361～#367；本片审查范围仍为 `aacfdcb..HEAD`，约450行，未重拆任务。
CI以本证据提交的最新head为准，结果留在PR/Issue执行记录；不引用旧依赖绿灯充数。

协调方另对ca5b275容器入口进行了只读窄范围复核，无可行动问题；它是代码复核，实际运行证据仍以上述隔离演练为准。

## 复用 #358 的规模性能证据

2026-09-21 00:43:07.410 UTC，#358执行者测量，本任务读取并核对脚本与原始JSON，未重复跑其专库。
代码 `4cdc392`（前置算法`ab08468`，分支`codex/kith-inn-week-api`，未合并；尚未进入本片镜像）。
环境由执行者记录：Apple M5/32GiB/macOS26.6.2、Node22.23.2、TZ=UTC、Docker PG17.10 aarch64，
localhost54325独立 `cfp_kith_weeks_perf_test`；本任务没有清理或更动该库。
1000菜（荤400/素400/汤200）、104保存周，每周14餐、2荤2素1汤；每项预热12次，3并发×34=102样本。

| 操作 | p50 / p95 / max（毫秒） |
| --- | --- |
| 读取已保存周 | 0.87 / 1.38 / 2.08 |
| 列表12项 | 0.59 / 1.21 / 1.65 |
| 生成14餐 | 19.52 / 37.43 / 43.78 |
| 保存14餐 | 23.00 / 28.73 / 33.96 |

测量真实Weeks/Sessions/PG调用，保存含账号锁、会话复核、版本、快照、回执与事务；
不含HTTP路由/限流、TLS、公网传输、微信或UI。各项满足服务层p95≤1秒初始预算，不是上线性能承诺。
本机脚本 `/tmp/kith-weeks-perf.mts`，脱敏原始输出 `/tmp/kith-weeks-perf-result.json`；
脚本直接导入#358 worktree实现且首次seed，不可直接重跑既有专库。复现须用相同提交的新checkout、
新建自有 `_test` 库并同步脚本严格库名保护和导入路径；不要清理#358的库。
该实测不替代完整菜单恢复或真实微信试用，T024仍有待办。
