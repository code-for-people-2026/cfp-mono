# @cfp/community-cooking

社区做饭微信小程序（Taro），同时产出用于自动化验证的 H5。Weekly Menu 的个人一周菜单、历史和本周菜品勾选清单能力继续在此 app 扩展，不创建第二个小程序。

## 当前状态

- `@cfp/weekly-menu-shared` 提供版本化 DTO、验证和纯领域规则。
- 可替换的 `WeeklyMenuClient` 能力接口与本地 Mock 已覆盖登录、生成、换菜、保存、确认、历史、复制、删除和菜品勾选清单。
- 当前页面不发网络请求、不调用 `wx.login`，也不读取 Payload；真实 adapter 等 #315/#316 契约稳定后再实现。
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
    ├── index/           Mock 登录与首页
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

当前构建固定使用 Mock adapter，不需要 API 地址、AppID 或 Secret。真实 HTTPS adapter、token 生命周期、超时与 `401` 恢复留给 #315/#316 契约稳定后的同一 Issue 后续切片；页面只依赖 `WeeklyMenuClient`，无需改写领域流程。

真实 AppID 和微信公众平台配置不得提交。`project.config.json` 的 `touristappid` 仅用于本地骨架；被精确忽略的 `project.private.config.json` 在本地覆盖真实 AppID，且必须与 #318 注入后端的 AppID 一致。AppSecret 永远只存在于服务端专属环境，不进入私有项目配置、小程序包或客户端构建变量。#318 先交付健康的 HTTPS API 与真实登录凭据交接，#317 再由用户登录微信开发者工具手工上传体验版，并完成合法 request 域名和真机验收。本期不引入 `miniprogram-ci`、上传私钥或上传 CI secret。
