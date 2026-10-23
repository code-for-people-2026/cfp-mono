# 哺哺日记身份服务

[模块 #396](https://github.com/code-for-people-2026/cfp-mono/issues/396) 位于 [可视化 PR #399](https://github.com/code-for-people-2026/cfp-mono/pull/399) 之后，供后续 MCP、内置聊天、群绑定、运营和会员复用。所有新增代码在 cfp-mono；原 `sunmer-home/apps/bubu-log` 固定版本 `ac86de31b08bdf413e021e60240da2dcd8e63911` 只读参考，无真实数据迁移、群采集、支付或生产部署。

## 可运行结构

- `src/wechat.ts`：服务器向微信 `jscode2session` 交换真实 `wx.login` code。AppID 来自服务器配置；不接收客户端 openid/unionid，不返回 session_key。缺配置失败关闭，主程序无假登录分支。
- `src/identity.ts`：会话、旧账号绑定、新家庭、邀请/撤权、当前宝宝、运营及 Agent 授权。
- `src/store.ts`：独立 Payload SQLite，身份数据不写入聊天或旧业务集合；`src/migrations` 提供空库生产初始化迁移。凭证保存 SHA-256 摘要，原始 token 只在签发时返回；微信映射保存 AppID+openid 摘要。密码和临时 NextAuth cookie 不入库。
- `src/legacy.ts`：原 NextAuth CSRF→Credentials→Session 验证 user.id；临时 cookie 用完丢弃。旧服务的专用 CMS 账号只在服务器登录并刷新 JWT，通过白名单读 BabyUser、Baby、Activity、DailyStat；不会提供任意集合代理。记录字段、原日历 GET 查询语义和已保存统计保持不变。
- `src/media.ts`：活动照片代理重新核验宝宝与 `media:read`，只取配置的 HTTPS 图片来源，限制类型/大小且不跟随重定向。旧已公开 URL 本身不因此变私有。
- `src/http.ts` / `src/main.ts`：真实 Node HTTP 入口，严格输入校验、16 KiB JSON 限制、登录速率限制、H5 Origin 校验与 HttpOnly/SameSite Cookie、原生 Bearer。不开通 Payload REST 或默认 CMS 管理界面。

默认个人会话 7 天、聊天委托 15 分钟（不超过父会话）、采集凭证 1 小时、运营 CLI 凭证 1 小时。这些是可撤销认证有效期，不是免费体验期或会员权益。首期限时免费，支付不启用。

## 本地启动

需要 Node 24 和 pnpm 10。此主机使用：

```sh
export PATH=/Users/sunmer/.nvm/versions/node/v24.22.1/bin:$PATH
pnpm install --frozen-lockfile
# 在独立的测试旧服务配置专用 CMS 账号；环境变量参考 .env.example。
export BUBU_LEGACY_ORIGIN=http://127.0.0.1:1030
export BUBU_LEGACY_CMS_EMAIL='your-test-cms-account'
# BUBU_LEGACY_CMS_PASSWORD、BUBU_WECHAT_APP_ID/SECRET 从私有配置注入。
export BUBU_PUBLIC_ORIGIN=http://127.0.0.1:10086
pnpm --filter @cfp/bubu-log-service dev

# 另一个终端：H5 原账号登录；浏览器的实际 origin 必须与上述配置一致。
BUBU_AUTH_MODE=sidecar BUBU_DEV_PROXY=http://127.0.0.1:3320 pnpm --filter @cfp/bubu-log-miniapp dev:h5
# 微信产物需要本产品 AppID、HTTPS 服务与微信后台域名配置。
BUBU_AUTH_MODE=sidecar BUBU_API_ORIGIN=https://your-bubu-service.example pnpm --filter @cfp/bubu-log-miniapp build:weapp
```

未配置微信凭证时，微信登录返回 `WECHAT_NOT_CONFIGURED`，H5 旧账号路径仍可使用。未配置旧 CMS 凭证时不会返回伪造宝宝列表。`GET /health` 仅表示进程可响应，不宣称微信或旧服务已联通。旧版小程序构建默认 `BUBU_AUTH_MODE=legacy`，保持旧 H5/原生 NextAuth 路径；新模式显式配置 `sidecar`。

生产入口 `pnpm --filter @cfp/bubu-log-service start` 要求 `NODE_ENV=production`、HTTPS `BUBU_PUBLIC_ORIGIN`、持久独立的 `BUBU_IDENTITY_DIRECTORY`、显式 `BUBU_PAYLOAD_SECRET`。启动运行已提交迁移，不做开发 schema push。首次本地开发会生成私有随机 secret 与 SQLite 文件；开发库不要直接当生产库使用。首版按单进程服务运行，SQLite 事务负责数据原子性；不声称分布式运行或旧服务写入的跨库原子性。备份身份目录（数据库、WAL/SHM 如存在、secret）需先停止服务或使用一致的 SQLite 备份，再与旧业务库配套保管。

## 客户端 HTTP 契约

请求 JSON，原生 `Authorization: Bearer <token>` + `X-Bubu-Client: native`；H5 同源 Cookie + `X-Bubu-Client: browser`，所有变更需 Origin 与 `BUBU_PUBLIC_ORIGIN` 一致。浏览器会话不能改用 Bearer，原生 token 不能放入 Cookie。

| 方法和路径 | 输入 | 输出与约束 |
| --- | --- | --- |
| POST `/api/identity/wechat` | `{code}` | 原生 `{token,expiresAt,context}`；openid 只来自微信 |
| POST `/api/identity/legacy-login` | `{username,password}` | H5 `{expiresAt,context}` + Cookie；原生返回 token |
| POST `/api/identity/bind-legacy` | `{username,password}` | 证实旧凭证后原子绑定、旋转当前 token；旧账号已存在 H5 身份时合并到规范身份 |
| POST `/api/identity/family` | `{name}` | 已验证但未绑定旧账号的身份创建宝宝；返回 `{context}`；完成后重试只读取，不能复活旧 BabyUser |
| POST `/api/identity/logout` | `{}` | 撤销当前服务端会话；它派生的聊天委托同步失效 |
| GET `/api/app/auth/context?babyId=…` | 可选宝宝范围 | 现有 context + `identityId,legacyLinked`；明确越权宝宝返回 403；无参数恢复最后仍有权的宝宝 |
| POST `/api/identity/invitations` | `{babyId,access:"read"或"write"}` | 管理者获得一次性 `{code,expiresAt}`，默认一天 |
| POST `/api/identity/invitations/accept` | `{code}` | 已登录照护者接受，返回 `{context}`；本人重试幂等，不能恢复已撤权 |
| POST `/api/identity/grants` | `{babyId,subjectId,state,permissions?}` | 管理者可撤销，只有运营可直接授予；普通用户使用邀请；不能修改自己的管理权限 |
| POST `/api/identity/group-bindings` | `{babyId,groupId,agentId,active}` | 仅相应宝宝运营身份；groupId 应包含平台来源账号与群稳定标识 |
| POST `/api/identity/agent-credentials` | `{babyId,kind,groupId?,agentId?}` | 照护者签发当前宝宝聊天委托；运营按有效群绑定签发采集凭证 |
| GET `/api/app/user-babies`、`activities[/latest或/id]`、`daily-stats[/date]` | 原可视化参数 | 经过同一宝宝权限检查；Activity/DailyStat 语义保留；照片 URL 投影为受保护代理 |
| PATCH `/api/app/user-babies/:id?babyId=…` | `{name,fullName}` | 同一宝宝名字更新与原长度/同用户重名校验 |
| GET `/api/app/media/activities/:id?babyId=…` | 当前登录凭证 | 按记录的真实 babyId 校验，返回 `private,no-store` 图片；微信端下载临时文件后预览 |

`context` 保持 `authenticated,hasBaby,baby,babies,defaultBabyId`，新增 `identityId,legacyLinked`。无宝宝的微信新身份可创建家庭、验证旧账号或接受邀请；受邀身份无需绑定旧账号即可读宝宝。旧账号本人没有 BabyUser 时保留身份并引导运营/原系统关联或接受邀请；不猜测或自动分配旧宝宝。重新微信登录恢复同一身份，旧账号密码错误 `LEGACY_CREDENTIALS_INVALID` 不撤销微信身份。401 `UNAUTHORIZED` 清当前视图并重新登录；403 `BABY_FORBIDDEN` 清宝宝视图并刷新授权列表；旧服务错误 502/503 不伪装成空记录。

原 BabyUser 没有宝宝管理者角色。已有关系继承原查看/记录/改昵称能力，**不**按全局 DAD/MOM/ADMIN 等称谓自动授予照护者管理权；运营核对后显式授予。新家庭的创建者取得宝宝管理者资格。每次读取、媒体和写入授权都重新读取原用户/BabyUser，原关系移除生效；新邀请不会把已有旧关系变成永久旁路。Sidecar 撤权压过原关系，并保守作废该宝宝所有未接受邀请码，需管理者重新邀请。切换宝宝或退出会清理客户端已下载照片，但已被用户另存或旧站公开的文件不能远程收回。

## 后续模块的唯一身份接缝

`IdentityService.authenticate(token, "bearer")` 从持久化凭证产生 `Principal`。禁止从请求 JSON、模型输出、群昵称或 senderId 构造 Principal。每个 MCP 工具调用都重新鉴权，不能只在建立连接时验证。

```ts
// requestAuthorization 来自服务运输层，不进入提示词或工具参数。
const principal = await identity.authenticate(requestAuthorization, "bearer");
// Agent 的宝宝/群来自已验证凭证；人类选择的宝宝也须由服务授权检查。
const babyId = principal.babyId!;
await identity.executeAuthorized(principal, babyId, "records:write", async (scope, req) => {
  // 先按真实资源归属检查记录/附件；不可用模型给的 babyId 替代资源的 babyId。
  // 后续记录模块在此调用自己的领域规则，并给所有 Payload Local API 传入 req。
  // scope.actor 保存 caregiver / chat-agent / collector / operator 与 onBehalfOf。
  return recordModule.update({ scope, req, input: validatedToolInput });
}, principal.groupId);
```

- `executeAuthorized` 在同一个 sidecar 事务内重新验证会话和授权并执行业务 callback；异常回滚。`Store.transaction(req => …)` 可直接供领域模块多行事务使用。下层通过 `openStore({directory,extensions:[…]})` 注册新的独立 Payload 集合并提交迁移，使用同一 `store.payload` 和传入的 `req`；不要另建内存事实仓库或第二个聊天专用 Store。
- 当前 `LegacyBackend` 的读取/家庭创建/名字更新适配不是后续 MCP 唯一可用的写入协议。本层没有暴露旧 POST Activity 冒充安全写入。下层应扩展领域专用适配或迁入原业务逻辑，保留旧字段/关系，并用独立候选/幂等/修订集合处理旧 POST 非幂等、物理删除、PATCH 字段缺漏及跨库恢复；不得把一次 sidecar 事务说成覆盖远程 HTTP。
- 聊天通过照护者真实会话签发短期 `chat-agent`，审计 Actor 是 Agent 且带 `onBehalfOf`；父会话退出、到期或宝宝授权撤销均拒绝。凭证只在服务器连接层保管。
- 采集必须提供凭证内匹配的宝宝和群，绑定暂停、更换 agentId、跨群或跨宝宝均拒绝；群发送者仅作为来源信息保存。
- 运营使用本地 `pnpm --filter @cfp/bubu-log-service operator <operator-id> <baby-id>` 签发受限短期凭证；只打印一次，不交给模型或客户端。运行者必须有该机器身份库和服务配置访问权。后续 Payload 运营 UI 接入相同领域方法并建立管理员登录映射，不从普通照护者推断运营身份。
- 会员模块在身份授权之后单独检查服务权益；本层不会用免费到期决定宝宝归属，不会删历史。

## 验证和外部验收

```sh
pnpm --filter @cfp/bubu-log-service typecheck
pnpm --filter @cfp/bubu-log-service lint
pnpm --filter @cfp/bubu-log-service test
pnpm --filter @cfp/bubu-log-service test:production
pnpm --filter @cfp/bubu-log-service build
```

测试使用隔离临时 **真实 Payload SQLite** 身份库，注入微信 provider 和合成旧业务后端；协议测试另注入 fetch 验证真实适配器的请求/响应。覆盖重启、过期、绑定、邀请并发/事务中断、撤权重放、宝宝/群/Agent 隔离、媒体和 H5 CSRF；这不等于真实微信 AppID/secret、微信真机或现有客户数据库联调。生产初始化测试以 `NODE_ENV=production` 对空临时库执行已提交迁移并重开核对。

上线前仍需配置本产品 AppID/secret、HTTPS和微信 request/downloadFile 域名、专用旧 CMS 凭证、真实照片来源 allowlist；用隔离账号验收真实微信登录、旧账号绑定、跨宝宝/撤权、后台角色核对、数据备份。此次没有读取真实客户群、连接真实业务库、迁移旧数据或启用支付。旧照片公开历史是仍待后续私有附件迁移治理的限制。
