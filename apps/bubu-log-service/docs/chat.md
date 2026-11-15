# 内置对话接入（#395）

> 2026-11-14 已确认并实现[活动业务规则与强制选择题追问](activity-business-rules-2026-11-14.md)：追问必须带选项，正式发送前检查，不符合就重新生成。代码与自动化验收已纳入本仓库；尚未部署，也未完成目标手机真机验收。

本模块叠在录入 PR #401 上，依赖同一个 `IdentityService`、`AttachmentService` 和真实 `/api/mcp`。记录字段、15 类完整性、候选与重复、字段证据、撤销、统计、群待补事项仍由[录入契约](records-mcp.md)维护。聊天只保存私人的输入、回复和可恢复的执行进度，不写旧 Activity，不向微信群发消息。

## 运行配置

新小程序默认 `BUBU_AUTH_MODE=sidecar`；旧部署兼容需要显式 `BUBU_AUTH_MODE=legacy`。登录、日历、聊天、附件使用同一服务与宝宝权限。生产 `openStore` 在已有身份和录入集合上增加 `chatCollections`，迁移 `20261023_132619_private_chat` 增加私人轮次集合，不改旧业务字段。

服务端配置 `BUBU_CHAT_API_KEY`、`BUBU_CHAT_MODEL`、可选 `BUBU_CHAT_BASE_URL`（默认 `https://api.openai.com/v1`）与 `BUBU_CHAT_STRUCTURED_OUTPUT_MODE`。官方 OpenAI 主机使用严格 `json_schema`；官方 DeepSeek Chat Completions 主机使用其支持的 `json_object`，把同一 Schema 放入系统指令并继续执行本地严格解析、选择题校验和语义校验。未知兼容主机必须显式选择模式，不根据一次 HTTP 错误盲目降级。无工具的回复校验／重新生成不发送空 tools；DeepSeek 的所有请求（包括工具循环）都显式关闭 thinking，因为当前便携转录不持久化其后续工具请求强制要求的 `reasoning_content`；主规划模型和提供方不变。模型必须支持 Chat Completions 图文内容与 function tools；不把文字模型的接口成功当成视觉验收。未配置时发送明确报错，仍可登录和看日历；生产入口没有测试模型开关。请求使用非流式图文与工具调用，并具有超时、响应上限、结构校验及错误脱敏。图片采用服务端鉴权读取的 base64 内容，格式参考[官方视觉输入文档](https://developers.openai.com/api/docs/guides/images-vision)。

`BUBU_CHAT_MCP_URL` 只用于服务端内部连接，默认 `http://127.0.0.1:<PORT>/api/mcp`。委托凭证只在 MCP 运输层，API key 只在 provider 运输层；不放入环境示例实际值、浏览器包、聊天历史或模型工具参数。用户可见设置不提供模型或 BYOK 切换。

当前照片、明确选中记录的私有附件，以及明确指向最近一轮图片的追问，都会在每次 provider 调用前重新鉴权并加载图片字节，最多三张，并标注所属轮次或事件。多图指代有歧义时先询问；模型不会仅凭历史文字声称看过图。持久检查点只保留附件引用，不写 base64。带图轮次中的尿便、尿量与颜色判断均保留为未确认视觉证据；下一轮明确文字可确认。补图失败或移除照片使用媒体工具，不要求先读取损坏图片。

## 客户端接口

认证头、Cookie 与 Origin 检查沿用[身份模块 README](../README.md)。仅真实照护者可以使用私人聊天；服务端重新核对身份、宝宝权限及附件归属。

读取历史使用只读 MCP 委托；只读照护者仍能查看本人的历史和共享待补。发送与恢复执行要求写权限，不能通过聊天扩大照护权限。

| 方法和路径 | 输入 | 返回 |
| --- | --- | --- |
| `GET /api/app/chat?babyId=…` | 当前宝宝 | `{conversationId,babyId,turns,pending,pendingCount,replyQuestions,automaticMessages,firstWeekNotice?}`；私人轮次、当前共享待补与宝宝共享首周总结 |
| `POST /api/app/chat` | `ChatInput` | `{turn}`；持久化后迅速返回，后台执行 |
| `GET /api/app/chat/request?babyId=…&requestId=…` | 原发送请求号 | `{turn:null或ChatTurn}`；查询不发起新的业务操作 |
| `GET /api/app/records/sources?babyId=…&eventId=…` | 照护者会话（H5/微信小程序） | `{babyId,eventId,messages,unavailableCount}`；仅展开该事件已保存的精确来源 |

`ChatInput`：

普通自然聊天不携带 `formAnswer`，由对话模型理解输入并计划受控 MCP 工具：

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

`formAnswer` 仅用于当前字段待补，并走既有 MCP 确定性提交路径，不经过对话模型；必须绑定 `question` 和 `context.selectedEventId`，只能提交服务端在该事件 `pending[].form.controls` 中暴露的当前字段；0 与 `false` 按原值保存，`unknown` 不会被折算为默认值；时间待补项允许等价的 `durationMinutes` 或 `endTime`。表单提交后服务端把轮次文本规范成结构化摘要；同一请求号恢复时可用原输入，也可采用服务端轮次的 `input` 重发。不带 `formAnswer` 的普通输入中，`question` 整体可省略；`context.selectedEventId` 与 `context.mediaPendingId` 均可省略。浏览日期提供定位上下文，不能把“刚才/现在”记成浏览日期；当前消息时间由服务端保存。`kind:media` 的问题使用 `mediaPendingId`，不能伪装成字段问题传给 `bubu_answer_pending`。图片先二进制上传取得受保护附件 ID，随后参与图文输入及 MCP 关联；不接受任意远程图片地址。

当前字段表单的紧凑示例（`question` 与 `context.selectedEventId` 为必需）：

```json
{
  "babyId": "当前已授权宝宝",
  "requestId": "同一次发送始终保持的请求号",
  "text": "",
  "attachmentIds": [],
  "formAnswer": {"facts": {"milkAmount": 0, "burpSuccess": false}},
  "context": {"viewedDate": "2026-10-23", "selectedEventId": "当前事件ID"},
  "question": {"id": "当前字段问题ID", "questionVersion": 3, "eventVersion": 4}
}
```

历史响应还包含 `automaticMessages`：仅展示采集操作产生的最多最近 100 条持久通知，每个采集请求一条；投影从待确认恢复为成功时更新原通知，不新增重复通知，也不把未知信息说成已完整保存。升级前没有通知的历史操作不补造内容。

`firstWeekNotice` 是独立的宝宝共享自动通知，不伪装成用户消息、采集消息或助手私人对话。它持久包含上海时区可读的数据期间、样本数、实际规律、最终采用的快捷选项，以及哪些手工配置保持不变；客户端在历史时间线中按 `createdAt` 展示，并说明可通过聊天或“设置 → 记录常用选项”调整。会话刷新、轮询、宝宝切换和新轮次完成不会把该字段从当前宝宝状态中丢掉。

每次人工聊天轮次先用只读工具取得当前宝宝的共享常用选项和版本。数值／时长／次数待补表单只显示该活动对应的有序有效选项，默认不展开输入；快捷项本身不自动成为事实，次数选项也不使次数变为必填。时间快捷项只从事件最早的权威来源 `sentAt` 生成“按原消息时间／提前 5 分钟／提前 10 分钟”，不使用当前墙钟或浏览日期修补旧事项。设置页和聊天共用带版本的配置：普通“这次喝了 210 ml”没有配置权限，只有“加入／删除／调整常用选项”等明确配置意图才允许模型调用更新工具；服务端注入观察版本、稳定请求号和当前宝宝，冲突时不刷新后强制覆盖，丢失响应则按原固定参数幂等恢复。成功文案只来自实际配置回执并列出当前顺序。

`records/sources` 不改变默认历史：日常聊天和记录列表仍只返回摘要、回执和待补，不携带微信群原文。照护者 H5 Cookie 会话和微信小程序 native token 会话均可调用；每次请求都重新核对当前 `records:read` 权限，采集器、运营和服务代理不能调用。服务端在同一授权事务中先定位该宝宝下的精确事件，再按微信 `kind/accountId/groupId/conversationId/messageId` 关联已保存原始消息，重复引用去重、按时间稳定排序且不截断。来源缺失时返回 `text:null` 的元数据并计入 `unavailableCount`，不编造正文或发送者名称；仅显示采集时保存的 `senderName` 和通过安全校验的可选 `senderAvatarUrl`，否则由客户端展示发送者 ID。头像只接受 HTTPS 的 `wx.qlogo.cn`/`thirdwx.qlogo.cn` 微信头像路径，不接受带凭据 URL 或 data/javascript/file 等协议。聊天来源只读取当前照护者本人的私人轮次并显示为“我”，绝不展开其他照护者的私人输入。

轮次包含 `id/requestId/conversationId/babyId/createdAt/updatedAt/input/assistantText/receipts/pending/refreshRequired`。状态 `processing` 表示后台执行，`completed` 表示本轮已结束，`failed` 或 `needs_recovery` 带 `{code,message,retryable}`。**轮次完成不等于记录完整**，照护事实的确认和缺项以 `receipts` 为准。`pending_projection` 不说已记录；旧版本冲突要求刷新后重新表达，不以新版本偷偷覆盖。

## 恢复与私密范围

客户端在身份和宝宝分区中保留草稿、图片 ID、请求号和原发送参数。收起不取消提交。遇到超时先 GET 原请求；已完成直接采用回执，仍执行则继续查询，需要恢复时以原参数 POST 原请求号。同号异内容拒绝，不能用随机新号重放未知结果。服务端检查点持久化模型工具计划及每次 MCP 结果；再次执行复用原工具请求号。

进入聊天重新读取共享待补状态，问题不依赖模型记忆。其他照护者或后续群消息补齐后，旧问题不继续要求回答；迟到答案返回过期。明确未知继续使用，并保留未知状态。补图、重复核对和时间重叠用各自 MCP 工具，不混为普通字段缺项。

所有需要回答的用户可见出口都使用结构化选择题或事件表单：类型歧义只展示与该事件有关的活动，冲突、重复候选和媒体恢复与该事件的字段放在同一步；问题 ID 带当前问题版本，历史同 ID 不会遮住新版本。模型候选先清除无回执的完成声明，再做本地完整校验与独立语义校验；不合格只重新生成回复，绝不重放已完成工具。连续失败时只发送经过检查的封闭陈述和既有可靠回执，不在校验后追加开放问题。升级前历史只有持久 `replyGate.version=1` 才可信任原助手输出；所有未检查旧回复和旧选择题都由服务端回执摘要或中性陈述替代，原用户消息与按当前权威状态重建的待补表单保持不变。

保存回执触发当前宝宝日历、详情与趋势重新读取统一 snapshot/summary，页面不自行累加奶量或条数。退出、授权失效与宝宝切换阻止迟到响应显示旧数据，并清理相应本地草稿/发送状态和已下载照片。服务端历史按身份+宝宝查询，不把另一个照护者的聊天正文交给模型。

## 验证边界

测试模型仅能在测试代码中通过构造函数注入；测试旧后端、模型与微信身份均为合成数据。持久层使用临时真实 Payload SQLite，工具执行经过真实 SDK MCP 和 loopback HTTP；生产迁移验证覆盖空库、身份层升级、录入层升级以及关闭重开。H5 流程另核对聊天与实际记录刷新，微信产物仍需要本产品 AppID、域名、WechatSI 插件授权与麦克风真机验收。语音识别结果先进入可编辑草稿，不自动发送。

在小程序目录运行 `pnpm build:h5 && pnpm test:e2e:chat-live` 可复现隔离的浏览器链路。该测试启动 `test:browser-server`，使用临时数据库、测试账号、合成群待补和显式脚本模型，不拦截浏览器 API，也不连接真实模型或旧业务站。图片使用合成小图片，只验证传输与待确认流程，不代表识别质量。

此次不调用真实模型、不读取真实客户群或客户库、不迁移生产数据、不启用支付。图片视觉判断与自然语言提取的真实质量须在配置的视觉 provider 上单独验收；原公开照片的历史可访问性与旧站同时写入窗口仍保留上游已说明的限制。
