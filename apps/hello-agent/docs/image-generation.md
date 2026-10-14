# 万相文生图接入

DeepSeek → `generate_image` → 百炼万相 → 文件验证与图片审核 → 私有 OSS → `save_greeting` 图片作品 → 本人鉴权展示、下载。

## 行为

- 模型 `wan2.6-t2i`，北京地域，一轮一张，方图 1280×1280、竖图 1104×1472、横图 1472×1104。只发送必要画面描述，不自动发送完整历史或上传原图。不支持原图编辑。
- 保留供应商水印和有效来源元数据，追加可见“AI 生成”；去除 EXIF，转 JPEG，最长边 2048，现有 2 MiB 存储上限。
- 图片存入当前部署的 `HELLO_MEDIA_STORAGE`。ECS 已配置 OSS；本地测试可用数据库。客户端沿用 `/api/hello/media/:id`、`/api/hello/artifact-image/:turnId/:artifactId`，需本人凭证。链接不是公共分享地址。
- 先保存 `submitting`，收到回执后保存 `pending` 和任务编号，下载/审核/保存完成后记 `stored`。网络、存储或审核服务暂不可用时，可在对话中“继续取图”，复用编号并重新审核；已完成轮次幂等返回。未知提交回执禁止自动重提，供应商任务过期、审核拒绝或风险待人工判断时不能恢复。
- 原服务端会话锁覆盖执行，避免同会话并行提交。正常执行上限 180 秒，SSE 每 15 秒保活，客户端等待上限 240 秒。没有后台任务队列，服务进程中断后须重新打开记录继续取图。
- 生成图片纳入数据导出与删除，内容安全运营后台另由 #383 接入。配置供应商后隐私政策版本会变化，须按现有流程重新同意。

## 部署配置

1. 为北京百炼配置专用 `DASHSCOPE_API_KEY`。可用 `HELLO_IMAGE_WORKSPACE_ID` 选择新业务空间专属域名；留空使用默认北京接口。限定密钥仅访问 `wan2.6-t2i`，不使用 OSS AccessKey 代替百炼密钥。DeepSeek 的 BYOK 仅用于对话，图片由平台百炼账户承担费用。
2. 图片审核使用 `HELLO_IMAGE_REVIEW_MODE=aliyun-green`，配置独立的 `HELLO_GREEN_ACCESS_KEY_ID`、`HELLO_GREEN_ACCESS_KEY_SECRET`。后者使用上海内容安全增强版 `baselineCheck`，RAM 运行权限是 `yundun-greenweb:DescribeUploadToken`、`yundun-greenweb:ImageModeration`（Resource 为 `*`）。注意 SDK / CLI 产品名是 Green，RAM 权限前缀是 `yundun-greenweb`，不能写成 `green:`。只上传到服务返回的临时桶，不需要将本应用 OSS 公开或授予其全桶访问。`none` 放行，`high` 拒绝，`low` / `medium` 不发布，异常不放行。
3. 复用现有私有 OSS 配置。备份 SQLite 后通过正式部署启动迁移（不要对现有部署库运行本地 db:init），新增 `greetings.image_generation`、`media.generation`、`media.generation_key` 及唯一索引，不修改旧图片。
4. 配置好云服务后，在隔离预览实例实测一张无敏感信息的图片、鉴权下载、刷新/恢复、OSS 对象以及删除。验证通过再发布。配置值不得写入代码、提交、命令日志或 Issue。

小型 ECS 使用 `Dockerfile.preview` 时，将 `typecheck` 与 Next webpack 构建分成独立步骤，避免两个编译进程同时占用内存。`HELLO_BUILD_TYPES_VERIFIED=true` 仅在前一步类型检查成功后设置；普通构建仍执行 Next 内置类型检查。不要以这个构建参数跳过独立检查。长期叠加的预览镜像若达到 Docker 层数上限，可导出已编译镜像的文件系统并重新导入为独立镜像，再恢复运行用户、工作目录和启动命令；保留旧服务及其镜像以便核对。

## 2026-10-14 云端检查

- 管理员已补充百炼管理权限。成功列出北京默认业务空间，并创建本应用专用密钥；列表回读确认 `Custom`、`allowAllModels=false`、仅可访问 `wan2.6-t2i`。密钥只保存在本机被忽略的私密目录，未写入仓库或日志。
- 管理员已授权并开通内容安全增强版；真实 `DescribeUploadToken`、临时桶上传及 `ImageModeration` 均成功，测试图结果为 `none`。注意历史记录中的 `green:` 权限前缀是错误信息，正确前缀见上文及官方权限文档。
- 真实万相提交一张窗台番茄水彩图成功。联调修复了两个供应商格式差异：结果实际使用精确加速桶 `dashscope-a717.oss-accelerate.aliyuncs.com`；PNG 的 AIGC 字段为两层 JSON 编码的平铺对象。现在能下载并保留全部来源字段及原始签名，不扩大到任意 OSS 域名。
- 修复 Green SDK 在 Node ESM 下的 CommonJS 默认导出兼容。真实审核出现过临时失败，现支持保留原任务后再次审核，明确风险仍阻断；不通过移除审核完成验证。
- 2026-10-14 15:58（北京时间），隔离数据库中的真实 `deepseek-flash` 工具编排恢复原万相任务、真实 Green 审核、现有私有 OSS 写入及回读全部通过。最终 JPEG 为 235,933 字节；本人图片路由 200、其他身份 404、匿名 401、OSS 匿名 403；导出和实际 OSS 删除通过。测试身份与其 OSS 前缀已清理。年龄资料仅为隔离测试身份，未修改部署库。
- 已移植到 `codex/hello-image-generation`：保留新版主 Agent 与八个专家、会话导航、微信登录/年龄核验、隐私设置，并合并隐私分支的独立删除清单重放修正。2026-10-14 16:36 新版同样通过实际 DeepSeek、万相任务恢复、Green、OSS、鉴权、导出与删除验证。
- 图片额度使用现有原子计数账本的独立 `image:YYYY-MM-DD` 项；`HELLO_IMAGE_DAILY_LIMIT` 默认 30，每次提交前预留一张，失败不退还，恢复不重复预留。DeepSeek BYOK 不会绕过平台图片额度。
- 发布目标是隔离验收实例。原 `name052` 与 `login053` 入口保留，后者仍只开放真实登录和生日窗口。新实例的年龄与隐私门禁保留；年龄供应商和隐私运营配置未齐全时，不开放普通聊天。
- 2026-10-14 17:13（北京时间），已部署 `preview-20261014-image054p1` 到 ECS 的独立容器 `cfp-hello-agent-image-preview`，仅绑定 `127.0.0.1:3313`。从一致性备份迁移数据库副本后，逐列比较原有会话、轮次、媒体、9 条 Agent 配置及执行快照，数量和内容未变，完整性与外键检查通过。`name052`、`login053` 的就绪检查均为 200。新实例 `/api/hello/config` 确认生图和审核已配置；匿名图片与会话请求均为 401；法律告知包含万相和内容安全接收方；公开聊天就绪检查仍按未完成的运营条件返回 503。
- 上述 ECS 容器内的真实新任务验收通过：`deepseek-flash` 调用 `wan2.6-t2i` 生成 269,435 字节 JPEG，Green 返回 `allow`，私有 OSS 写入与回读一致；本人读取 200、他人 404、匿名 401、OSS 匿名 403，导出和实际对象删除成功。隔离测试身份及 OSS 前缀已清理。这是服务器业务链路验收，不表示已开放手机端普通聊天或完成微信发布。
- 本次完整检查：后端 319 项单元测试、客户端 160 项单元测试、全部后端集成检查、生图/迁移/恢复专项、年龄与登录预览专项、类型检查、lint、微信和 H5 构建、Next 生产构建均通过。ECS 另独立完成类型检查；webpack 运行时要求 `libsql` 可从应用目录解析，因此显式声明已锁定的同版本 `libsql@0.4.7`，实际 HTTP 接口验收通过。

## 验证入口

`pnpm --filter @cfp/hello-agent test:images` 使用真实 Payload、ADK、图片编码及迁移，以明确标注的合成供应商和对象存储覆盖工具调用、单次提交、下载/存储中断恢复、未知回执、审核拒绝、跨用户鉴权、导出与删除。`test` 覆盖万相 HTTP 契约、URL 白名单、体积限制、标识及 Green 风险映射。合成测试不能作为云服务已开通或真实模型评测证据。

`HELLO_IMAGE_LIVE_CHECK=true node --import tsx scripts/image-provider-smoke.ts` 明确提交一张付费新图，使用独立临时数据库和合成身份，调用实际 DeepSeek、万相、Green、OSS，验证读取权限、导出和对象删除。它通过源码调用业务入口，不等于手机端 UI 或公开聊天已验收。脚本在临时数据库中准备年龄与授权夹具，不向运行中的业务数据库写入测试身份。可用 `HELLO_IMAGE_CHECK_DIRECTORY` 指向运行用户可写的临时目录；若清理失败，保留目录供重试。

参考：[万相 2.6 API](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)、[图片审核增强版](https://help.aliyun.com/zh/document_detail/467829.html)、[上传令牌权限](https://help.aliyun.com/zh/document_detail/2926827.html)、[图片审核权限](https://help.aliyun.com/zh/document_detail/2528742.html)、[调研记录](image-generation-research.md)。
