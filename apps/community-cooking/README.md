# @cfp/community-cooking

社区做饭微信小程序（Taro），同时产出 H5。cfp-mono 下的一个独立 app，
后端复用 `apps/website` 的 Payload CMS。

## 核心功能

一周菜单生成：菜品由社区在 CMS 后台（`apps/website` 的菜谱库集合）维护，
小程序按需拉取并生成「大荤 / 小荤 / 素菜」搭配的一周菜单。

## 目录结构

```
src/
├── app.config.ts        小程序页面与窗口配置
├── app.tsx / app.css    应用外壳
├── components/          app 内 Taro 组件（约定见 components/README.md）
│   ├── ScreenContainer/ 布局原语
│   └── DishCard/        领域组件：一道菜
├── lib/
│   └── api.ts           解析后端地址 + 菜谱库接口（指向 apps/website 的 Payload）
└── pages/
    ├── index/           首页
    └── menu/            本周菜单（核心功能，当前为骨架）
```

## 本地开发

```bash
pnpm --filter @cfp/community-cooking dev:h5      # H5 预览（自动化测试用）
pnpm --filter @cfp/community-cooking build:weapp # 微信小程序产物（手动测试）
```

## 待办（迁移路线）

- [x] `apps/website` 新增 `recipes` 菜谱库集合 + 种子数据，运营在 `/admin` 维护菜品。
- [x] 把 weekly-menu 的 generator 改成「留口子」版迁入 `packages/menu-core`。
- [ ] 决策：菜单生成逻辑在「小程序端」还是「后端」跑 —— 决定谁 import `packages/menu-core`。
- [ ] menu 页接真实数据，替换骨架占位。
