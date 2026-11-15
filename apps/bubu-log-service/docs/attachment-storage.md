# 私有附件 OSS 存储与离线迁移

卜卜日记的附件元数据保存在身份 sidecar SQLite；照片字节在开发/测试可继续使用本地私有文件，在生产必须写入私有 OSS。服务不会生成或返回 OSS 公共 URL，下载仍通过宝宝授权的 `/api/app/attachments/:id` 代理。OSS 客户端不使用服务器磁盘缓存。

## 配置与上线顺序

生产必须先完成 OSS 后端部署，再启动带附件写入的服务或执行迁移：

- `NODE_ENV=production`
- `BUBU_MEDIA_STORAGE=oss`
- `BUBU_OSS_BUCKET`、`BUBU_OSS_REGION`、`BUBU_OSS_ACCESS_KEY_ID`、`BUBU_OSS_ACCESS_KEY_SECRET`
- 可选 `BUBU_OSS_INTERNAL=true`。部署上优先使用可用的内网 OSS endpoint；若必须通过公网 endpoint 访问，客户端会继续强制 TLS，但应确认网络出口与防火墙策略受控。
- 可选 `BUBU_OSS_SECURITY_TOKEN` 与受控的 `BUBU_OSS_PREFIX`

配置不完整时服务启动失败；不会自动改用服务器磁盘。开发/测试的显式本地模式继续使用 `private-attachments`，供现有测试和本机运行使用。数据库中的附件记录只保存私有 `storage.kind` 与相对对象键；API 输出不包含 bucket、完整对象键或公共 URL。

## 离线迁移

本文的离线迁移工具只适用于当前主服务在 `private-attachments` 中保存的明文对象布局。生产“实际体验”媒体目前是 AES-GCM 编码，不能假定本工具不做改造即可迁移；该体验需要单独的迁移端口，尚未提供。

迁移前必须：

1. 停止卜卜日记服务和采集器，确认没有定时器或 live writer。
2. 按运维流程备份 sidecar SQLite 与完整 `private-attachments` 目录。
3. 部署并验证生产 OSS 配置；迁移命令没有 OSS 配置时拒绝运行。

默认命令是只读 dry run：

```bash
cd apps/bubu-log-service
BUBU_IDENTITY_DIRECTORY=/absolute/private/path \
BUBU_PAYLOAD_SECRET=/absolute/private/secret \
pnpm exec tsx scripts/migrate-attachment-storage.ts
```

Dry run 统计并校验本地文件和已有 OSS 元数据，但不 PUT、不更新数据库、不删除文件；本地缺失只在本阶段作为 `absentLocal` 报告。`--apply` 会读取已校验的本地字节，写入确定性 OSS 键，重新 GET 校验长度与 SHA-256，并在同一 sidecar 事务中确认元数据未变化后提交；附件 ID、请求指纹、来源和事件引用保持不变。任一 legacy 记录缺少本地文件时，`--apply` 立即失败并回滚本次元数据事务，不会伪造“迁移完成”。

执行后再次 dry run/apply 验证远端可读且计数不再增加。确认备份和远端验证后，才可显式清理：

```bash
pnpm exec tsx scripts/migrate-attachment-storage.ts --apply --remove-local
```

`--remove-local` 必须与 `--apply` 同用（直接调用迁移函数时同样强制）。清理只会发生在元数据事务提交之后；相同对象路径的所有附件引用都已迁移并远端验证后，才按路径去重清理一次。每次删除前会重新验证远端对象与本地文件，unlink 后同步父目录；任何失败都保留本地副本。迁移不会删除无关孤儿文件。命令只输出计数；错误不会回显对象键、路径、照片内容或凭证。

## 备份与保留

迁移完成后，服务器磁盘只保留照护元数据；备份必须同时覆盖 sidecar SQLite 和 OSS 对象版本/删除保护策略。现有备份清单尚未描述 OSS 对象生命周期，后续需要加入对象清单、版本保留和恢复演练。迁移阶段不要依赖“删除本地文件”作为对象清理或保留策略。
