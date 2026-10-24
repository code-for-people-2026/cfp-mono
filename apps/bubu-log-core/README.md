# 卜卜日记原数据服务

这是原 `sunmer-home/apps/bubu-log` 的私有 Payload 数据层，用于境内迁移，不能单独公开部署。

- 保留 Payload 3.77.0、原七个 Collection 的业务字段、校验和写入 hook；不重建照护表、不推送 schema、不重算已有统计。
- 只保留原账号的用户名/邮箱 + bcrypt 凭证核验。NextAuth 会话缩短为 5 分钟，仅用于证明旧账号归属。
- 只绑定 `127.0.0.1:3321`；每个 API 同时需要独立核心令牌。数据 API 仍要求专用 CMS 账号；无公开后台、首位管理员注册、OAuth 或新用户注册入口。
- 写入默认关闭。只有快照验证通过、旧网页/CMS/webhook 写入全部停止后才能启用。
- 家庭生命周期在原 PostgreSQL 单个事务里执行。先删有原文和快照的 AuditLog，再删关系/统计/活动/宝宝；保留照护者原账号和其他家庭。
- 废弃 BabyProfile 没有家庭关系，必须以历史证据确认归属后配置 `BUBU_CORE_LEGACY_PROFILE_OWNERS`（JSON：旧 profile ID → Baby ID）。不根据名字或照片猜测；有未解决的旧行时家庭导出/删除明确失败。
- 数据库迁移仅包含卜卜日记表；同库的 `template_records` 属于其他上下文，不能迁入或删除。

参考 ADR 0007。该目录出现不代表已完成数据库切换、历史公开图片撤销或上线审核。
