# @cfp/weekly-menu-be

Weekly Menu 的独立后端边界。它使用 Node 标准库 HTTP 提供健康检查和微信会话，
并组合本应用自己的 PostgreSQL 持久化与 website recipes 匿名只读客户端。

## 运行时

```bash
WEEKLY_MENU_DATABASE_URL='postgresql://…/weekly_menu' \
WEEKLY_MENU_RECIPES_BASE_URL='https://website.example.test' \
WEEKLY_MENU_WECHAT_APP_ID='由服务端安全注入' \
WEEKLY_MENU_WECHAT_APP_SECRET='由服务端安全注入' \
pnpm --filter @cfp/weekly-menu-be start
```

- 默认监听容器内 `0.0.0.0:3304`；生产宿主机只将端口映射到 loopback。
- `GET /api/health` 只返回进程状态和截短的 `RELEASE_SHA`。
- `GET /api/ready` 在限时内检查 Weekly Menu 专库和三个非空菜谱分类，不调用微信。
- `POST /api/v1/auth/wechat` 用一次性 code 换取应用会话。
- `DELETE /api/v1/auth/session` 撤销当前 Bearer 会话。
- token 只向客户端返回一次；数据库只保存 SHA-256 哈希。日志不会记录 code、
  openid、session_key、token、AppSecret、连接串或上游错误详情。
- 请求体上限为 16 KiB。错误响应统一包含稳定 code 与 `x-request-id`。

菜单生成、计划读写等 `/api/v1/weekly-menu/*` 业务路由不属于本阶段。

## 数据所有权

- 只读取 `WEEKLY_MENU_DATABASE_URL`，不会回退到 website 的 `DATABASE_URL`。
- 只创建 `weekly_menu_*` 表，不连接或修改 website Payload schema。
- 菜谱仍由 website 私有 CMS 所有；这里只通过 `GET /api/recipes` 转换为菜单生成器需要的最小字段，不复制或双写。
- 业务库无 seed，不提供 schema push、reset 或自动 down migration。

## Migration

```bash
WEEKLY_MENU_DATABASE_URL='postgresql://…/weekly_menu' \
  pnpm --filter @cfp/weekly-menu-be db:migrate
```

Migration 按文件名前向执行并记录在 `weekly_menu_migrations`。`0001_initial.sql`
只新增 Weekly Menu 表，适用于空的专用数据库；回滚采用部署前数据库级逻辑备份，任何不兼容恢复都需要人工确认。

## 验证

```bash
pnpm --filter @cfp/weekly-menu-be lint
pnpm --filter @cfp/weekly-menu-be typecheck
pnpm --filter @cfp/weekly-menu-be test
```

设置本地测试数据库的 `WEEKLY_MENU_DATABASE_URL` 后，测试还会从空库验证 migration、所有权、会话过期/撤销与 confirmed 数据库级保护；未设置时只跳过 PostgreSQL 集成测试。
