# Quickstart：验证 kith-inn 自适应换菜

## PR2：纯领域评分

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-be test -- src/domain/menu/core.test.ts
pnpm verify
```

核对四类边界、四级优先级、相同评分随机注入、目标日前 1–7 日/自然周边界、仅目标位置变化。

## PR3：历史与菜单页解释

```bash
pnpm --filter @cfp/kith-inn-be test -- src/routes/menu.test.ts
pnpm --filter @cfp/kith-inn-fe test -- src/logic/menuEdit.test.ts
pnpm verify
```

核对自动分支历史查询范围、当前 plan 排除、响应 `relaxedRules`、中文映射，以及指定/published 既有测试。

## PR4：H5 小池链路

```bash
CI=1 pnpm --filter @cfp/kith-inn-fe test:e2e
pnpm verify
git diff --check
```

浏览器场景必须使用真实 H5→BE→CMS 写回：先准备一个有菜单的餐次，再把目标分类收缩到仅一个当前餐未使用且有冲突的活跃候选；点击“换”后同时断言目标菜变化、其他菜顺序不变和放宽提示可见。

## 完成判定

- 四个 PR 均经 Codex review，无新 comment、无 unresolved thread、required checks 全绿后 rebase merge。
- GitHub #163 验收项全部有自动化证据；然后才进入 #157。
