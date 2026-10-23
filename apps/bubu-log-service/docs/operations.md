# 后台运营接入

原生 Payload Admin 位于 `/admin`，其 REST 位于 `/api/cms`。使用现有 `dev`／`start` 入口启动整个服务，不运行独立 Next 进程。生产先执行 `build`，设置 HTTPS 的 `BUBU_OPS_ORIGIN`、`BUBU_PUBLIC_ORIGIN`、持久 `BUBU_IDENTITY_DIRECTORY` 和私有 `BUBU_PAYLOAD_SECRET`。反向代理须保留 Cookie、Origin 和流式请求；前台 origin 与运营 origin 可不同，但必须分别精确配置。

## 初始化与角色

停服务后，通过私有环境注入 `BUBU_OPS_ADMIN_EMAIL`、至少 14 位的 `BUBU_OPS_ADMIN_PASSWORD`、逗号分隔的 `BUBU_OPS_ADMIN_BABY_IDS`，运行 `pnpm --filter @cfp/bubu-log-service cms:admin`。应使用服务同一目录、Payload secret 与生产环境设置；仅可创建首位管理员，输出不包含密码。随后清除初始化变量并启动服务。没有公共首注册或默认密码。未配置邮件恢复，忘记密码入口失败关闭；其他管理员可在原生账号编辑中重置，最后一名管理员不可删除、禁用或降级。

| 角色 | 能力 |
| --- | --- |
| 管理员 | 管理运营账号及其范围、查看账号审计，并处理自身明确宝宝范围内的运营事项 |
| 运营 | 处理明确宝宝范围内的授权、绑定、采集、记录及敏感核对；不能管理运营账号 |
| 审计只读 | 查看明确宝宝范围内的安全元数据、运行与权限审计；不能读取完整事实、原文或图片正文 |

空宝宝范围不授予任何家庭访问。照护者、聊天委托、采集凭证均不能登录运营后台。运营会话使用独立 HttpOnly、SameSite=Strict Cookie，生产/HTTPS 设置 Secure，响应不返回 JWT 或会话数组。原生与业务写操作严格检查 `BUBU_OPS_ORIGIN`，不接受 Bearer 作为运营登录。账号停用或移除宝宝范围对已有 Cookie 和未到期业务委托即时生效。

## 工作流程

1. 选择宝宝，填写核对／操作理由。昵称与照护授权复用原身份服务，旧 BabyUser 关系只显示继承状态，不另存副本。
2. 在群绑定与采集栏填写来源账号、以 `@chatroom` 结尾的稳定群 ID、Agent ID；先绑定，再配置间隔和开通状态。群 ID 使用 `wechat:<accountId>:<chatId>`。暂停或恢复修改既有采集 job；保存开通配置不自动启动外部定时执行器。
3. 查看进度、积压、最近成功／失败、心跳、批次和补采状态。重试保留原任务，补采必须指定有限时间范围。实际执行仍使用 [现有采集 CLI](collector.md)。
4. 邀请码和采集凭证仅首次显示，可主动复制后立即隐藏；不会保存在浏览器 storage、审计或命令回执。丢失响应后同号重试显示“已签发”，需要另行签发，不能取回明文。
5. 记录与待补栏通过统一读模型看到新旧历史。按理由查看事实、来源或修订；更正、撤销、恢复、重复／时间重叠确认均调用现有 MCP。事实不是原生 JSON 编辑表。刷新发现新版本时保留原编辑版本，重新核对并明确重选才清空旧输入。
6. 图片先私有上传，再提交完整关联列表；待补照片可在关联后确认已提供，或明确标记不知道。读取图片需再次提交理由，切换宝宝／退出当前页面清理预览。
7. 不确定是否保存时沿用同一请求号与内容重试；`pending_projection` 不是已完成。查询原录入请求使用新的运营请求号，目标原请求号放在工具参数中，避免更换操作内容造成重放。页面禁止在未确认请求上继续盲目提交。
8. 历史核对接收本地导出的 before/after JSON，验证宝宝范围并报告记录、照片、日期、统计差异；不会执行迁移，也不据此声称真实客户数据已迁移。格式见 [历史核对](history-audit.md)。

## 服务接口

所有接口使用运营 Cookie，无缓存。业务变更 JSON 最多 1 MiB，上传最多 10 MiB。普通账户列表、照护者会话和完整私人聊天不向运营暴露。

| 方法与路径 | 契约 |
| --- | --- |
| GET `/api/ops/context` | fresh 账号、明确范围的宝宝、会员是否已配置；管理员另得最近 100 条账号审计 |
| GET `/api/ops/overview?babyId=…` | 授权、绑定、采集、待补、事件安全摘要、最近 100 条宝宝审计 |
| POST `/api/ops/action` | `{babyId,reason,requestId,command}`；返回 `{receipt}`；同号异参 409；凭证仅首次响应 |
| POST `/api/ops/read` | `{babyId,reason,kind,id?}`；kind 为 event/revisions/source/attachment；history 使用 before/after |
| POST `/api/ops/attachment?babyId=…&requestId=…` | 原图 bytes、图片 Content-Type、URI 编码 `X-Bubu-Reason`；返回私有附件 ID 与基本元数据 |

`command.type` 为 invite、grant、baby、binding、collector、credential、record 或 membership。服务固定宝宝和请求号，拒绝工具参数覆盖宝宝。照护修改仅允许 `contracts.ts` 中明确列出的 MCP 工具。业务错误保留稳定代码，意外错误不回传内部堆栈或库内容。

`MembershipOperations` 通过 `createRuntime({ membership })` 注入 `schema`、`read(principal,babyId)`、`execute(principal,babyId,requestId,input)`。运营层负责 fresh 身份、范围、请求回执及审计；会员模块负责输入校验、政策与持久化。未注入时显示未配置，写入返回 `MEMBERSHIP_NOT_CONFIGURED`；不设置收费、体验截止或到期限流。

## 验证与边界

`test` 覆盖真实临时 SQLite、MCP 回环、角色／范围撤销、一次性凭证、旧 Activity 读取与更正及照片待补。`test:production` 从空库及身份、录入、聊天三版升级，逐行核对原数据并关闭重开。`test:ops-server` 启动隔离合成后台，打印私有 fixture 文件路径；`test:ops-http <路径>` 使用该文件验证实际原生登录、只读 REST、CSRF、秘密字段和业务动作。fixture 文件含测试凭证，不提交或公开。

本模块仅验证合成数据；未接入真实客户库、真实微信、真实群或生产部署。没有启用采集定时器、支付或到期停服。旧公开照片、旧站跨库写入窗口、外部 provider 和生产代理配置仍需各自验收。SQLite 只支持此方案的单进程实例；服务、初始化及离线维护 CLI 的目录锁防止同时写入，不能用它代替多主机数据库锁。
