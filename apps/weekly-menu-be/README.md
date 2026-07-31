# @cfp/weekly-menu-be

Weekly Menu 的独立后端边界。本 Issue 只包含 PostgreSQL 持久化和 website recipes
匿名只读客户端；HTTP、微信登录及业务 API 由后续 Issue 组合。

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
