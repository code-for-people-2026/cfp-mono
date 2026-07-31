# @cfp/weekly-menu-shared

Weekly Menu 的框架无关契约与纯领域规则。

- 通过 Zod schema 固定 v1 DTO、操作输入和领域错误码。
- 菜单生成与换菜只调用 `@cfp/menu-core`，不复制算法。
- 所有权、`draft → confirmed`、confirmed 不可变、复制和菜品勾选清单均为纯函数。
- 菜品勾选清单只包含 confirmed plan 的去重菜名，不包含 `checked`、食材或用量。
- 不依赖 HTTP、Payload、微信 SDK、数据库或 UI 框架。

```bash
pnpm --filter @cfp/weekly-menu-shared test
pnpm --filter @cfp/weekly-menu-shared typecheck
```
