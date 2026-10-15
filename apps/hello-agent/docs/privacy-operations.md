# 隐私运营配置与验收（2026-10-14）

用户确认：隐私渠道 `ajoker@codeforpeople.cn`，在线身份记录 30 天，数据库备份 7 天，权利请求 7 天内答复。本任务只配置隐私运营，不修改年龄核验，不修改另一任务的登录预览。邮箱域名有邮件路由；尚未发送测试邮件，实际日常收件、身份归属核实和答复由运营人员负责。

## 已应用范围

- ECS 深圳实例上的 `cfp-hello-agent-image-preview`，回环端口 3313。没有新增公网入口。
- 私密环境文件 `/opt/cfp-hello-agent/private/privacy20261014.env`：上述邮箱及 30/7/7，数据库/OSS 深圳、万相北京、图审上海；独立删除清单 `/privacy-ledger/deletions.ndjson`。配置不含年龄服务设置。
- 验收实例的 `HELLO_PRIVACY_OPERATIONS_APPROVED=true` 用于本轮独立验收。公开服务未切换到本实例；该标志不能当成公司对所有供应商协议、影响评估、备案或其他上线事项的完成证明，也不能未经对应验收复制到另一部署。
- 应用配置及 9 个 Agent 配置保留。验收库原本复制自主服务，与其共用旧图片引用；启用清理前已经将复制的个人记录从验收库清空并 VACUUM，没有调用旧图片的 OSS 删除。原主服务数据库及图片不受影响。清空前快照归入旧发布备份目录，同样执行 7 天期限；它不属于验收实例的可自动恢复备份。
- 独立清单持久目录 `/opt/cfp-hello-agent/privacy-ops/image/ledger`，目录 0700、文件 0600，挂载到 `/privacy-ledger`，不包含在数据库备份中。数据库还原绝不覆盖它。当前数据库备份与清单在同一台 ECS，提供应用回退能力，不提供跨机器灾难恢复。

## 作业与失败处理

`cfp-hello-privacy-image.timer` 每小时第 17 分钟启动一次，错过的任务在机器恢复后补跑。服务脚本是 `scripts/privacy-operations.py`，配置模板在 `deploy/privacy/`。

每次执行：

1. 获取独占锁，验证目标容器、数据库及独立清单挂载，创建脱敏状态记录。
2. 清理指定目录超过期限的 SQLite 备份。预留一个调度间隔，正常运行时不超过 7 天；处理有 SQLite 文件头的 `.db/.sqlite/.sqlite3`、gzip 数据库和含真实 SQLite 文件的发布 tar.gz/tgz；不解压到磁盘，不跟随符号链接，不处理有 WAL/SHM/journal 的可疑活动文件。普通压缩日志和纯源码包保留。当前两个目录为独立验收备份目录与既有 `/opt/cfp-hello-agent/backups`。
3. 停止本实例接入，最多等 120 秒结束进行中的请求；使用同一镜像创建经过完整性和外键检查的 SQLite 快照，包含已提交的 WAL 页，不覆盖已有备份。
4. 清理撤回、待删、过期身份；旧版没有隐私档案的会话、图片等按所有关联记录中最近活动判断 30 天到期，有近期活动或隐私档案的身份不被旧记录误删。只读取归属与时间信息，不把正文带入维护日志。
5. 在备份已处置的前提下，清理超过 8 天且删除已完成、无关联记录的最小删除防护记录。额外一天用于调度和完成时序余量；未完成删除、有近期请求或无合法时间的旧清单项保留。清单分块解析、摘要去重，原子替换并同步磁盘。
6. 启动本实例并检查健康状态。失败不恢复接入，记录阶段但不输出用户内容或密钥，后续定时运行可重试。

这是单进程预览部署的离线维护方式，每次正常执行约十余秒暂停。正式切换或多实例部署前须选择对应维护窗口，或实现跨进程协调；不能直接同时运行维护 CLI 和业务写入。

状态查看：

```sh
systemctl status cfp-hello-privacy-image.timer
systemctl status cfp-hello-privacy-image.service
cat /opt/cfp-hello-agent/privacy-ops/image/state/status.json
journalctl -u cfp-hello-privacy-image.service --since today
```

状态只包含时间、执行阶段、备份名和清理数量。当前没有向邮件或外部平台发送故障通知；失败通过服务状态、日志与本实例不可用状态呈现。不得把本地失败记录表述为已配置外部告警。定时器长时间未运行时，应排查并立即补跑；不能仅凭历史成功状态认定期限仍在执行。

## 恢复入口

只允许选取本实例管理目录中仍在期限内的备份：

```sh
python3 /opt/cfp-hello-agent/privacy-ops/source/privacy-operations.py \
  /opt/cfp-hello-agent/privacy-ops/image/config.json \
  --restore /opt/cfp-hello-agent/privacy-ops/image/backups/实际备份名.db
```

恢复始终先停流量并保留当前快照，再恢复数据库，重放独立删除清单、删除到期内容、验证后才启动。恢复待处理标记在覆盖数据库前持久化；即使失败，下次普通定时重试也必须重放清单。清单丢失、损坏或对象删除失败均不绕过检查。不要直接替换运行中的数据库，不要从旧磁盘快照同时还原数据库与删除清单。

若发生磁盘损坏而独立清单不可用，当前方案不能保证旧备份不会恢复已删内容，应保持关闭。增加异地数据库备份或 OSS 版本后，必须同步扩展清单持久性及保留审计；现有 8 天防护记录清理不能直接沿用到更长或未登记的备份。

## 实际证据

2026-10-14 首轮作业成功，清理 6 份过期数据库备份。ECS 无托管磁盘快照、无自动快照策略；OSS 未开启对象历史版本或访问日志，无存储生命周期规则。后台数据库、私有 OSS 与供应商处理地点已按实际部署写入告知。

- 真实 OSS 合成身份：创建两组记录和图片 → SQLite 快照 → 删除其中一组 → 恢复旧快照 → 重放独立清单。已删身份的会话、图片引用及凭证没有复现，另一身份的记录和图片可正常读取，测试对象最后全部清理。
- 本地实测 SQLite WAL 快照/还原、拒绝覆盖备份、压缩数据库/发布归档到期清理、成熟删除防护记录清理、保留未完成/仍被引用/近期/无日期记录、损坏清单拒绝。
- 故障注入验证：恢复中清理失败不启动容器，临时环境文件删除，定时重试仍携带恢复清单要求。
- 166 个隐私单元用例通过；类型检查通过。新增 CLI 检查：`python3 scripts/privacy-operations-check.py`、`node scripts/privacy-snapshot-check.mjs`、`pnpm exec tsx scripts/privacy-restore-check.ts`。
- `/api/hello/legal` 返回邮箱与 30/7/7，独立实例隐私就绪；主服务、登录预览、独立生图实例均健康。匿名图片/历史读取仍需鉴权。

公开入口整合仍是单独发布步骤。共享反向代理日志、外部供应商副本、用户自行导出的文件不属于这次数据库清理。未把“删除聊天”表述为立即擦除所有日志、物理介质或供应商副本。万相/DeepSeek 的公开数据处理说明分别见 [阿里云隐私说明](https://help.aliyun.com/zh/model-studio/privacy-notice) 与 [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)，不将公开说明替代公司自己的协议及运营责任。
