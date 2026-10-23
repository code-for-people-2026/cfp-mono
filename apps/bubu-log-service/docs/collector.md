# 受控微信群采集

采集器读取运营显式绑定的一个账号、一个群，调用外部 Agent 整理后，通过真实 MCP Client 写入同一业务服务。批次、原始来源、游标、心跳、失败、补采与图片待补状态存放在身份服务同一 Payload SQLite 库的 `care-batches`、`care-messages`、`care-sync`；不会另建身份库或让 Agent 直接操作数据库。

仓库内未启用任何真实群、定时任务或模型调用。以下配置中的路径、账号、宝宝和群均为示例，运营须替换为已授权范围。

## 运行前提

- 正常运行本服务，部署记录 collections/migrations 与受保护附件目录；MCP 地址为 `https://服务域名/api/mcp`，本机开发可用 `http://127.0.0.1:3320/api/mcp`。
- 已有微信本地数据读取授权，以及可运行的 `wechat-cli` Python 环境。wrapper 导入既有 `wechat_cli.core.messages` 的解析 API；不修改安装包。生产模式只有同时指定 `allowLive: true` 与 `configPath` 才构造 `AppContext`。不会默认发现账号、群或配置。
- 运营在当前身份库中建立 `wechat:<accountId>:<chatId>` 的 active group binding，指定 babyId 与 agentId，再签发 `collector` Bearer。senderId 只是证据来源，不构成该身份。
- 订阅桥接要求本机 Codex CLI 已通过 ChatGPT 登录。桥接不执行登录、不读取/复制登录文件、不要求 `OPENAI_API_KEY`。本机 CLI 必须支持下述参数；不支持时失败关闭。
- 配置和 token 文件必须是仅当前用户可读的普通文件（例如权限 `0600`）。token 文件只含 token。不要把 token、微信 config/keys 或原始库放入模型提示词。

已有身份 HTTP 接口为 `POST /api/identity/group-bindings`（babyId/groupId/agentId/active）和 `POST /api/identity/agent-credentials`（babyId/kind=`collector`/groupId/agentId）；仅 operator 可执行。它们的授权和凭证持久化沿用身份服务。采集 CLI 的控制入口只配置采集作业，不替代身份授权。

## 配置与启动

在本应用目录运行。`/secure/collector.json`：

```json
{
  "mcpUrl": "http://127.0.0.1:3320/api/mcp",
  "tokenFile": "/secure/collector.token",
  "babyId": "example-baby",
  "jobId": "从 configure 的 job.id 复制",
  "pollMs": 10000,
  "codex": { "executable": "/absolute/path/to/codex", "timeoutMs": 180000 },
  "source": {
    "python": "/absolute/path/to/wechat-cli/python3",
    "configPath": "/secure/wechat-cli-config.json",
    "allowLive": true
  },
  "media": {
    "roots": ["/secure/decoded-images"],
    "mappings": [],
    "md5Directories": ["/secure/decoded-images/exact-md5"]
  }
}
```

运营控制文件使用 operator token，不使用 collector token；`/secure/collector-operator.json` 只需 `mcpUrl`、`tokenFile`、`babyId`。在 `/secure/configure.json` 写入：

```json
{
  "action": "configure",
  "accountId": "example-account",
  "chatId": "example-group@chatroom",
  "agentId": "example-collector",
  "enabled": false,
  "intervalMs": 60000
}
```

```sh
pnpm exec tsx scripts/collector.ts --config /secure/collector-operator.json --control-json /secure/configure.json
pnpm exec tsx scripts/collector.ts --config /secure/collector.json
pnpm exec tsx scripts/collector.ts --config /secure/collector.json --schedule
```

`configure` 返回稳定 `job.id`。`enabled` 默认 false；未启用的作业不会读取微信来源或调用 Agent。运营确认绑定后，在同一 configure 文件中显式改为 true 再执行控制命令。默认运行单批；`--schedule` 是可执行的长期 timer runner，响应 SIGINT/SIGTERM，不自行安装系统任务。服务器决定 nextRunAt，客户端轮询不会越过禁用/间隔约束。

订阅桥接内置在 `codex` 配置中，不需要额外写 stdin 转换程序。也可独立运行它：

```sh
pnpm exec tsx scripts/collector-codex-agent.ts --codex /absolute/path/to/codex < /secure/synthetic-agent-task.json
```

stdin 是 `bubu-collector-agent/v1` 结构化任务；stdout 仅为解析验证后的 `{plans, ignored}`。采集 runner 先通过 MCP 查询现有事件（含撤销）、待补充问题、当前业务规则与工具 schema，附上有秒精度的来源消息和图片上传结果。计划执行前会注入 babyId/requestId/SourceRef，并按真实工具参数 schema 校验，之后才持久化不可变计划。结果必须得到同一 collector 身份/群的已提交业务 operation 回执；仅导出消息或返回一段自然语言不会推进游标。

桥接使用本机 `codex exec --help` 已核对的 stdin `-`、`--ignore-user-config`、`--ignore-rules`、`--ephemeral`、`--sandbox read-only`、`--skip-git-repo-check`、`--cd`、`--output-schema`、`--output-last-message`，并以 `--no-daemon` 启动。结构化输出使用封闭 schema `{planJson: string}`（required，additionalProperties=false），再解析内部计划，避免把任意 tool arguments 的开放对象直接交给 strict structured output。

覆盖配置限制为 ChatGPT 登录，关闭 shell、apps、plugins、多 Agent、hooks、memory、browser/computer tools、view_image 与 web search；不加载用户配置或项目指令，工作目录为一次性私有临时目录。只继承 PATH/HOME/LANG 和已有 CODEX_HOME，不继承 API key 或业务凭证环境变量。临时输出在完成/失败后删除，CLI 原始日志不转发给服务日志。参数依据 [官方配置参考](https://developers.openai.com/codex/config-reference/) 和本机帮助；实际模型调用未在 fixtures 中执行。

已有其他受控 Agent 可以使用 `agent: {executable,args?,cwd?,timeoutMs?,env?}` 替代 `codex`，不能同时指定两种。该命令使用无 shell 的 stdin/stdout JSON 协议；显式 env 属于运营配置，不应传入业务凭证。

## 精确图片映射与上传

wrapper 不调用旧包按月目录“取第一个文件”的媒体路径逻辑，也不将 XML 的 CDN token/aeskey 传给模型。只输出原始消息的稳定 sourceId、媒体种类与可解析 XML MD5。图片解析有两条精确路径：

1. **来源映射**：运营提供稳定 sourceId + media index → 已解码图片的绝对路径和 SHA-256。
2. **XML MD5**：只检查 `md5Directories` 下精确文件名 `<md5>.jpg/.jpeg/.png/.webp`，且实际文件字节 MD5 必须相等，匹配必须唯一。不遍历目录、不猜邻近文件。

配置片段：

```json
{
  "media": {
    "roots": ["/secure/decoded-images"],
    "mappings": [
      {
        "sourceId": "wechat:消息来源的64位sha256",
        "index": 0,
        "path": "/secure/decoded-images/exact-message.png",
        "sha256": "已核对解码图片字节的64位sha256"
      }
    ],
    "md5Directories": ["/secure/decoded-images/exact-md5"]
  }
}
```

`sourceId = wechat:SHA256(JSON(["wechat", accountId, databaseId, tableName, localId]))`，JSON 无空格、UTF-8；databaseId 形如 `message/message_0.db`，tableName 是 `Msg_` + chatId 的 MD5。核心 SourceRef.messageId 保留 `databaseId/tableName/localId`，同源多事件使用各自 eventKey。图片路径必须位于 allowlist roots 内，拒绝文件/下级目录符号链接、越界路径、非普通文件、损坏图片与超出 10 MiB 的图片；支持静态 JPEG/PNG/WebP。

精确图片先通过同源 `POST /api/app/attachments?babyId=...` 上传原始字节，带当前 Bearer、稳定上传 requestId 和编码 SourceRef。服务验证图片与群来源并返回附件 ID。`bubu_collector media` 再核对附件已真实落库、上传身份、群、账号、消息与 media index；Agent 只能将实际 ID 通过核心 MCP 关联事件。图片读取仍需授权，没有公开 URL。采集 Agent 当前收到的是来源和附件元数据，不能将未见图片内容猜成颜色等事实；未报告的视觉事实保留未知。

没有精确映射、MD5 不匹配、文件缺失等情况按具体 reason 保存 unavailable。原 care 事实仍可记入，`pendingMedia` 表示尚待处理的来源消息数；上传成功但没有关联到 active 事件也保留待补。只有带明确理由的首次非照护消息忽略才可关闭其处理。

这些后续事项也进入 `bubu_get_pending`，以 `kind: "media"` 区分，包含稳定 pending id、来源元数据、原 eventIds 和逐项失败原因，不包含原聊天正文。采集身份只看得到完全属于本群的事件；人类合并了两个群的来源后，原采集器不能借待补图接口读取混合事件。

人类可先通过受保护上传接口上传图片，再通过 `bubu_attach_images` 关联原事件，最后调用 `bubu_resolve_media`：

```json
{
  "babyId": "example-baby",
  "requestId": "human-media-confirm-01",
  "pendingId": "media:wechat:来源的64位sha256",
  "eventId": "原关联事件ID",
  "expectedVersion": 2,
  "mediaIndex": 0,
  "resolution": "provided",
  "attachmentId": "受保护上传返回的附件ID"
}
```

该动作只接受有权限的 caregiver 或绑定真实人类会话的 chat-agent，校验原来源关联、当前 active 事件、版本、附件已真实存在且已挂在该事件。collector 不能伪造人类确认。同身份 requestId 可安全重试；变更参数会拒绝。

人类明确表示无法提供/不知道时，发送同一结构但 `resolution: "unknown"` 并省略 attachmentId。它持久记录明确未知，停止重复追问，不产生图片、不标记上传成功、不改写事件事实。不能用普通 `bubu_answer_pending` 填补这个媒体事项。

## 状态、恢复、补采和轮换

通过同一 `--control-json` 入口发送：

```json
{ "action": "status", "jobId": "已有job.id" }
```

作业状态区分 `lastSuccessAt`（批次成功时间）、`processedThrough`（可靠消费来源的最大 sentAt）、`heartbeatAt`、failure、nextRunAt、cursor、activeBatchId 和 pendingMedia。游标按数据库/表保存 local_id，不按消息时间截断，因此后到的历史时间消息也不会丢失。120 秒租约阻止并发批次，runner 每 30 秒心跳并在写入前复核；重启后接管过期租约并继续同一批次/计划/请求号。

失败保留批次和指数退避（最高 5 分钟）。运营可发送 `{"action":"retry","jobId":"已有job.id"}` 提前下一次运行；不要手改游标、批次或 requestId。已成功的操作即使响应丢失，也从同一身份的持久化 operation 验证，避免重复旧后端写入。版本或业务冲突需先核对原事件，失败状态不会假称同步完成。

补采请求示例：

```json
{
  "action": "backfill",
  "jobId": "已有job.id",
  "requestId": "repair-images-20261023-01",
  "range": { "from": "2026-10-23T00:00:00+08:00", "to": "2026-10-24T00:00:00+08:00" }
}
```

相同补采 requestId 不能换范围；补采使用独立游标，不覆盖常规游标。已处理且无需补图的来源会跳过。待补图来源进入 **media-only** 路径：服务端只允许给该来源已经关联的 active 事件执行 `bubu_attach_images`，禁止换 eventKey 新建、修改事实或恢复撤销。多事件来源保留全部原关联 ID。无图时可零写完成并继续待补；原事件均撤销时零写结束补图，不复活已删除事实。

collector 凭证有效期沿用身份服务，runner 不自行扩大或延长权限。运营用同一 baby/group/agentId 重新签发，原子替换私有 token 文件；HTTP/MCP 每次请求都重读，当前批次可在续签后按同一身份恢复。禁用作业停止采集；停用 group binding 或吊销凭证会在服务端立即拒绝后续请求。配置、授权与模型调用严格分离。

## 合成验证

```sh
pnpm exec tsc --noEmit
pnpm exec eslint src/collector scripts/collector.ts scripts/collector-codex-agent.ts tests/collector-adapters.test.ts tests/collector.integration.test.ts
pnpm exec vitest run tests/collector-adapters.test.ts tests/collector.integration.test.ts
python3 tests/collector-source.py
```

Python 命令需要能导入现有 `wechat_cli` 与兼容 CPU 的 zstandard。开发机若安装包解释器架构不兼容，可用兼容 Python，并以 PYTHONPATH 指向既有 package 与**隔离临时目录**中的兼容依赖；不要改已安装包。本次验证使用 arm64 bundled Python、原 wechat_cli package、`/tmp/bubu-collector-python-deps` 中的 zstandard。

Python fixtures 在临时 SQLite 中构造双数据库、同 local_id、压缩消息、图片 XML、秒级时间/发送者、迟到旧时间、补采与损坏页；fixtureManifest 必须显式有 `fixture: true` 与匹配 accountId，绝不构造 AppContext 或读取真实 config/keys。TS fixtures 使用临时 Payload SQLite、合成旧后端、实际 HTTP Handler/Streamable HTTP MCP Client；验证真实附件上传→私有读取→MCP 关联、缺图补采、撤销后的新 key 重放拒绝、租约/重启/绑定撤销。Codex fixture 是合成可执行 CLI，核对实际参数、schema、stdin/输出、环境隔离、超时与非法结果；没有真实模型调用或真实微信群读取。
