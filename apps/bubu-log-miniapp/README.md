# 宝宝日记小程序

宝宝日记的数据可视化客户端，新增代码集中在 `cfp-mono/apps/bubu-log-miniapp`。使用本仓库已有的 Taro 4.2 / React 18 技术栈，读取现有 `sunmer-home/apps/bubu-log` 后端。本阶段不搬数据库、不复制 Payload 集合或修改业务写入逻辑。

对应 [数据可视化模块](https://github.com/code-for-people-2026/cfp-mono/issues/394)，完整产品路线见 [六大模块落地规划](https://github.com/code-for-people-2026/cfp-mono/issues/392)。

## 已迁移范围

- 日历首页：24 小时时间轴、全部 15 类记录、八张摘要卡、多选筛选、昨晚衔接、喂奶及睡眠间隔。
- 周历：周一到周日、原有分类筛选、跨日记录。
- 月历：最近四周的睡眠与瓶喂奶量热力图。
- 趋势：7 / 14 / 30 天睡眠、瓶喂与吸奶、尿布统计。
- 记录列表：按活动、创建、更新时间排序；只读详情；已有照片预览。
- 切换有权访问的宝宝与日期，加载、失败重试、空状态、读取上限提示。

没有加入活动创建、编辑、删除或重新计算统计的请求。MCP、内置聊天、微信群采集、微信身份登录和支付按各自模块后续接入。

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

微信产物位于 `dist/weapp`，H5 位于 `dist/h5`。环境变量在启动构建的 shell 中设置；`.env.example` 仅解释配置，不会自动加载。未设置服务地址时原生端显示未配置状态，不使用演示数据冒充家庭记录。`project.config.json` 的 touristappid 仅用于本地导入；发布前使用本项目自己的 AppID，并在微信后台配置旧 API 和已有图片域名。不要借用 Hello Agent 的 AppID。

H5 在生产环境须与旧服务同源（或由部署层同源反向代理 `/api/auth` 与 `/api/app`）。H5 明确忽略 `BUBU_API_ORIGIN`，不假设旧服务支持跨域 Cookie 或 CORS。开发代理连接 HTTPS 服务时，建议本地也使用 HTTPS 以保持 Secure Cookie 的条件。

## 兼容边界

`src/api` 是旧 API 的适配层。原生端通过现有 NextAuth 的 CSRF → Credentials → Cookie 会话登录，使用用户原账号和密码；密码不会持久化。会话 Cookie 按服务 origin 隔离，处理分片、过期、注销与并发失效。H5 由浏览器管理同源 Cookie。旧后端继续验证宝宝归属，每个业务读取同时携带 `babyId` 与 `x-baby-id`。客户端不包含 Payload 管理凭据，也不读取数据库。

此版本不提供 `wx.login` 身份交换：那是登录认证模块的后续范围。必须在目标服务、自己的 AppID 和微信真机环境验证登录、会话恢复、宝宝切换和图片域名后才可发布。自动测试覆盖的是旧协议和合成数据，不等于已完成生产联调。

首页与记录列表沿用各自原有的 Activity 汇总；趋势与热力图直接读取后端保存的 DailyStat。尿量折算、分钟截断与服务端舍入的差异均保留，详见 [模型说明](src/model/README.md)。页面“刷新”仅重新读取，不触发旧 `POST /daily-stats` 计算。没有 DailyStat 的日期显示“暂无统计”，并不意味着没有活动。旧活动接口无分页总数，达到 1,000 条时显式提示结果可能不完整。

旧照片来自 Activity.poopPhotoUrl，沿用原公开图片 URL，不改变图片存储与访问机制。迁移只增加详情预览，未声称旧媒体已经变成私有图片。

## 文件分工与验证

- `src/model`：时间、布局、展示字段，以及独立保留的旧摘要口径。
- `src/api`：读取契约与会话适配，可注入传输层做协议测试。
- `src/components`：只接收记录和统计的 Taro 可视化组件。
- `src/pages/index`：登录、宝宝/日期上下文、加载与选择状态。切换后屏蔽旧上下文结果，关闭详情不发写入请求。
- `tests`：跨日、时区、原统计差异、Cookie 与 API 协议测试；`tests/e2e` 用合成数据验证手机尺寸 H5 交互，不访问真实家庭数据。

迁移参考版本：sunmer-home `ac86de31b08bdf413e021e60240da2dcd8e63911`。原项目只读保留。
