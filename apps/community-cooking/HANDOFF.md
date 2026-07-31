# 社区做饭 Weekly Menu 交接说明

> 本文替代此前“客户端直连 Payload”的历史交接路径。架构事实以 [Weekly Menu 迁移决策](../../docs/weekly-menu/MIGRATION.md) 为准。

## 已有资产

| 资产 | 当前状态 | 所有者 |
| --- | --- | --- |
| 菜单生成与换菜算法 | `@cfp/menu-core` 已实现并有测试 | `packages/menu-core` |
| 菜谱内容 | Payload `recipes` 已存在 | 官网私有 `apps/website` |
| Taro app | 首页、菜单占位页和基础组件已存在 | `apps/community-cooking` |
| 菜谱请求 | 只有 `createRecipesUrl()` 与单测，尚无真实请求 | 历史过渡 helper |

网页 React/Next 页面不能直接迁到 Taro；只复用产品流程、TypeScript 契约和纯函数。

## 最终请求链路

```text
apps/community-cooking
  -> HTTPS /api/v1/weekly-menu/*
  -> apps/weekly-menu-be
  -> GET website /api/recipes（服务端匿名只读）
```

- 小程序绝不调用 `createRecipesUrl()` 或 raw Payload REST/GraphQL。
- Weekly Menu API 只返回客户端 Happy Path 所需的最小 DTO，不透传 Payload collection、分页或管理模型。
- `/admin`、website 数据库、migration/seed、写接口和权限全部保持官网私有。
- 不新增 CMS internal route/token；未来写 CMS 必须另开 Issue 并重新授权。

## 实现顺序

1. #313 定义 `@cfp/weekly-menu-shared` DTO、验证、错误码与纯规则。
2. #314～#316 实现专用数据库、微信会话和版本化 Weekly Menu API。
3. #317 的页面与 Mock adapter 可在 #313 后提前开发，但生产验收不能在 #318 前完成。
4. #318 先交付 Weekly Menu API 的公网 HTTPS、readiness 与 smoke。
5. #317 再完成真实 adapter、合法 request 域名、体验版与真机 Happy Path。

Mock adapter 可直接调用 `@cfp/menu-core`；真实 adapter 只调用 Weekly Menu API。

MVP 只提供“本周菜品勾选清单”：服务端响应仅包含 confirmed plan 中去重后的菜名，`checked` 状态只留在客户端本地，不进入业务库。它不包含食材或用量，不能称作食材购物清单。真正的食材购物清单明确 deferred；只有 website recipes 的所有者通过独立 Issue 增加结构化食材/用量并重新完成架构与安全评审后，Weekly Menu 才能另行实现，不能在 Weekly Menu 侧臆造 schema。

## 微信生产门禁

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
