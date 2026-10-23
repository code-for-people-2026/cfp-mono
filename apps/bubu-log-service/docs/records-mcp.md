# 录入与聊天接入契约（#393）

入口是 `POST /api/mcp`，使用 MCP Streamable HTTP / JSON 响应。接入方使用 `@modelcontextprotocol/sdk` 的 `Client` 与 `StreamableHTTPClientTransport`，先 initialize/listTools，再 callTool；不把 HTTP JSON 自称 MCP。连接层持有 `Authorization: Bearer <受限凭证>`、`X-Bubu-Client: native`，不发送 Cookie。每次工具执行重新认证并核对宝宝/群授权。照护者会话通过身份模块签发 `chat-agent`；退出父会话或撤权后已有 MCP 连接同样失效。

工具参数、模型提示和群消息均不得携带凭证或自造 Principal。宝宝 ID 必须来自已验证身份上下文；群采集仅允许凭证绑定的群与 Agent。所有工具的真实参数 schema 可通过 `listTools` 获取，以下说明补充调用语义。

## 写入和恢复

共同参数：`babyId`；变更增加稳定 `requestId`（8–128 字符）；修改原事件增加 `eventId`、`expectedVersion`（当前正整数版本）。同一请求超时必须使用原请求号与原参数，不能随机换号重试；同号异内容返回 `IDEMPOTENCY_CONFLICT`。重新读取后的人类更正使用新请求号。

| 工具 | 额外参数 | 行为 |
| --- | --- | --- |
| `bubu_record_events` | `events: EventInput[]`，1–25 项 | 批量保存；每项可缺字段；同一原消息事件重放返回原记录 |
| `bubu_update_event` | `patch: RuleInput, sources?` | 补充/纠错原事件，重新检查字段、时间与重复 |
| `bubu_retract_event` | 无 | 明确撤销；旧事实删除，sidecar 来源和修订保留 |
| `bubu_restore_event` | 无 | 明确恢复撤销记录；重新检查重复；采集不得自动恢复 |
| `bubu_undo_event` | `revisionId` | 仅撤销当前最新修订；撤销创建变成撤销记录 |
| `bubu_answer_pending` | `questionId,questionVersion,eventVersion,patch,sources?`，不另传 eventId | 回答当前问题并更新原事件；迟到/旧版本返回 `QUESTION_STALE` |
| `bubu_attach_images` | `attachmentIds: string[]`，最多10项 | 设置完整图片列表；空数组移除；要求 `media:write` |
| `bubu_resolve_duplicate` | `resolution: distinct或same`；same还需 `targetEventId,targetVersion` | distinct分别计数；same合并来源及图片并保留候选撤销标记，不用候选字段覆盖目标事实 |
| `bubu_confirm_overlap` | `conflictingEventIds,reason` | 照护者明确核对实际重叠；确认绑定双方时间快照，时间变化后重新核对 |
| `bubu_resolve_media` | `pendingId,eventId,expectedVersion,mediaIndex?,resolution?,attachmentId?` | 照护者把已挂在事件的私有替代图与待补图事项关联，或resolution=unknown明确不再催问；不能假称图片已读取 |
| `bubu_accept_legacy` | 无 | 核对冲突后接受旧库当前事实，缺失则撤销；待恢复写入不能绕过该恢复步骤 |
| `bubu_get_request` | `babyId,requestId,retry?` | 查询请求；`retry:true` 恢复尚未完成的原操作 |

`RuleInput` 是 `{facts,states?,progress?,intent?,evidence?}`，`EventInput` 额外允许 `sources?`、`attachmentIds?`。`facts` 字段见 `src/records/schemas.ts`，不接收任意照片 URL。`intent:"feeding"` 可以保留尚未确定亲喂或瓶喂的语义，类型待问，不默认瓶喂。

```json
{
  "babyId": "从已验证上下文读取",
  "requestId": "chat-turn-42-record-1",
  "events": [{
    "facts": {
      "type": "BOTTLE",
      "startTime": "2026-10-23T10:20:00+08:00",
      "milkSource": "FORMULA",
      "preparedMilkAmount": 120,
      "remainingMilkAmount": 30,
      "sameBottle": true,
      "durationMinutes": 15
    },
    "states": {"burpSuccess": "unknown"},
    "sources": [{
      "kind": "chat", "accountId": "应用用户标识", "conversationId": "对话标识",
      "messageId": "原消息标识", "eventKey": "第一个事件",
      "sentAt": "2026-10-23T10:40:00+08:00", "senderId": "报告者标识"
    }]
  }]
}
```

规则只在同瓶关系明确时计算实际喝入量，上例为90ml；泡好量120ml独立保留，不等于喝入量。原消息时间决定“刚才/昨晚”等相对时间的解释，模型应输出带时区的已确认时间，不用采集执行时刻替代。缺类型或时间的候选先保存，尚不创建不合法的旧 Activity。禁止猜量、把“不知道”变成0或套用旧表单最近选择。

回执：`{requestId,status,events,questions,retryable}`。事件包含版本、字段状态、来源、附件ID、修订状态及 `projection`；`projected` 是最后确认写入的旧事实，`facts` 可以是尚待核对的修改。

| status | 对用户的准确说法 |
| --- | --- |
| `saved` | 已保存，仍须按返回版本继续操作 |
| `needs_information` | 已保存已有内容；保留待补充或疑似重复，不能宣称字段完整 |
| `pending_projection` | 保存意图已持久化，但旧业务写入或统计尚未确认；用原请求号恢复 |
| `conflict` | 旧事实已变化，保留双方记录等待核对，不能声称覆盖成功 |

工具失败通过 MCP `isError:true` 与文本 JSON `{code,error,retryable}` 返回；HTTP认证失败也可能先返回401。`VERSION_CONFLICT/QUESTION_STALE` 需要重新读取后再决定，不能自动用新版本覆盖。网络中断本身不证明失败，应先查询原请求。

## 字段与分支规则

`states`：`known` 有明确值；`pending` 待问；`unknown` 照护者明确不知道；`not_applicable` 本事件不适用；`not_yet` 尚未发生。`progress`：`ongoing/ended/unknown`。0与false为合法已知值。备注、照片可选；未知状态不反复催问，也不把不完整显示成完整。

| 活动 | 条件字段 |
| --- | --- |
| BREASTFEED 亲喂 | 起止/时长、拍嗝、乳房软硬；进行中不追问尚未发生的拍嗝 |
| BOTTLE 瓶喂 | 奶来源、实际喝入量、起止/时长、拍嗝；奶粉另保留泡好量；母乳瓶喂不要求泡好量 |
| PUMP 吸奶 | 泵出量、起止/时长；不计入宝宝喝奶总量 |
| SLEEP 睡眠 | 结束或进行中状态；跨夜按北京时间分日，进行中不计完成分钟 |
| DIAPER 尿布 | 有尿/有便；有尿才问尿量，有便才问颜色；图片判断保留证据与未确认状态 |
| HEAD_LIFT、PASSIVE_EXERCISE、GAS_EXERCISE、BATH、OUTDOOR、EARLY_EDUCATION | 起止/时长，进行中单独显示 |
| ROLL_OVER、PULL_TO_SIT | 发生时间、明确次数，不能默认为1 |
| SUPPLEMENT | 发生时间、AD/D3/益生菌/益生元类型 |
| SPIT_UP | 发生时间、普通或喷射类型 |

`evidence` 项为 `{field,kind:reported|image|extracted|calculated,confirmed,sourceKey?,detail?}`。未确认的图片判断不会变成已知值，后续明确文字答案替代该字段的旧图片证据。时间先后、未来日期、时长矛盾、同瓶余量以及睡眠/活动重叠均保留核对事项。不同入口的近时同类事件标疑似重复，不自动删除或重复累计。

## 查询与页面刷新

- `bubu_query_events {babyId,date?,eventId?,includeRetracted?}` 返回 `{events,activities,questions,summary?}`；date 为北京时间 `YYYY-MM-DD`，选择指定日的事实与候选。events的`facts/projected`保留本服务修订视图，`currentActivity`是本次实际从旧库读到的事实（无记录时null）；查询本身不改历史审计。统计使用当前事实。明确进行中的跨日事件延展到当前时间，单纯没有结束时间不视为无限持续；旧站补结束时间后不被陈旧进行中状态遮蔽。
- `bubu_get_summary {babyId,date}` 返回同一 `metrics/coverage/byType`。metrics 保留旧 DailyStat 字段语义；coverage区分未知、进行中、候选、重复，byType额外区分已知奶量/次数/时长。聊天不得自行从文本重算另一个总量。
- `bubu_get_pending {babyId}`、`bubu_get_revisions {babyId,eventId}`、`bubu_get_rules {babyId,type?,milkSource?}` 提供后续补充、核对与分支提示。
- `bubu_get_pending` 同时返回 `kind:media` 的待补图事项，包含来源、eventIds和未取得/未关联原因；它使用上传/关联、补采或 `bubu_resolve_media` 处理，不送入字段问题的 `bubu_answer_pending`。snapshot把这类事项放在 `mediaQuestions`。
- 页面登录凭证可读 `GET /api/app/records/snapshot?babyId=…&date=…`、`records/pending`、`records/revisions?babyId=…&eventId=…`、`records/sync`。记录保存后重新拉 snapshot 和当前趋势日期范围即可，不在前端盲目累计回执。
- sidecar模式已有 `activities`、`daily-stats` 路由也读取同一业务投影；旧站构建模式不变。历史事实缺少新metadata时不补造待问，不批量重写历史。实际尿次数与旧UI折算分开处理。
- 页面401清会话、403清宝宝数据并刷新授权；宝宝切换后取消旧请求。来源账号、原文不放进采集状态卡，卡片只展示启停、最后成功、处理至、待处理、下次尝试和失败码。

## 私有图片

使用当前服务器持有的受限凭证上传二进制到 `POST /api/app/attachments?babyId=…`，头部 `Content-Type:image/png|image/jpeg|image/webp`、`X-Bubu-Request-Id:<稳定ID>`。可选 `X-Bubu-Source` 是 URI 编码的完整 SourceRef JSON（4KiB以内）；群采集必须有匹配群来源。浏览器仍遵守既有Origin/Cookie检查。返回 Attachment 包含 `id,url,mime,byteLength,sha256`，再调用录入/关联工具。

上传上限10MiB，验证实际像素与完整格式，保持原字节；文件保存在 `BUBU_IDENTITY_DIRECTORY/private-attachments`，不公开挂载。GET返回的相对 `url` 每次重验宝宝、群及 `media:read`，私有不缓存。截图本身不能作为已读/已确认的证据；旧公开照片不能追溯撤销，但新HTTP/MCP响应仅给受保护代理路径。图片采集实现和无法定位时的持久待补图流程见 [collector.md](collector.md)。

## 运维和并发边界

启动注册与身份模块同一个 `openStore({extensions:recordCollections})`，提交迁移新增9个独立集合，不改变旧字段。只支持单个sidecar写进程，版本检查串行执行，SQLite是真事务。服务重启后意图、修订、问题、群游标、附件元数据仍在；备份必须包含sidecar目录、附件与旧业务库。

旧后端HTTP不属于SQLite事务。旧REST条件选择并非原子CAS，仍有旧站同时写入的竞争窗口；生产双写入口必须先停旧写入或增加数据库原子版本端点。详见 [ADR-0002](adr/0002-durable-care-operations.md)。本模块提供实际Payload REST契约与隔离SQLite验证，不声称已经在真实客户数据库、微信群、真实模型或微信真机验收。
