# 内置对话接入（#395）

本模块叠在录入 PR #401 上，依赖同一个 `IdentityService`、`AttachmentService` 和真实 `/api/mcp`。记录字段、15 类完整性、候选与重复、字段证据、撤销、统计、群待补事项仍由[录入契约](records-mcp.md)维护。聊天只保存私人的输入、回复和可恢复的执行进度，不写旧 Activity，不向微信群发消息。

## 运行配置

新小程序默认 `BUBU_AUTH_MODE=sidecar`；旧部署兼容需要显式 `BUBU_AUTH_MODE=legacy`。登录、日历、聊天、附件使用同一服务与宝宝权限。生产 `openStore` 在已有身份和录入集合上增加 `chatCollections`，迁移 `20261023_132619_private_chat` 增加私人轮次集合，不改旧业务字段。

服务端配置 `BUBU_CHAT_API_KEY`、`BUBU_CHAT_MODEL`、可选 `BUBU_CHAT_BASE_URL`（默认 `https://api.openai.com/v1`）。模型必须支持 Chat Completions 图文内容与 function tools；不把文字模型的接口成功当成视觉验收。未配置时发送明确报错，仍可登录和看日历；生产入口没有测试模型开关。请求使用非流式图文与工具调用，并具有超时、响应上限、结构校验及错误脱敏。图片采用服务端鉴权读取的 base64 内容，格式参考[官方视觉输入文档](https://developers.openai.com/api/docs/guides/images-vision)。

`BUBU_CHAT_MCP_URL` 只用于服务端内部连接，默认 `http://127.0.0.1:<PORT>/api/mcp`。委托凭证只在 MCP 运输层，API key 只在 provider 运输层；不放入环境示例实际值、浏览器包、聊天历史或模型工具参数。用户可见设置不提供模型或 BYOK 切换。

当前照片、明确选中记录的私有附件，以及明确指向最近一轮图片的追问，都会在每次 provider 调用前重新鉴权并加载图片字节，最多三张，并标注所属轮次或事件。多图指代有歧义时先询问；模型不会仅凭历史文字声称看过图。持久检查点只保留附件引用，不写 base64。带图轮次中的尿便、尿量与颜色判断均保留为未确认视觉证据；下一轮明确文字可确认。补图失败或移除照片使用媒体工具，不要求先读取损坏图片。

## 客户端接口

认证头、Cookie 与 Origin 检查沿用[身份模块 README](../README.md)。仅真实照护者可以使用私人聊天；服务端重新核对身份、宝宝权限及附件归属。

读取历史使用只读 MCP 委托；只读照护者仍能查看本人的历史和共享待补。发送与恢复执行要求写权限，不能通过聊天扩大照护权限。

| 方法和路径 | 输入 | 返回 |
| --- | --- | --- |
| `GET /api/app/chat?babyId=…` | 当前宝宝 | `{conversationId,babyId,turns,pending,pendingCount}`；私人轮次与当前共享待补事项 |
| `POST /api/app/chat` | `ChatInput` | `{turn}`；持久化后迅速返回，后台执行 |
| `GET /api/app/chat/request?babyId=…&requestId=…` | 原发送请求号 | `{turn:null或ChatTurn}`；查询不发起新的业务操作 |

`ChatInput`：

```json
{
  "babyId": "当前已授权宝宝",
  "requestId": "同一次发送始终保持的请求号",
  "text": "泡了120，剩20，是同一瓶",
  "attachmentIds": [],
  "context": {"viewedDate": "2026-10-23", "selectedEventId": "可选原记录ID"},
  "question": {"id": "可选字段问题ID", "questionVersion": 1, "eventVersion": 2}
}
```

`question` 整体可省略；`context.selectedEventId` 与 `context.mediaPendingId` 均可省略。浏览日期提供定位上下文，不能把“刚才/现在”记成浏览日期；当前消息时间由服务端保存。`kind:media` 的问题使用 `mediaPendingId`，不能伪装成字段问题传给 `bubu_answer_pending`。图片先二进制上传取得受保护附件 ID，随后参与图文输入及 MCP 关联；不接受任意远程图片地址。

轮次包含 `id/requestId/conversationId/babyId/createdAt/updatedAt/input/assistantText/receipts/pending/refreshRequired`。状态 `processing` 表示后台执行，`completed` 表示本轮已结束，`failed` 或 `needs_recovery` 带 `{code,message,retryable}`。**轮次完成不等于记录完整**，照护事实的确认和缺项以 `receipts` 为准。`pending_projection` 不说已记录；旧版本冲突要求刷新后重新表达，不以新版本偷偷覆盖。

## 恢复与私密范围

客户端在身份和宝宝分区中保留草稿、图片 ID、请求号和原发送参数。收起不取消提交。遇到超时先 GET 原请求；已完成直接采用回执，仍执行则继续查询，需要恢复时以原参数 POST 原请求号。同号异内容拒绝，不能用随机新号重放未知结果。服务端检查点持久化模型工具计划及每次 MCP 结果；再次执行复用原工具请求号。

进入聊天重新读取共享待补状态，问题不依赖模型记忆。其他照护者或后续群消息补齐后，旧问题不继续要求回答；迟到答案返回过期。明确未知继续使用，并保留未知状态。补图、重复核对和时间重叠用各自 MCP 工具，不混为普通字段缺项。

保存回执触发当前宝宝日历、详情与趋势重新读取统一 snapshot/summary，页面不自行累加奶量或条数。退出、授权失效与宝宝切换阻止迟到响应显示旧数据，并清理相应本地草稿/发送状态和已下载照片。服务端历史按身份+宝宝查询，不把另一个照护者的聊天正文交给模型。

## 验证边界

测试模型仅能在测试代码中通过构造函数注入；测试旧后端、模型与微信身份均为合成数据。持久层使用临时真实 Payload SQLite，工具执行经过真实 SDK MCP 和 loopback HTTP；生产迁移验证覆盖空库、身份层升级、录入层升级以及关闭重开。H5 流程另核对聊天与实际记录刷新，微信产物仍需要本产品 AppID、域名、WechatSI 插件授权与麦克风真机验收。语音识别结果先进入可编辑草稿，不自动发送。

在小程序目录运行 `pnpm build:h5 && pnpm test:e2e:chat-live` 可复现隔离的浏览器链路。该测试启动 `test:browser-server`，使用临时数据库、测试账号、合成群待补和显式脚本模型，不拦截浏览器 API，也不连接真实模型或旧业务站。图片使用合成小图片，只验证传输与待确认流程，不代表识别质量。

此次不调用真实模型、不读取真实客户群或客户库、不迁移生产数据、不启用支付。图片视觉判断与自然语言提取的真实质量须在配置的视觉 provider 上单独验收；原公开照片的历史可访问性与旧站同时写入窗口仍保留上游已说明的限制。
