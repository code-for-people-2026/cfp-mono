# 备份与恢复操作

对应 [ADR 0009](adr/0009-operations-and-backup-boundaries.md)。这些工具适用于完成境内私有原数据层切换、关闭全部旧写入入口后的单机部署。旧 0.1.0 的外部原数据库部署不符合前提；0.2.0 已完成私有原数据层切换与真实演练，见 [验收记录](validation/experience-020-2026-10-24.md)。

## 部署前配置

1. 复制 `deploy/operations.example.json` 到受保护的宿主机配置，权限 `0600`；显式填写经负责人确认的 `retentionDays`，与服务环境 `BUBU_PRIVACY_BACKUP_DAYS` 一致。示例为 `null`，不能被误作已确认政策。
2. 数据和备份目录为 `0700`。备份密钥为独立随机 32 字节文件 `0600`；媒体密钥、Payload secret、原数据库凭证另行保全，不在归档内。删除清单是独立 `0600` 文件，并单独 bind 到应用配置的 `BUBU_DELETION_LEDGER` 路径。禁止使用数据目录下的开发密钥或 `secret` 文件。
3. 应用、原数据层、PostgreSQL 容器分别设置 `cn.codeforpeople.bubu.role=service|core|database`，共享同一个私有回环网络；网络 owner 必须是持续运行的 PG 或独立网络容器，不能是待停的 app/core；拒绝 host 网络、公开 3321/5432 端口和非预期共享网络进程。原数据层端口 3321、PG 5432 不公开。原数据层使用 `BUBU_CORE_DATABASE_URL`，应用使用相同 `BUBU_CORE_SERVICE_TOKEN`；两个服务都必须定义真实健康检查。PG 角色有读取全部业务表的权限，凭证仅从容器环境读取，经 stdin 传到备份子进程，不输出或放进命令参数。
4. 脚本目录为只允许运维修改的固定版本路径，至少包含 `backup-operations.py`、`backup-snapshot.mjs`、`backup-codec.mjs`。`nodeImage` 固定为本机已校验 Node 24 镜像的 `sha256:…` ID，不运行未固定 tag 或自动拉取镜像。
5. `reportDirectory` 不含敏感数据；状态文件是时间、状态的 `0644` JSON。将**整个目录**只读挂载给应用，设置 `BUBU_OPERATIONS_REPORT` 为其中 `status.json` 的绝对路径；不能仅挂文件，否则原子替换后容器仍会读取旧 inode。管理员后台每分钟刷新；普通运营不能查看全局状态。

先运行只读配置检查，再进行一次人工备份与隔离恢复演练：

```sh
python3 scripts/backup-operations.py check --config /absolute/private/operations.json
python3 scripts/backup-operations.py backup --config /absolute/private/operations.json --apply
python3 scripts/backup-operations.py unpack --config /absolute/private/operations.json --archive /absolute/private/backups/bubu-TIMESTAMP-ID.enc --target /absolute/private/new-quarantine --apply
```

备份会短暂停止两个 Bubu 服务，原 PostgreSQL 继续运行。停止响应丢失时按已记录的容器 ID 核对并恢复，不查找或重启其他项目。PG dump、SQLite 完整性检查、照片密文和 SHA-256 清单验证全部通过后才留下归档；最后还需原服务健康。容量不足、密钥权限不对、残留运行锁、非预期文件、共享数据目录的其他容器或私有网络不匹配均失败关闭。

中间明文仅存在于 `0700` 临时目录，正常结束/异常会删除。进程被强杀时，下一次持锁操作先停止明确标记且挂载本备份目录的遗留工具容器，再清理临时目录；管理员应立即处理遗留 `running` 状态。此行为不是文件系统级安全擦除保证。保留清理只匹配本工具生成的归档，拒绝链接，不接触其他文件；到期清理在备份前执行，也由独立小时任务执行；预留两小时调度与维护重试余量，避免依赖新备份成功。锁冲突由清理服务每分钟自动重试，状态和日志保留失败；持锁清理失败写入后台备份异常。清理成功不会伪造新的备份成功时间。备份失败可能使可用副本变少，不能擅自延长已承诺期限。

## 恢复验收

`unpack` 只生成隔离目录中的 `snapshot/database.pg`、`snapshot/sidecar` 和清单。它会认证完整密文、拒绝归档穿越/链接/重复项/额外条目、复验 SQLite 和每个文件散列，且绝不覆盖已存在目录。`RESTORE-BLOCKED.txt` 明确标识尚不可上线。

接下来必须保持网络隔离，执行以下步骤：

- 把 PG dump 恢复到**新的隔离数据库**，核对表、约束、业务行与原导出，使用与快照匹配的 schema 版本，禁止启动时自动推 schema。
- 从独立保全渠道取得**最新**完整删除清单、原媒体密钥与 Payload secret。禁止从旧快照补回旧清单或生成空清单冒充最新版本。
- 仅连接隔离原数据层，执行 `scripts/privacy-maintenance.ts restore-check --apply`；任何删除未完成都不得开放访问。原账号注销和家庭硬删除必须同时覆盖原数据层与 sidecar。
- 校验全部照片解密、数据库引用、家庭权限及用户操作，再进行有记录的切换。当前工具不提供自动推广或“回滚覆盖线上新写入”的能力。
- 备份、密钥与最新清单需要独立异地保管和取回演练；本机加密备份不能替代灾难恢复。

## 定时器与异常

确认配置与恢复演练后才安装 `deploy/bubu-backup.{service,timer}`（每天当地服务器时间 03:30）、`bubu-backup-retention.{service,timer}`（每小时）和 `bubu-certificate.{service,timer}`（每小时）。证书检查验证公网证书链和域名，**不会签发或续期证书**。默认不会启用任何 unit。

后台显示：备份超过 30 小时、隐私维护超过三个周期、任务重试/延迟、磁盘低于 10% 或 1 GiB、证书不足 20 天；更紧急的失败/低于 5% 或 256 MiB/证书不足 7 天显示异常。这些是工程阈值，不是保留政策或医疗阈值。公网 `/health` 仍只表示进程初始化成功。用户已确认沿用 Hello Agent 的告警方式：异常在管理员后台和宿主机日志呈现，没有配置外部邮件或群通知。0.2.0 服务器的 Certbot 自动续期及续期演练已通过；本脚本的证书检查仍只负责检查，不负责签发。

## 验证边界

`pnpm test` 覆盖真实 SQLite WAL 合并、照片清单、密文破坏和权限边界；`python3 tests/backup_operations_test.py` 覆盖危险归档拒绝、目录不覆盖、保留范围和失败恢复容器顺序。Python 测试中的 Docker 是隔离替身，不等于真实宿主机演练。

## 0.2.0 运行入口

当前发行目录 `/opt/cfp-bubu-log/launch-20261024-02`；有效路径也记录在 `/opt/cfp-bubu-log/ACTIVE-RELEASE`。`bubu-runtime.service` 按 PG → core → app 校验并启动已固定镜像的容器，停止顺序相反。不要启动 `compose.retired-010.yml` 或重新连接已退役原库。

每日备份按北京时间 03:30 执行，状态见发行目录的 `operations-status/status.json`。管理员应查看 `bubu-backup.service`、`bubu-certificate.service`、`bubu-source-retirement.service`、`bubu-backup-retention.service` 的日志。源库清理为这次迁移的单次任务，检查固定归档、行摘要、到期时间与新服务健康，不能复制给别的数据库使用。

备份只读捕获工具增加 `DAC_READ_SEARCH`，使其能读取应用 UID 的私有文件；源目录保持只读、无网络，其他备份子进程不增加该能力。8 项离线检查和真实应用目录备份/恢复均已验证。
