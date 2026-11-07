# 卜卜日记小程序

卜卜日记的日历与对话客户端，新增代码集中在 `cfp-mono/apps/bubu-log-miniapp`。使用本仓库已有的 Taro 4.2 / React 18 技术栈，读取现有 `sunmer-home/apps/bubu-log` 后端。既有照护数据不迁移；可通过独立身份服务连接原后端。

对应 [数据可视化模块](https://github.com/code-for-people-2026/cfp-mono/issues/394) 与 [程序内对话模块](https://github.com/code-for-people-2026/cfp-mono/issues/395)，完整产品路线见 [六大模块落地规划](https://github.com/code-for-people-2026/cfp-mono/issues/392)。

## 候选边界与验收顺序

- **#438 独立候选**：验证日历手势、记录来源、月历四环和本机参考设置这条可视化演进线，先在其原始基线和范围内完成评审与自动化检查。
- **集成体验候选**：在 #438 之上同时保留旧账号、独立身份、微信/sidecar、监护人、家庭邀请、会员与隐私能力；合并后必须再做全量检查和目标环境验收。
- 验收顺序为 #438 独立候选先通过，再验收集成体验候选。集成候选的结果不能反向替代 #438 的独立验收；本文不把文档描述当作部署或真机验收结论。

## 已实现范围

- 菜单导航：自定义顶栏、左上角抽屉；历史数据、趋势、宝宝切换、昵称与姓名设置、刷新及退出收进菜单。首页先展示日历，摘要卡与昨晚衔接在下方。
- 日历首页：24 小时时间轴、全部 15 类记录、八张摘要卡、多选筛选、昨晚衔接、喂奶及睡眠间隔。
- 周历：周一到周日、原有分类筛选、跨日记录；事件块只显示奶量、时长或次数等测量值（`120ml`、`7h`、`10m`、`3次`），没有测量值时才回退到短类型名，不再显示开始时刻。
- 日／周时间轴手势：单指左滑前一段、右滑后一段；顶部向下／底部向上越过阈值后松手翻页；双指上下捏合在 0.5–3× 连续缩放并锚定时间。普通单指纵向滚动、前后箭头和记录点按保持可用。
- 月历：自然日历月的睡眠与瓶喂奶量热力图，含四／五／六周完整对齐；前后月补格不参与统计与选择。
- 月历四环：自然月内展示吃／睡／玩／便四类家庭参考；亲喂、奶量和睡眠参考可在设置页调整，不提供称重 UI。
- 中央标题：上海日历的相对名称（今日／昨日／前日、本周／上周、本月／上月）；当前周只显示周一开始的开放式范围（如 `本周（10/19–）`），上周及更早周显示完整周一至周日范围；月历前后切换按自然月步进并限制在当前月。
- 趋势：7 / 14 / 30 天睡眠、瓶喂与吸奶、尿布统计。
- 记录列表：按活动、创建、更新时间排序；只读详情；已有照片预览。Legacy 详情的「更多信息」默认折叠，展开后才读取现有审计来源；Sidecar 详情显示来源类型、来源时间、版本及待补状态，并预览记录关联的私有附件，均不展示来源账号、群或发送者标识。
- 切换有权访问的宝宝与日期，加载、失败重试、空状态、读取上限提示。
- 右下角聊天入口、待补数量、可收起底部对话、文字/照片/校对后语音输入、持久草稿和发送恢复。
- 独立身份模式的菜单展示宝宝共享服务状态：每次打开从 `/api/app/membership?babyId=...` 读取服务端决定，显示「限时免费」或暂停／到期说明；仅在已配置时展示起止时间。读取失败清除旧状态并提供重试，不推算截止日期或免费授权，不提供购买／账单入口。

昵称／姓名设置复用原 `PATCH /api/app/user-babies/:id` 的归属、重名和长度校验，保存成功才更新界面；只发送 `name` / `fullName`，不改其他资料。客户端通过服务端对话执行录入、更正、删除与撤销，所有事实读写仍由统一 MCP 规则控制；不直接写旧 Activity 或触发旧日报重算。独立服务已提供 [Agent/MCP 录入与受控群采集](../bubu-log-service/README.md)，本客户端读取它的统一统计投影；已接入内置聊天入口；首期限时免费，支付未启用。微信身份认证见下文。

本机照护参考设置仅按当前后端地址与宝宝 ID 保存：亲喂估算速度、每日奶量和睡眠参考都可以恢复初始值；输入无效、存储损坏、保存或恢复失败时显示明确反馈，不会把估算值当作医疗诊断或同步给家人。

## 记录来源与已知限制

详情底部「更多信息」只在首次展开时调用原 `GET /api/app/audits?babyId=…&action=CREATE&resourceType=ACTIVITY&success=true&limit=200&offset=…`，请求同样携带 `x-baby-id`，并只使用成功 CREATE 的现有字段：`userId`（显示为「记录账号」，不是人名）、`inputMethod`（TEXT＝文本录入、VOICE＝语音录入）、`createdAt`（添加时间）和 `inputText`（原话）。`resourceId` 或 `activityId` 任一匹配即可采用；两者同时存在且冲突时不展示。选中的审计还必须带有与请求完全一致的 `babyId`，缺失、`null` 或属于其他宝宝都拒绝并标记读取不完整。

旧接口不支持按活动过滤，适配器按 200 条一页读取，最多到服务端 `offset=5000`；达到上限、页面没有前进或剩余页不完整时，详情用普通文案提示来源暂未读全并允许重试，不假装没有来源。关闭详情、折叠加载中区块、切换宝宝、退出登录或会话失效都会作废迟到结果并停止继续翻页；没有持久化的来源缓存。审计接口普通 404/500 不影响照护详情本身，并可在「更多信息」内重试，界面不展示服务端原始错误正文。`Activity.createdAt` 仍是真实的添加时间兜底。

限制：旧审计没有人类展示名，也没有比 TEXT/VOICE 更具体的入口信息，无法判断文本或语音来自小程序还是微信群；活动备注（notes）是独立用户字段，永远不作为原话展示。来源来自对原审计接口的只读读取，不是 MCP 推断或补写。缺失原话显示「未记录原话」，缺失账号/方式显示「未记录」或「暂无法读取」。

## 开发与构建

```sh
pnpm install

# 微信端默认接入卜卜日记独立身份与对话服务。
BUBU_API_ORIGIN=https://your-bubu-service.example pnpm --filter @cfp/bubu-log-miniapp build:weapp

# H5 开发：请求仍发往浏览器同源 /api，由开发代理转到独立服务。
BUBU_DEV_PROXY=http://127.0.0.1:3320 pnpm --filter @cfp/bubu-log-miniapp dev:h5

pnpm --filter @cfp/bubu-log-miniapp lint
pnpm --filter @cfp/bubu-log-miniapp typecheck
pnpm --filter @cfp/bubu-log-miniapp test:coverage
pnpm --filter @cfp/bubu-log-miniapp build
pnpm --filter @cfp/bubu-log-miniapp exec playwright install chromium
pnpm --filter @cfp/bubu-log-miniapp test:e2e
pnpm --filter @cfp/bubu-log-miniapp test:wxss
```

微信产物位于 `dist/weapp`，H5 位于 `dist/h5`。环境变量在启动构建的 shell 中设置；`.env.example` 仅解释配置，不会自动加载。未设置服务地址时原生端显示未配置状态，不使用演示数据冒充家庭记录。本地导入时在微信开发者工具选择「测试号」替换 `project.config.json` 中的 AppID 占位值；发布前使用本项目自己的 AppID，并在微信后台配置所选服务的 request 域名；独立身份模式同时配置该服务的 downloadFile 域名，旧模式配置已有图片域名。不要借用 Hello Agent 的 AppID。

H5 在生产环境须与所选服务同源（或由部署层同源反向代理 `/api/auth`、`/api/identity` 与 `/api/app`）。H5 明确忽略 `BUBU_API_ORIGIN`，不假设旧服务支持跨域 Cookie 或 CORS。开发代理连接 HTTPS 服务时，建议本地也使用 HTTPS 以保持 Secure Cookie 的条件。

## 兼容边界

`src/api` 是旧 API 的适配层。原生端通过现有 NextAuth 的 CSRF → Credentials → Cookie 会话登录，使用用户原账号和密码；密码不会持久化。会话 Cookie 按服务 origin 隔离，处理分片、过期、注销与并发失效。H5 由浏览器管理同源 Cookie。旧后端继续验证宝宝归属，每个业务请求同时携带 `babyId` 与 `x-baby-id`。客户端不包含 Payload 管理凭据，也不读取数据库。

### 独立身份服务模式（Issue #396）

默认 `BUBU_AUTH_MODE=sidecar`。显式设置 `BUBU_AUTH_MODE=legacy` 可保留上述旧登录方式（对话不开放）。独立身份模式中，`BUBU_API_ORIGIN` / H5 代理指向 [卜卜日记身份服务](../bubu-log-service/README.md)：

```sh
BUBU_AUTH_MODE=sidecar BUBU_API_ORIGIN=https://your-bubu-service.example pnpm --filter @cfp/bubu-log-miniapp build:weapp
BUBU_AUTH_MODE=sidecar BUBU_DEV_PROXY=http://127.0.0.1:3320 pnpm --filter @cfp/bubu-log-miniapp dev:h5

# 使用合成账号/数据验证独立身份、统一统计与对话界面（默认 sidecar）
BUBU_AUTH_MODE=sidecar pnpm --filter @cfp/bubu-log-miniapp build:h5
BUBU_AUTH_MODE=sidecar pnpm --filter @cfp/bubu-log-miniapp test:e2e
# 旧模式界面回归使用显式 legacy 构建和原有用例
BUBU_AUTH_MODE=legacy pnpm --filter @cfp/bubu-log-miniapp build:h5
BUBU_AUTH_MODE=legacy pnpm --filter @cfp/bubu-log-miniapp test:e2e
```

端到端测试读取现有 `dist/h5`，不会自动切换构建模式。构建与运行测试必须使用相同的 `BUBU_AUTH_MODE`；都省略时运行默认 sidecar 的身份、记录与对话用例，只有显式 `legacy` 才运行旧日历用例。

- 微信端调用真实 `Taro.login()` 获取一次性 code，向 `POST /api/identity/wechat` 交换身份会话。AppSecret 只配置在服务端。Native Bearer token 只在本地 `bubu-identity:<origin>` 中保存，包含到期时间；不保存微信 code、密码或账号文本。
- H5 使用旧用户名/密码向 `POST /api/identity/legacy-login` 交换服务端 HttpOnly Cookie；不存储或使用响应中的 token。请求携带 `X-Bubu-Client: browser`，服务端校验同源 Origin；服务端 `BUBU_PUBLIC_ORIGIN` 应设置为浏览器实际访问的 H5 地址（Taro 开发服务器默认 `http://localhost:10086`），开发代理目标仍为 `http://127.0.0.1:3320`。原生请求标记为 `native`。
- `GET /api/app/auth/context` 恢复服务端选中的宝宝。已登录且未绑定旧账号的微信身份，可只填昵称创建宝宝、用旧凭证绑定原账号、或输入照护邀请码。已绑定旧账号但没有宝宝时，显示原系统/运营关联提示与邀请码入口，不重复创建新家庭。被邀请者即使 `legacyLinked=false` 也可访问有权限的宝宝；不强制旧账号绑定。设置中也有绑定/邀请码入口。
- `bindLegacy` 只发送用户主动输入的旧凭证；服务端验证成功才返回新 token。错误旧凭证不会清除微信身份；`401 UNAUTHORIZED` 才清除身份会话与私有视图。`403 BABY_FORBIDDEN` 清除宝宝视图并重新读取可访问上下文。上游服务故障显示错误，不伪装成空数据。
- 登录、绑定、创建、加入与退出使用会话代际隔离迟到响应。退出等待正在处理的认证响应后再清除 H5 Cookie，避免迟到的登录 Cookie 将页面恢复。换宝宝、退出和失效时关闭旧详情。
- `POST /api/identity/family {name}` 与 `POST /api/identity/invitations/accept {code}` 返回 `{context}`；`POST /api/identity/bind-legacy {username,password}` 返回 `{token,expiresAt,context}`；退出调用 `POST /api/identity/logout`。上下文增加 `identityId` 和 `legacyLinked`，旧可视化读取路径保持不变。

必须在目标服务、自有 AppID、微信开发者工具和真机验证登录、恢复、退出、照护撤权与照片读取后才可发布。自动测试使用注入的微信 provider 和合成数据，不表示真实微信联调已通过。

`legacy` 模式：首页与记录列表沿用各自原有的 Activity 汇总；趋势与热力图直接读取后端保存的 DailyStat。尿量折算、分钟截断与服务端舍入的差异均保留。没有 DailyStat 的日期显示“暂无统计”，并不意味着没有活动。旧活动接口无分页总数，达到 1,000 条时显式提示结果可能不完整。

`sidecar` 模式：首页与记录列表读取 `GET /api/app/records/snapshot?babyId&date` 的 `summary`，趋势和热力图读取同一服务实时计算的 DailyStat 形状；客户端不重算卡片口径。尿布卡显示真实换尿布次数，有尿与有便分别列出；明确的 0 保留，未知或进行中的数值不画成零。覆盖提示显示待补充、明确未知、进行中及疑似重复。明确进行中的跨夜睡眠延续到当前日期，但暂估经过时间不计入完成分钟；旧站补写结束时间后按当前已保存事实显示完成量。疑似新重复暂不双计，尚未确认的修改保留上次已保存事实。详见 [模型说明](src/model/README.md)。两种模式的“刷新”都只重新读取，不请求旧 `POST /daily-stats`。

Sidecar 详情按活动 ID 读取独立的记录快照，不附加“今天”条件，因此历史记录的来源与附件仍可查看。关联图片使用 `/api/app/attachments/:id?babyId=…` 受保护接口，与旧照片复用相同的鉴权下载、预览和临时文件释放流程。首页单独读取 `/api/app/records/sync`，显示最近成功、消息处理时间、处理中任务、待补媒体与失败提醒；同步失败或状态读取失败不会清空已保存记录。状态随打开宝宝或手动刷新重新读取，客户端不启用自动采集或定时轮询。

旧模式照片沿用 Activity.poopPhotoUrl 的原公开 URL。独立身份模式由服务端返回 `/api/app/media/activities/:id?babyId=...` 受保护路径；H5 同源 Cookie 读取，微信端打开详情时带 Bearer 下载为临时文件。客户端仅接受约定路径与当前宝宝，不把凭证发给记录中的任意 URL。没有持久媒体缓存；关详情、换宝宝、登录状态变化会释放本地临时文件，迟到下载不会展示。既有公开 Blob URL 本身的可访问性仍由旧存储决定。

## 文件分工与验证

- `src/model`：时间、布局、展示字段、独立保留的旧摘要口径、sidecar 统计与完整性提示，以及月历参考展示规则。
- `src/api`：读取、审计来源、昵称／姓名更新契约、独立身份与旧会话适配，可注入传输层、微信 provider 和照片下载器做协议测试。
- `src/components`：只接收记录和统计的 Taro 可视化组件；`IdentitySetup` 单独承载账号绑定、首次创建和邀请码加入；日／周共用时间轴手势适配器。
- `src/gestures`：不依赖 Taro 的手势状态／阈值／边界／缩放数学，以及 React/ScrollView 适配器；H5 与原生分别处理事件来源。
- `src/navigation`：顶部安全区、菜单、跨页面资料更新通知和上海午夜相对标题 tick。
- `src/pages/settings`：宝宝昵称／姓名设置，复用旧接口，不改后端；照护参考按后端地址与宝宝 ID 保存在本机，不同步给家人。
- `src/pages/index`：登录、宝宝/日期上下文、共享缩放、加载与选择状态。切换后屏蔽旧上下文结果，关闭详情不发写入请求。
- `tests`：跨日、时区、原统计差异、Cookie、API 协议和纯手势状态测试；`tests/e2e` 用合成数据和本地 Chromium CDP 真实单指／双指 touch 验证手机尺寸 H5 交互，不访问真实家庭数据。H5 的 CDP 测试不能替代微信真机上的捏合、滚动和取消路径验证。

迁移参考版本：sunmer-home `ac86de31b08bdf413e021e60240da2dcd8e63911`。原项目只读保留。


## 程序内对话

日历右下角打开宝宝持续对话，数字显示服务端仍开放的字段/媒体待补数量。收起保留草稿和发送状态。记录详情可进入对话更正、删除或撤销；当前浏览日期和选中事件仅为上下文，“现在/刚才”由服务端按消息时间理解。

- `GET /api/app/chat?babyId=…` 恢复历史；`POST /api/app/chat` 保存稳定请求号与文字、附件、上下文、可选问题版本；`GET /api/app/chat/request?babyId&requestId` 查询原请求。发送前持久化原请求；响应中断后先查询，再用原号与原参数恢复。`processing` 定期查询，`needs_recovery` 保留并显示恢复按钮；服务器明确不可重试的失败才允许人工修改后建立新请求。
- 草稿和未确认请求按服务地址、身份 ID、宝宝 ID 隔离保存，包含文字、附件 ID 和版本，不保存登录令牌、模型密钥、照片字节或整个历史。照片预览每次经过私有路径授权。退出、登录失效、宝宝撤权清理相关草稿和临时图片；迟到响应不能重新显示旧宝宝内容。
- 字段问题来自 `/records/pending`，回答附原 `questionVersion/eventVersion`；媒体待补独立传 `context.mediaPendingId`，不伪装成字段问题。用户可答“不知道”，由统一规则记录未知。没有复杂 A2UI 表单、阿 J 人设或心理业务。
- 图片经 `POST /api/app/attachments?babyId=…` 二进制上传（稳定 `X-Bubu-Request-Id`）；保留原字节，支持 JPG/PNG/WebP，单张最多 10 MiB，每次聊天最多三张。服务端确认的附件只用受保护地址访问；图片含义由服务端真实图文模型与 MCP 处理。
- `已记录` 等状态只来自结构化回执；未确认投影和冲突分别显示待恢复/待核对。`refreshRequired` 后重新读取当前日历或趋势的统一事实视图，不在前端累计记录或奶量。

语音输入仅是文字草稿来源。微信需为本 AppID 添加同声传译插件 `wx069ba97219f66d99` 并配置已授权的 `BUBU_WECHAT_SI_VERSION`（不假设其他产品已有的授权可复用）；未配置会说明原因并保留键盘。按住后请求 `scope.record`，最长 60 秒，松开后识别等待最多 15 秒。H5 使用浏览器 SpeechRecognition，要求 HTTPS/localhost 和浏览器支持；第三方识别可能联网处理声音。转写结果先展示给用户校对，绝不自动发送；取消、切键盘、收起、卸载或后台忽略迟到结果。没有向卜卜日记后端上传录音。

纯状态/API 测试覆盖重启草稿恢复、同号查询后重试、已保存响应丢失、撤权后的迟到回包、图片二进制与私有路径、字段/媒体问题分离；语音测试覆盖权限、超时、取消及单例串音隔离。H5 自动化使用隔离合成账号/数据；微信构建与 WXSS 编译不替代真机麦克风、插件隐私授权或真实模型验收。
