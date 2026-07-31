# 社区做饭 Weekly Menu 交接说明

> 本文替代此前“客户端直连 Payload”的历史交接路径。架构事实以 [Weekly Menu 迁移决策](../../docs/weekly-menu/MIGRATION.md) 为准。

## 已有资产

| 资产 | 当前状态 | 所有者 |
| --- | --- | --- |
| Weekly Menu 契约与规则 | 小程序消费 `@cfp/weekly-menu-shared`；其内部复用已测试的 `@cfp/menu-core` | `packages/weekly-menu-shared` |
| 菜谱内容 | Payload `recipes` 已存在 | 官网私有 `apps/website` |
| Taro app | Mock 登录、首页、菜单、历史详情和菜品勾选清单已实现 | `apps/community-cooking` |
| 客户端数据源 | `WeeklyMenuClient` 下的默认 Mock 与可选真实 API adapter | `apps/community-cooking` |

网页 React/Next 页面不能直接迁到 Taro；只复用产品流程、TypeScript 契约和纯函数。

## 最终请求链路

```text
apps/community-cooking
  -> HTTPS /api/v1/weekly-menu/*
  -> apps/weekly-menu-be
  -> GET website /api/recipes（服务端匿名只读）
```

- 小程序没有 raw Payload URL helper，绝不调用 Payload REST/GraphQL。
- Weekly Menu API 只返回客户端 Happy Path 所需的最小 DTO，不透传 Payload collection、分页或管理模型。
- `/admin`、website 数据库、migration/seed、写接口和权限全部保持官网私有。
- 不新增 CMS internal route/token；未来写 CMS 必须另开 Issue 并重新授权。

## 实现顺序

1. #313 定义 `@cfp/weekly-menu-shared` DTO、验证、错误码与纯规则。
2. #314～#316 实现专用数据库、微信会话和版本化 Weekly Menu API。
3. #317 的页面与 Mock adapter 可在 #313 后提前开发，但生产验收不能在 #318 前完成。
4. #318 先交付 Weekly Menu API 的公网 HTTPS、readiness 与 smoke。
5. #317 再完成真实 adapter、合法 request 域名、体验版与真机 Happy Path。

Mock adapter 只调用 `@cfp/weekly-menu-shared`；真实 adapter 只调用 Weekly Menu API。页面不直接导入 `@cfp/menu-core`。`TARO_APP_WEEKLY_MENU_API_BASE_URL` 非空时启用真实 adapter，缺失时保持默认 Mock；该公开构建变量只能是无凭据 HTTPS API 根地址。

真实 adapter 使用 `wx.login` 的一次性 code 换取 Weekly Menu token，code 不持久化；token 只保存在客户端会话缓存并随 Bearer 请求发送。固定短超时、严格共享 DTO 校验和脱敏错误负责隔离网络与服务端细节；任一 `401` 会清除 token，页面提示重新登录并返回首页。客户端不接收或记录 openid、session_key、AppSecret 或上游错误正文。

当前 Mock Happy Path 包含：本地 Mock 登录、生成 7 天 × 2 餐、换菜、保存草稿、确认、历史详情、从 confirmed 复制新草稿、删除 draft，以及从 confirmed 菜名去重生成勾选清单。生成和换菜与真实 API 一样立即保存；显式保存不是进入历史的前置条件。Mock 计划只保存在进程内；刷新丢失符合当前测试桩定位，不把它冒充离线业务存储。

MVP 只提供“本周菜品勾选清单”：服务端响应仅包含 confirmed plan 中去重后的菜名，`checked` 状态只留在客户端本地，不进入业务库。它不包含食材或用量，不能称作食材购物清单。真正的食材购物清单明确 deferred；只有 website recipes 的所有者通过独立 Issue 增加结构化食材/用量并重新完成架构与安全评审后，Weekly Menu 才能另行实现，不能在 Weekly Menu 侧臆造 schema。

## 微信生产门禁

以下步骤等待 #318 的 HTTPS 与服务端 AppID/AppSecret 交接后人工执行，不由 Mock、单元测试或 H5 自动化替代：

- `project.config.json` 的 `touristappid` 只用于本地骨架，不是生产验收证据。
- 被精确忽略的 `project.private.config.json` 在本地覆盖真实 AppID，不修改已提交的 `project.config.json`；该 AppID 必须与 #318 注入 `weekly-menu-be` 的 AppID 一致。
- AppSecret 永远只注入服务端专属环境，不进入 `project.private.config.json`、小程序包或任何客户端构建变量。
- #318 先交付 `weekly-menu-api.codeforpeople.cn` 的 DNS、TLS、Nginx 与健康服务。
- #317 随后使用不入库的真实 AppID/本地私有配置，配置微信公众平台合法 request 域名，并由用户登录微信开发者工具手工上传体验版、完成真机 Happy Path。
- 真实 AppID 和项目私有配置不得进入仓库、Issue、PR 或日志；本期不创建上传私钥或 CI secret，也不引入 `miniprogram-ci`。未来如需自动上传，必须另开 Issue 设计独立 ignore 与 secret。
- `apps/community-cooking/project.private.config.json` 必须命中仓库的精确 ignore 规则且未被跟踪；提交前同时用 `git check-ignore` 与 `git ls-files` 复核。
- 合法 request 域名只能在 #318 的 HTTPS 服务健康后配置；#318 不代替微信公众平台授权。
- 若 #318 尚未完成真实 AppID/AppSecret 的安全注入与交接，#317 不得开始真实登录验收；真机 `wx.login` 成功是两端 AppID 匹配的最终证据。

## 本地验证

```bash
pnpm --filter @cfp/community-cooking lint
pnpm --filter @cfp/community-cooking typecheck
pnpm --filter @cfp/community-cooking test
pnpm --filter @cfp/community-cooking build:weapp
```
