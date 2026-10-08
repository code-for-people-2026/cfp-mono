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
- 底部默认按住说话，点键盘图标切换文字／图片输入；切换保留草稿。助手选择面板保留平台、BYOK、自带 Agent 三条路径。
- 输入栏采用同排布局：图片、文字／按住说话、输入方式切换、更多／发送。有文字或图片草稿时最右侧显示发送；“＋”展开相册与拍照，左侧图片按钮在有草稿时仍可选图，选图后切到键盘确认。语音转换仍不自动发送，快捷建议不变。
- 图标统一使用 [Lucide Static](https://lucide.dev/guide/static) `1.52.0` 的 7 个按需 SVG，以 Taro Image 呈现；不加载远程图标字体，也不把整套图标打进小程序。语音处理说明保留在工具区与录音状态提示，默认底部只保留一行 AI 声明。
- 当前 BYOK 仅接入 DeepSeek，不把“选择助手”伪装成已经完成的多供应商选择。
- 微信端使用专用匿名设备令牌，浏览器使用 HttpOnly Cookie。微信端可保存自己的设备令牌，但不保存模型 API Key；设备令牌不能直接作为 MCP 令牌使用。
- **尚未接入 `wx.login` 或跨设备账号绑定。** 两端访客身份独立；只有同一身份授权的 MCP 客户端共享其会话。清除本机缓存或凭证过期后不能自动恢复身份。
- 用户模型密钥只在输入状态及当次请求中存在；发送或切换模式时清空。外部客户端通过专门授权的 MCP 令牌连接，模型调用仍不经过平台 ADK。

## 欢迎页与语音输入

首页使用原创[阿 J 形象](assets/branding/aj-mascot-v1.md)、简短欢迎词和三条快捷建议。点击建议会切换到键盘并填入草稿，不自动发送。模型名称和完整记忆条放在设置里，记忆入口保留在右上角的心形按钮。界面静态文案中，英文字母与汉字之间留空格；不改写历史消息或用户输入。聊天中仍显式标记 AI 生成；没有改变大模型系统提示词、会话数据结构或模型付费方式。

语音只是一种输入方式：按住开始、松开识别，结果追加到文字草稿，用户确认后才走现有生成接口。不会自动提交识别结果，也不会把录音文件传给本项目后端、OSS 或 CMS。识别服务可能在服务商云端处理语音，不能宣称全程本地或零第三方传输。

- **微信端**：使用微信自研的 `WechatSI` 插件（[腾讯接入示例](https://github.com/Tencent/Face2FaceTranslator)）。需要先在本小程序后台添加插件 `wx069ba97219f66d99`，并完善涉及录音及第三方语音处理的隐私声明。首次按住时才请求麦克风权限。
- **H5**：使用浏览器的 [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)，不是所有浏览器都支持，识别也可能依赖浏览器厂商的网络服务。要求 HTTPS 或 localhost；失败时明确提示键盘兜底，不假装录音成功。
- 最长录音 60 秒，松开后最多等待识别 15 秒；取消、切换键盘、退出页面或应用进入后台会停止录音并忽略迟到结果。
- 文字上限仍为 4000 字。识别追加超长时不截断草稿，要求编辑后再发送。

用户已通过微信后台截图确认「微信同声传译」授权通过，可用版本为 `0.3.10`。当前构建默认使用这个固定版本，插件声明与界面开关共用 `config/speech.ts`；换成其他 AppID 时须重新申请授权。**插件授权与代码启用不代表真机录音识别已经验收**，仍需在手机上检查隐私授权、麦克风许可及识别结果。

微信后台使用入口是「左下角小程序名称 → 账号设置 → 顶部第三方设置 → 插件管理」，不是「基础功能 → 小程序插件」的开发入口。需核对用户隐私保护指引中的录音用途和第三方处理说明；本地代码不能代替后台隐私配置。`scope.record` 通过运行时请求授权，不能填在 `app.json` 的 `permission` 中（该字段仅支持指定的位置权限）。

如需覆盖版本，把后台已授权的可用版本写入构建变量：

```sh
HELLO_WECHAT_SI_VERSION=<后台已授权的版本号> HELLO_API_ORIGIN=https://aj-preview.codeforpeople.cn pnpm --filter @cfp/hello-agent-miniapp build:weapp
```

不要把示例仓库中的历史版本误当成当前后台版本。显式设置 `HELLO_WECHAT_SI_VERSION=''` 会禁用插件，点击语音提示“尚未开通”，键盘和图片仍可用。此开关和插件 AppID 都是公开配置，不需要 AppSecret 或模型密钥。

微信端 API 响应校验显式传入 `jitless: true`，不依赖 `Function` 动态编译；H5 与服务端保持原方式。成功响应、嵌套对象和错误响应仍完整校验，不能用类型断言或跳过校验修复微信兼容性。回归测试模拟微信返回不可调用对象的动态函数构造器，覆盖真实 API 客户端边界。

## 验证

```sh
pnpm --filter @cfp/hello-agent-miniapp typecheck
pnpm --filter @cfp/hello-agent-miniapp lint
pnpm --filter @cfp/hello-agent-miniapp test
pnpm --filter @cfp/hello-agent-miniapp build
pnpm --filter @cfp/hello-agent-miniapp test:wxss
pnpm --filter @cfp/hello-agent test:integration
pnpm --filter @cfp/hello-agent test:e2e
```

`test:wxss` 使用本机微信开发者工具自带的 `wcsc` 编译实际微信产物，覆盖 Taro 构建不能发现的样式语法问题。默认查找 macOS 安装路径；其他路径通过 `HELLO_WXSS_COMPILER` 指定。缺少工具时明确失败，不静默跳过。该检查应在构建后、预览或上传前执行，不依赖微信账号授权。

两端编译通过不等于微信真机验收。H5 和开发者工具模拟器已验证真实文字生成；微信端认证 / 图片接口另有隔离 HTTP 测试。真机键盘行为、域名配置与相册权限仍需进一步检查。
