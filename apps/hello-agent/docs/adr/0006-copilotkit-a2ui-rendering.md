# 使用 CopilotKit A2UI 渲染器，微信共用官方核心

## 决策

H5 直接使用 CopilotKit `@copilotkit/a2ui-renderer@1.79.0` 的 A2UIProvider、A2UIRenderer 与 createCatalog。微信小程序没有 DOM，使用该版本依赖的 `@a2ui/web_core@0.10.4` MessageProcessor 和 ComponentContext，只保留把组件树映射为 Taro 原生组件的适配。通过 Taro 的平台文件解析选择入口，微信包不引入 CopilotKit 的 DOM 渲染代码。

这替换 ADR-0003 中自行处理 A2UI surface/data 更新的实现选择，保留其产品记录所有权、受限组件目录、工具保存、媒体权限和表单服务端校验。AG-UI 仍承载相同的 A2UI 事件。共享协议包验证消息并保留操作序列，移除自研 reducer；状态合并、数据路径更新、删除和动作元信息交给官方核心。

## 兼容边界

上游当前使用 v0.9 标记，产品公开协议和已有客户端使用 v0.9.1。仅在 SDK 入口适配标记，在产品出口校验并恢复原协议；兼容测试覆盖实际消息和提交动作。已有回应作品不做数据库迁移，不改模型输出格式或管理员提示词。

两端共享同一份受限组件目录、外观和表单交互。CopilotKit 目录采用 Zod 3，字段校验委托给原 Zod 4 定义并关闭动态编译；公开目录 JSON Schema 仍由原定义生成。不会自动开放基本目录中的视频、Modal、函数调用等未经适配的能力。A2UI 图在交给渲染器前验证循环、深度、展开数量和资源上限。

表单草稿与已确认答案属于产品交互状态。输入同步到官方数据模型，但只有明确提交才发送；历史重新获取不覆盖失败草稿，0 分保持有效。官方事件分发器会捕获监听异常，业务层必须在监听器内处理并显示提交失败。两端均消费同一动作元信息；服务端继续重取题目和核对归属。

## 取舍与验证

保留少量微信原生树适配与产品组件，这是微信运行环境与网页不同所需的部分。H5 不再自写树渲染，双方不再自写协议状态处理。没有引入 CopilotRuntime、默认聊天界面或额外模型调用，避免将 Payload 历史、ADK 协调器和共享额度迁入另一套运行时；可独立使用的官方 A2UI 渲染器已经覆盖本次需求。

同一组集成用例实际运行两种入口，覆盖五种作品、分块更新、修改/删除、表单往返、提交期间回调变化和历史恢复，并在微信路径禁止 DOM 和动态函数。构建检查 H5 包含 CopilotKit 渲染器、微信只包含官方核心；微信原生 WXSS 编译通过。实际 H5 构建经 Chromium 检查五类作品、图片显示、0 分、失败保留答案后重试、刷新恢复已提交答案、网页展开和长页面滚动（本地模拟接口，不调用真实模型）。仍需微信真机验收。

参考：[CopilotKit 官方 A2UI 集成](https://docs.copilotkit.ai/a2a/generative-ui/a2ui)、[官方渲染器源码](https://github.com/CopilotKit/CopilotKit/tree/main/packages/a2ui-renderer)、[A2UI 核心](https://github.com/a2ui-project/a2ui/tree/main/renderers/web_core)。
