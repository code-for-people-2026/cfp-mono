# Project name: a-j-oker

2026-10-31：项目目录、包名、导入、锁文件、构建/发布脚本、CI 和当前开发文档完成命名整理。小程序对外名称仍为「赢麻的阿 J 先生」。

- 服务端：`apps/a-j-oker` / `@cfp/a-j-oker`
- 客户端：`apps/a-j-oker-miniapp` / `@cfp/a-j-oker-miniapp`
- 业务契约：`packages/a-j-oker-contracts` / `@cfp/a-j-oker-contracts`
- 基础回复与展示协议：`packages/base-chat-protocol` / `@cfp/base-chat-protocol`

2026-11-01：业务接口保留 `a-j-oker-contracts`，回复与展示协议改为 `base-chat-protocol`。年龄核验全部归入业务接口；协议包同时包含 AG-UI 与 A2UI。

## 兼容标识
以下是已持久化数据或已发布客户端的契约，不是当前项目名称，本次不做数据迁移：

- OSS 的 `hello-agent/` 对象前缀及归属/删除校验。
- ADK 的 `hello_agent` 会话应用名与相关证据键。
- A2UI 的 `urn:cfp:hello-agent:catalog:1` 及个人数据导出格式 `hello-agent-personal-data-v1`。
- `/api/hello`、已有环境变量 `HELLO_*` 及数据文件名。
- 既有服务器 `/opt/cfp-hello-agent` 持久目录、Compose 项目名、镜像/容器标识和历史发布证据。

这些字段改动需要独立兼容迁移；全局替换会让旧图片、会话或线上挂载失效。新源码部署须使用当前目录构建镜像。旧 onboarding overlay 基础镜像若只包含旧目录和依赖，应先重建兼容基础镜像，不可直接混用。

本次仅修改本地工作树，未部署、未迁移线上数据；申报材料原始文件、供应商合同和评阅证据目录不因代码改名而改写。
