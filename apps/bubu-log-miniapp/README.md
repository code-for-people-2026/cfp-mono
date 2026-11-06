# 卜卜日记小程序

卜卜日记的数据可视化客户端，新增代码集中在 `cfp-mono/apps/bubu-log-miniapp`。使用本仓库已有的 Taro 4.2 / React 18 技术栈，读取现有 `sunmer-home/apps/bubu-log` 后端。本阶段不搬数据库、不复制 Payload 集合或修改业务写入逻辑。

对应 [数据可视化模块](https://github.com/code-for-people-2026/cfp-mono/issues/394)，完整产品路线见 [六大模块落地规划](https://github.com/code-for-people-2026/cfp-mono/issues/392)。

## 已迁移范围

- 菜单导航：自定义顶栏、左上角抽屉；历史数据、趋势、宝宝切换、昵称与姓名设置、刷新及退出收进菜单。首页先展示日历，摘要卡与昨晚衔接在下方。
- 日历首页：24 小时时间轴、全部 15 类记录、八张摘要卡、多选筛选、昨晚衔接、喂奶及睡眠间隔。
- 周历：周一到周日、原有分类筛选、跨日记录；事件块只显示奶量、时长或次数等测量值（`120ml`、`7h`、`10m`、`3次`），没有测量值时才回退到短类型名，不再显示开始时刻。
- 日／周时间轴手势：单指左滑前一段、右滑后一段；顶部向下／底部向上越过阈值后松手翻页；双指上下捏合在 0.5–3× 连续缩放并锚定时间。普通单指纵向滚动、前后箭头和记录点按保持可用。
- 月历：自然日历月的睡眠与瓶喂奶量热力图，含四／五／六周完整对齐；前后月补格不参与统计与选择。
- 中央标题：上海日历的相对名称（今日／昨日／前日、本周／上周、本月／上月）；当前周只显示周一开始的开放式范围（如 `本周（10/19–）`），上周及更早周显示完整周一至周日范围；月历前后切换按自然月步进并限制在当前月。
- 趋势：7 / 14 / 30 天睡眠、瓶喂与吸奶、尿布统计。
- 记录列表：按活动、创建、更新时间排序；只读详情；已有照片预览。详情的「更多信息」默认折叠，展开后才读取现有审计来源。
- 切换有权访问的宝宝与日期，加载、失败重试、空状态、读取上限提示。

昵称／姓名设置复用原 `PATCH /api/app/user-babies/:id` 的归属、重名和长度校验，保存成功才更新界面；只发送 `name` / `fullName`，不改其他资料。没有加入活动创建、编辑、删除或重新计算统计的请求。MCP、内置聊天、微信群采集、微信身份登录和支付按各自模块后续接入。

## 记录来源与已知限制

详情底部「更多信息」只在首次展开时调用原 `GET /api/app/audits?babyId=…&action=CREATE&resourceType=ACTIVITY&success=true&limit=200&offset=…`，请求同样携带 `x-baby-id`，并只使用成功 CREATE 的现有字段：`userId`（显示为「记录账号」，不是人名）、`inputMethod`（TEXT＝文本录入、VOICE＝语音录入）、`createdAt`（添加时间）和 `inputText`（原话）。`resourceId` 或 `activityId` 任一匹配即可采用；两者同时存在且冲突时不展示。选中的审计还必须带有与请求完全一致的 `babyId`，缺失、`null` 或属于其他宝宝都拒绝并标记读取不完整。

旧接口不支持按活动过滤，适配器按 200 条一页读取，最多到服务端 `offset=5000`；达到上限、页面没有前进或剩余页不完整时，详情用普通文案提示来源暂未读全并允许重试，不假装没有来源。关闭详情、折叠加载中区块、切换宝宝、退出登录或会话失效都会作废迟到结果并停止继续翻页；没有持久化的来源缓存。审计接口普通 404/500 不影响照护详情本身，并可在「更多信息」内重试，界面不展示服务端原始错误正文。`Activity.createdAt` 仍是真实的添加时间兜底。

限制：旧审计没有人类展示名，也没有比 TEXT/VOICE 更具体的入口信息，无法判断文本或语音来自小程序还是微信群；活动备注（notes）是独立用户字段，永远不作为原话展示。来源来自对原审计接口的只读读取，不是 MCP 推断或补写。缺失原话显示「未记录原话」，缺失账号/方式显示「未记录」或「暂无法读取」。

## 开发与构建

```sh
pnpm install

# 微信端：地址是现有宝宝日记服务，不是 Payload 管理接口。
BUBU_API_ORIGIN=https://your-existing-diary.example pnpm --filter @cfp/bubu-log-miniapp build:weapp

# H5 开发：请求仍发往浏览器同源 /api，由开发代理转到旧服务。
BUBU_DEV_PROXY=http://127.0.0.1:3000 pnpm --filter @cfp/bubu-log-miniapp dev:h5

pnpm --filter @cfp/bubu-log-miniapp lint
pnpm --filter @cfp/bubu-log-miniapp typecheck
pnpm --filter @cfp/bubu-log-miniapp test:coverage
pnpm --filter @cfp/bubu-log-miniapp build
pnpm --filter @cfp/bubu-log-miniapp exec playwright install chromium
pnpm --filter @cfp/bubu-log-miniapp test:e2e
pnpm --filter @cfp/bubu-log-miniapp test:wxss
```

微信产物位于 `dist/weapp`，H5 位于 `dist/h5`。环境变量在启动构建的 shell 中设置；`.env.example` 仅解释配置，不会自动加载。未设置服务地址时原生端显示未配置状态，不使用演示数据冒充家庭记录。本地导入时在微信开发者工具选择「测试号」替换 `project.config.json` 中的 AppID 占位值；发布前使用本项目自己的 AppID，并在微信后台配置旧 API 和已有图片域名。不要借用 Hello Agent 的 AppID。

H5 在生产环境须与旧服务同源（或由部署层同源反向代理 `/api/auth` 与 `/api/app`）。H5 明确忽略 `BUBU_API_ORIGIN`，不假设旧服务支持跨域 Cookie 或 CORS。开发代理连接 HTTPS 服务时，建议本地也使用 HTTPS 以保持 Secure Cookie 的条件。

## 兼容边界

`src/api` 是旧 API 的适配层。原生端通过现有 NextAuth 的 CSRF → Credentials → Cookie 会话登录，使用用户原账号和密码；密码不会持久化。会话 Cookie 按服务 origin 隔离，处理分片、过期、注销与并发失效。H5 由浏览器管理同源 Cookie。旧后端继续验证宝宝归属，每个业务请求同时携带 `babyId` 与 `x-baby-id`。客户端不包含 Payload 管理凭据，也不读取数据库。

此版本不提供 `wx.login` 身份交换：那是登录认证模块的后续范围。必须在目标服务、自己的 AppID 和微信真机环境验证登录、会话恢复、宝宝切换和图片域名后才可发布。自动测试覆盖的是旧协议和合成数据，不等于已完成生产联调。

首页与记录列表沿用各自原有的 Activity 汇总；趋势与热力图直接读取后端保存的 DailyStat。尿量折算、分钟截断与服务端舍入的差异均保留，详见 [模型说明](src/model/README.md)。页面“刷新”仅重新读取，不触发旧 `POST /daily-stats` 计算。没有 DailyStat 的日期显示“暂无统计”，并不意味着没有活动。旧活动接口无分页总数，达到 1,000 条时显式提示结果可能不完整。

旧照片来自 Activity.poopPhotoUrl，沿用原公开图片 URL，不改变图片存储与访问机制。迁移只增加详情预览，未声称旧媒体已经变成私有图片。

## 文件分工与验证

- `src/model`：时间、布局、展示字段，以及独立保留的旧摘要口径。
- `src/api`：读取、审计来源、昵称／姓名更新契约与会话适配，可注入传输层做协议测试。
- `src/components`：只接收记录和统计的 Taro 可视化组件；日／周共用时间轴手势适配器。
- `src/gestures`：不依赖 Taro 的手势状态／阈值／边界／缩放数学，以及 React/ScrollView 适配器；H5 与原生分别处理事件来源。
- `src/navigation`：顶部安全区、菜单、跨页面资料更新通知和上海午夜相对标题 tick。
- `src/pages/settings`：宝宝昵称／姓名设置，复用旧接口，不改后端。
- `src/pages/index`：登录、宝宝/日期上下文、共享缩放、加载与选择状态。切换后屏蔽旧上下文结果，关闭详情不发写入请求。
- `tests`：跨日、时区、原统计差异、Cookie、API 协议和纯手势状态测试；`tests/e2e` 用合成数据和本地 Chromium CDP 真实单指／双指 touch 验证手机尺寸 H5 交互，不访问真实家庭数据。H5 的 CDP 测试不能替代微信真机上的捏合、滚动和取消路径验证。

迁移参考版本：sunmer-home `ac86de31b08bdf413e021e60240da2dcd8e63911`。原项目只读保留。

## 核心 PR 1：可视化

本层仅迁移已有数据的日历、周/月视图、趋势、历史和昵称设置，保留原 Payload 表与旧账号接口。后续 MCP 层负责统一录入；正式微信登录、家庭引导、运营和会员不作为此层依赖。验收使用集成候选版本按模块分别录制，线上已有数据和保护不因分层回退。
