# 好人阿 J · a jOKer · Taro 小程序

真正的 Taro 4.2 / React 18 客户端，同一份代码编译微信小程序与 H5。沿用仓库 `community-cooking` 的 Taro 工具链；不修改或复用它的业务代码、数据库或 AppID。

## 本机预览

在仓库根目录运行：

```sh
pnpm install
pnpm --filter @cfp/hello-agent-miniapp build
pnpm --filter @cfp/hello-agent build
pnpm --filter @cfp/hello-agent start
```

打开 <http://127.0.0.1:3310/>，自动进入 Taro H5；CMS 在 `/admin`。每次修改客户端后重建 H5，再运行服务端 `build` / `dev` / `start` 中任一命令同步静态产物。H5 与后端同源，不需要放开跨域，也不把访客 Cookie 转成可被页面脚本读取的令牌。

H5 直接呈现最大 420px 宽、占满可视高度的聊天界面，小屏占满宽度；没有网页介绍外壳、假手机边框、假状态栏或假微信胶囊。微信小程序使用原生导航栏，两种输出并存，不是在小程序里嵌入这个 H5。

`pnpm turbo run build --filter=@cfp/hello-agent` 会按依赖先编译小程序，再构建后端；服务端自行同步 H5，避免构建缓存命中时遗漏网页产物。

## 微信开发者工具

2026-09-30 用户已覆盖安装 Intel / x64 版，架构核对与 CLI 检查通过。已完成 Codex 连接授权，并在开发者工具模拟器中运行阿J、发送文字、收到真实 DeepSeek 回复和 CMS 保存提示。没有替用户安装、卸载软件或发布小程序。

1. `pnpm --filter @cfp/hello-agent-miniapp build:weapp`。
2. 微信开发者工具导入本目录，读取 `project.config.json`，产物在 `dist/weapp/`。
3. 2026-10-01 按用户提供的信息切换到「好人阿 J」正式 AppID `wx692320cdac058519`。这不是 AppSecret；上传需要当前微信具备该小程序开发者权限，不再使用此前测试号。
4. 编译时可设置 `HELLO_API_ORIGIN=https://你的后端域名`。它是公开的后端地址，不是密钥。微信正式环境需合法的 HTTPS 请求 / 下载域名。默认 `127.0.0.1:3310` 只用于本机开发，手机上的 localhost 不指向电脑。

设备凭证按后端地址隔离：切到 ECS 预览不会复用本机数据库的设备令牌；切回默认本机地址仍保留首版本地身份。预览服务器有出口 IP 白名单，手机网络不在白名单时会返回 403，需要先明确授权该网络，不能通过关闭微信域名校验解决这个问题。

重新编译为本次私有预览地址：

```sh
HELLO_API_ORIGIN=https://aj-preview.codeforpeople.cn pnpm --filter @cfp/hello-agent-miniapp build:weapp
```

不传该环境变量会编译回默认本机地址。AppID 为公开项目标识；模型密钥、AppSecret 和 CMS 密码不得写入前端。

此处不自动把本地服务绑定到公网。正式 AppID 的项目已启用 `urlCheck: true`，避免把模拟器跳过校验误认为真机可用。需要在同一个 AppID 的微信后台将 `https://aj-preview.codeforpeople.cn` 加入 request 和 downloadFile 合法域名；本版本图片上传通过 request 发送，图片读取通过 downloadFile。

上传开发版本、在微信后台设为体验版、提交审核、正式发布是不同步骤。前两步用于授权测试；本次不提交审核或正式发布。域名未配置时，不能以关闭域名校验或仅有编译成功作为体验版通过验收的依据。

日常调试可运行 `pnpm --filter @cfp/hello-agent-miniapp dev:weapp` 持续编译前端；服务端单独运行 `pnpm --filter @cfp/hello-agent dev`。若 3310 已有本项目服务，不要再启动第二份。模拟器位于这台电脑时可访问 `http://127.0.0.1:3310`，手机不能。

模拟器、扫码预览与体验版的区别，以及 CMS 的逐项验收方式，见[验收与微信测试指南](../hello-agent/docs/acceptance.md)。

## 交互与身份

- 消息气泡展示原始输入、真实生成的吉祥话、保存状态与联想依据。
- 首版自动续接最近记录，没有会话列表、新建对话或编号。设置面板保留连接方式与后台入口；旧数据没有删除。
- 底部输入文字或图片；助手选择面板保留平台、BYOK、自带 Agent 三条路径。
- 当前 BYOK 仅接入 DeepSeek，不把“选择助手”伪装成已经完成的多供应商选择。
- 微信端使用专用匿名设备令牌，浏览器使用 HttpOnly Cookie。微信端可保存自己的设备令牌，但不保存模型 API Key；设备令牌不能直接作为 MCP 令牌使用。
- **尚未接入 `wx.login` 或跨设备账号绑定。** 两端访客身份独立；只有同一身份授权的 MCP 客户端共享其会话。清除本机缓存或凭证过期后不能自动恢复身份。
- 用户模型密钥只在输入状态及当次请求中存在；发送或切换模式时清空。外部客户端通过专门授权的 MCP 令牌连接，模型调用仍不经过平台 ADK。

## 验证

```sh
pnpm --filter @cfp/hello-agent-miniapp typecheck
pnpm --filter @cfp/hello-agent-miniapp lint
pnpm --filter @cfp/hello-agent-miniapp test
pnpm --filter @cfp/hello-agent-miniapp build
pnpm --filter @cfp/hello-agent test:integration
pnpm --filter @cfp/hello-agent test:e2e
```

两端编译通过不等于微信真机验收。H5 和开发者工具模拟器已验证真实文字生成；微信端认证 / 图片接口另有隔离 HTTP 测试。真机键盘行为、域名配置与相册权限仍需进一步检查。
