# @cfp/community-cooking

社区做饭微信小程序（Taro），同时产出用于自动化验证的 H5。Weekly Menu 的个人一周菜单、历史和本周菜品勾选清单能力继续在此 app 扩展，不创建第二个小程序。

## 当前状态

- `@cfp/weekly-menu-shared` 提供版本化 DTO、验证和纯领域规则。
- 可替换的 `WeeklyMenuClient`、本地 Mock 与真实 API adapter 已覆盖登录、生成、换菜、保存、确认、历史、复制、删除和菜品勾选清单。
- API 地址缺失时默认使用 Mock，不发网络请求或调用 `wx.login`；仅当 `TARO_APP_WEEKLY_MENU_API_BASE_URL` 非空时选择真实 adapter。
- 真实 adapter 只调用 Weekly Menu API，使用短超时、严格 DTO 校验和 Bearer 会话；`401` 会清除本地 token 并引导重新登录，错误提示不显示 code、token、openid 或上游详情。
- 菜品勾选状态只写入客户端本地缓存，不进入计划 DTO 或 Mock 计划 store。

## 已确定边界

- 最终小程序只调用 `/api/v1/weekly-menu/*`，绝不直连 Payload。
- `weekly-menu-be` 是现有匿名只读 `GET /api/recipes` 的唯一 Weekly Menu 消费者，并向小程序返回最小 DTO。
- 官网 `/admin`、Payload 配置、数据库、migration/seed、写接口和管理权限保持 website 私有且权限不变。
- 不新增 CMS internal route/token；未来如需写 CMS，必须另开 Issue 并重新取得架构与安全授权。
- Mock adapter 可以复用 `@cfp/weekly-menu-shared`，真实 adapter 只调用 Weekly Menu API。
- MVP 的“本周菜品勾选清单”仅来自 confirmed plan 的去重菜名；`checked` 状态只留在客户端本地，不进入业务库。真正的食材购物清单不在当前范围。

完整决策、数据与部署所有权见 [Weekly Menu 迁移决策](../../docs/weekly-menu/MIGRATION.md)。

## 目录结构

```text
src/
├── app.config.ts        页面与窗口配置
├── components/          app 内 Taro 组件
├── lib/                  可替换客户端接口、Mock 与本地 checklist 状态
└── pages/
    ├── index/           Mock / 微信登录与首页
    ├── menu/            7 天 × 2 餐菜单编辑、保存和确认
    ├── history/         当前 Mock 用户的菜单历史
    ├── history-detail/  详情、复制与草稿删除
    └── checklist/       confirmed 菜名去重的本周菜品勾选清单
```

## 本地开发

```bash
pnpm --filter @cfp/community-cooking dev:h5
pnpm --filter @cfp/community-cooking build:weapp
pnpm --filter @cfp/community-cooking lint
pnpm --filter @cfp/community-cooking typecheck
pnpm --filter @cfp/community-cooking test
pnpm --filter @cfp/community-cooking test:e2e
```

默认构建使用 Mock adapter，不需要 API 地址、AppID 或 Secret。只有显式提供非空的
`TARO_APP_WEEKLY_MENU_API_BASE_URL` 才启用真实 adapter：

```bash
TARO_APP_WEEKLY_MENU_API_BASE_URL='https://weekly-menu-api.example.test' \
  pnpm --filter @cfp/community-cooking build:weapp
```

该客户端构建变量只能保存无凭据的 HTTPS API 根地址，不能包含 token、AppID、
AppSecret 或 URL 凭据。生成和换菜均由 API 立即保存；“保存草稿”是显式覆盖当前 draft，
不再是进入历史的前置条件。页面不读取 Payload。

真实域名、AppID 和微信公众平台配置仍等待 #318，不属于当前自动化测试。`project.config.json` 的 `touristappid` 仅用于本地骨架；被精确忽略的 `project.private.config.json` 在本地覆盖真实 AppID，且必须与 #318 注入后端的 AppID 一致。AppSecret 永远只存在于服务端专属环境，不进入私有项目配置、小程序包或客户端构建变量。#318 先交付健康的 HTTPS API 与真实登录凭据交接，#317 再由用户配置合法 request 域名、登录微信开发者工具手工上传体验版并完成真机验收。本期不引入 `miniprogram-ci`、上传私钥或上传 CI secret。
