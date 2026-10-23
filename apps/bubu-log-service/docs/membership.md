# 免费服务权益

#398 按宝宝共享聊天和群采集权益，身份、照护授权和服务权益分别检查。首期只有“限时免费”说明，无购买入口、价格或体验天数默认值。生产 `createRuntime` 始终在同一 IdentityService 上安装服务检查；单独的旧单元测试可不安装此可选接缝。

## 状态与客户端

`GET /api/app/membership?babyId=…` 使用现有 Cookie/Bearer 和宝宝授权，返回 `Cache-Control: no-store`：

```json
{"babyId":"example","version":0,"configured":false,"checkedAt":"2026-10-23T00:00:00.000Z","status":"free","label":"限时免费","message":"当前限时免费，尚未设置截止时间；不会自动收费。","startsAt":null,"endsAt":null,"entitlements":{"chat":true,"collection":true,"history":true},"payment":{"enabled":false}}
```

`status` 为 `free/scheduled/paused/expired`，只描述时间与人工状态，真正可用性由服务端 `entitlements` 决定。优先级为人工暂停、未到开始时间、到达截止时间、免费。开始时刻包含在服务期内，截止时刻已到期。截止时间未设到期策略时，状态可为 expired，但两项服务仍继续。没有配置行才使用版本 0 默认值；读取失败或配置损坏返回 `503 MEMBERSHIP_UNAVAILABLE`，不会当作免费。

暂停或未开始返回 `423 SERVICE_PAUSED/SERVICE_NOT_STARTED`，明确到期停服返回 `423 SERVICE_EXPIRED`；三者 `retryable:true`。恢复后可继续原请求。客户端保留身份、宝宝与草稿，菜单每次打开获取最新状态；读取失败显示重试，不用旧状态推断权限。历史、私人对话历史、记录图片、统计、修订及待补仍按原宝宝授权可读；401/403 的撤权语义保持原样。

## 原生运营后台

`/admin` 首页“服务权益”页展示当前版本、配置、能力和最近 100 次变更。管理员和运营只可管理显式范围内的宝宝，审计角色只读。日期在后台按北京时间输入并转换为 ISO；空值表示未设置，不能隐式填体验期。

沿用 `POST /api/ops/action` 信封 `{babyId,requestId,reason,command:{type:"membership",input}}`。请求号稳定，理由必填；每个 input 都必须含 `expectedVersion`：

| action | 其他字段 | 行为 |
| --- | --- | --- |
| configure | startsAt、endsAt、expiryPolicy，均须显式给值或 null | 更新配置并保留人工暂停 |
| extend | endsAt | 仅延长已有截止时间，不自动恢复暂停 |
| pause | 无 | 人工暂停聊天及采集 |
| resume | 无 | 清人工暂停；仍遵循原开始、截止和到期策略 |

非空 `expiryPolicy` 必须同时指定 `{chat:"continue"或"pause",collection:"continue"或"pause"}` 并有明确截止时间。两个起止值非空时要求开始早于截止。旧版本返回 `409 MEMBERSHIP_VERSION_CONFLICT`；相同请求号不同参数或理由拒绝；重放原请求返回原回执。UI 保留编辑开始时的版本，刷新发现变化后要求重新载入，不把旧草稿套用新版本。

配置、不可变更历史与审计共用原 Payload 事务，后台普通集合 REST/CRUD 不允许改写。已有配置的历史回执保留当时状态；当前展示必须重新查询。原始审计由同库备份保护，并非防数据库管理员篡改的密码学日志。

## 正在执行的工作

聊天在提交、模型轮次、工具执行及回复保存边界重查；录入在每次旧库投影和统计写入前重查；附件在保存前后重查；采集在 begin/stage/media/plan/receipt/finish/heartbeat 处重查。失败释放、状态查询、配置和恢复元数据不受权益停服阻碍。

事务内已通过检查并发出的远程写入允许完成；运营暂停不能撤销已发出的网络请求。旧库写入成功后的检查点即使遇到暂停也持久保留，恢复沿用原 requestId/turn/step/sourceId，避免重复事实、重复统计与跳过未确认消息。采集源与模型提供方可能在暂停前已经收到请求；本层保证后续受控副作用被重新检查，不声称取消外部计算。单进程、旧站 CAS 与公开旧照片限制沿用 ADR-0002/0004。

## 隔离联调

先构建服务及 sidecar H5，再运行 `pnpm --filter @cfp/bubu-log-service test:fullstack-server`（仅允许 NODE_ENV=test，脚本已设置）。默认本机 4368，启动真实原生 Payload Admin 与同一运行实例，静态托管 H5。旧后端、微信、图文 provider 和群消息均为明确命名的示例 fixture；不接受真实微信 code、不调用真实模型、不读取客户群。

脚本输出私有 `fixture.json` 路径，其中有随机运营密码和测试 token，不提交、不截图这些凭证。运行 `pnpm --filter @cfp/bubu-log-service test:membership-http <fixture.json绝对路径>` 验证原生登录、免费、暂停、历史读取、同请求恢复、聊天进入日历、到期延长和受控采集。验证使用独立示例联调宝宝，结束恢复原策略并停采集；浏览预览宝宝不受影响。结束时仅关闭本次 fixture 进程。

生产迁移验证覆盖空库及身份、录入、聊天、运营四个旧版本，核对旧 JSON、时间、会话、后台约束和重开持久化。浏览器与合成 SQLite 通过不能代替真实环境验收。

## 上线前仍需验收

需配置真实 AppID/secret、HTTPS/request/downloadFile 域名、旧 CMS 和图片来源、图文模型服务；取得授权后验证真机微信登录、真实模型与订阅采集适配、长任务跨到期、角色撤销和完整备份恢复。旧站并发写入窗口须关闭或改为数据库原子版本接口。真实客户迁移和生产部署未在本次执行。

所有 `/api/payments/*` 已登录请求及 `DisabledPaymentProvider` 操作返回不可重试的 `409 PAYMENT_DISABLED`；无启用环境变量、下单、收费和退款副作用。未来支付的验签、查单、去重、退款与状态迁移约束见 [支付关闭边界](payment-disabled.md)。
