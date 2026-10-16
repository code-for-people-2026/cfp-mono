# 万相文生图接入

DeepSeek → `generate_image` → 百炼万相 → 文件验证与图片审核 → 私有 OSS → `save_greeting` 图片作品 → 本人鉴权展示、下载。

## 行为

- 模型 `wan2.6-t2i`，北京地域，一轮一张，方图 1280×1280、竖图 1104×1472、横图 1472×1104。只发送必要画面描述，不自动发送完整历史或上传原图。不支持原图编辑。
- 保留供应商水印和有效来源元数据，追加可见“AI 生成”；去除 EXIF，转 JPEG，最长边 2048，现有 2 MiB 存储上限。
- 图片存入当前部署的 `HELLO_MEDIA_STORAGE`。ECS 已配置 OSS；本地测试可用数据库。客户端沿用 `/api/hello/media/:id`、`/api/hello/artifact-image/:turnId/:artifactId`，需本人凭证。链接不是公共分享地址。
- 先保存 `submitting`，收到回执后保存 `pending` 和任务编号，下载/审核/保存完成后记 `stored`。网络、存储或审核服务暂不可用时，可在对话中“继续取图”，复用编号并重新审核；已完成轮次幂等返回。未知提交回执禁止自动重提，供应商任务过期、审核拒绝或风险待人工判断时不能恢复。
- 原服务端会话锁覆盖执行，避免同会话并行提交。正常执行上限 180 秒，SSE 每 15 秒保活，客户端等待上限 240 秒。没有后台任务队列，服务进程中断后须重新打开记录继续取图。
- 生成图片纳入隔离、数据导出与删除。配置供应商后隐私政策版本会变化，须按现有流程重新同意。

## 部署配置

1. 为北京百炼配置专用 `DASHSCOPE_API_KEY`。可用 `HELLO_IMAGE_WORKSPACE_ID` 选择新业务空间专属域名；留空使用默认北京接口。限定密钥仅访问 `wan2.6-t2i`，不使用 OSS AccessKey 代替百炼密钥。DeepSeek 的 BYOK 仅用于对话，图片由平台百炼账户承担费用。
2. 图片审核二选一：现有 HTTPS 代理及其接收方告知；或 `HELLO_IMAGE_REVIEW_MODE=aliyun-green`，配置独立的 `HELLO_GREEN_ACCESS_KEY_ID`、`HELLO_GREEN_ACCESS_KEY_SECRET`。后者使用上海内容安全增强版 `baselineCheck`，RAM 运行权限是 `yundun-greenweb:DescribeUploadToken`、`yundun-greenweb:ImageModeration`（Resource 为 `*`）。注意 SDK / CLI 产品名是 Green，RAM 权限前缀是 `yundun-greenweb`，不能写成 `green:`。只上传到服务返回的临时桶，不需要将本应用 OSS 公开或授予其全桶访问。`none` 放行，`high` 拒绝，`low` / `medium` 待复核，异常不放行。
3. 复用现有私有 OSS 配置。备份 SQLite 后通过现有 `db:init` / 部署启动迁移，新增 `greetings.image_generation`、`media.generation`、`media.generation_key` 及唯一索引，不修改旧图片。
4. 配置好云服务后，在隔离预览实例实测一张无敏感信息的图片、鉴权下载、刷新/恢复、OSS 对象以及删除。验证通过再发布。配置值不得写入代码、提交、命令日志或 Issue。

## 2026-10-14 云端检查

- 管理员已补充百炼管理权限。成功列出北京默认业务空间，并创建本应用专用密钥；列表回读确认 `Custom`、`allowAllModels=false`、仅可访问 `wan2.6-t2i`。密钥只保存在本机被忽略的私密目录，未写入仓库或日志。
- 管理员已授权并开通内容安全增强版；真实 `DescribeUploadToken`、临时桶上传及 `ImageModeration` 均成功，测试图结果为 `none`。注意历史记录中的 `green:` 权限前缀是错误信息，正确前缀见上文及官方权限文档。
- 真实万相提交一张窗台番茄水彩图成功。联调修复了两个供应商格式差异：结果实际使用精确加速桶 `dashscope-a717.oss-accelerate.aliyuncs.com`；PNG 的 AIGC 字段为两层 JSON 编码的平铺对象。现在能下载并保留全部来源字段及原始签名，不扩大到任意 OSS 域名。
- 修复 Green SDK 在 Node ESM 下的 CommonJS 默认导出兼容。真实审核出现过临时失败，现支持保留原任务后再次审核，明确风险仍阻断；不通过移除审核完成验证。
- 2026-10-14 15:58（北京时间），隔离数据库中的真实 `deepseek-flash` 工具编排恢复原万相任务、真实 Green 审核、现有私有 OSS 写入及回读全部通过。最终 JPEG 为 235,933 字节；本人图片路由 200、其他身份 404、匿名 401、OSS 匿名 403；导出和实际 OSS 删除通过。测试身份与其 OSS 前缀已清理。年龄资料仅为隔离测试身份，未修改部署库。
- 线上仍是 `preview-20261013-name052`，另有 `preview-20261014-login053` 登录预览。当前工作区与它们的代码不同，未覆盖线上或修改其环境。发布前须确定集成分支、配置独立运行时审核身份并再次验收。上述单张测试不等于全面模型质量或内容安全评测。

## 验证入口

`pnpm --filter @cfp/hello-agent test:images` 使用真实 Payload、ADK、图片编码及迁移，以明确标注的合成供应商和对象存储覆盖工具调用、单次提交、下载/存储中断恢复、未知回执、审核拒绝、跨用户鉴权、导出与删除。`test` 覆盖万相 HTTP 契约、URL 白名单、体积限制、标识及 Green 风险映射；`test:operations` 覆盖现有处置流程。合成测试不能作为云服务已开通或真实模型评测证据。

参考：[万相 2.6 API](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)、[图片审核增强版](https://help.aliyun.com/zh/document_detail/467829.html)、[上传令牌权限](https://help.aliyun.com/zh/document_detail/2926827.html)、[图片审核权限](https://help.aliyun.com/zh/document_detail/2528742.html)、[调研记录](image-generation-research.md)。
