# 社区做饭「生成菜单」功能 —— 交接说明

> 给前端同学：这份文档说明**已经搭好的骨架**、**逻辑/数据在哪**、以及**你要接手做什么**。
> 一句话：业务逻辑和数据已经迁好并就位，**剩下的是把 Taro 界面接上去**。

---

## 1. 这次迁移做了什么（背景）

原功能来自 `sunmer-home/apps/weekly-menu`（一个 Next.js **网页**应用）。
现在迁到 `cfp-mono`，目标端是**微信小程序（Taro）**，后端用 `apps/website` 的 Payload CMS。

迁移把原代码拆成三块，去向不同：

| 原来的东西 | 性质 | 去了哪 | 谁负责 |
|---|---|---|---|
| `generator.ts` 菜单生成算法 | 纯逻辑 | `packages/menu-core` ✅ 已迁 | 已完成 |
| `dishes.ts` 写死的菜名 | 数据 | `apps/website` 菜谱库集合（CMS）✅ 已迁 | 已完成 |
| 网页 React 页面 | 前端 UI | `apps/community-cooking` 骨架 | **← 你接手** |

> 网页 UI 用的是 `<div>`、`next/navigation` 等，**小程序跑不了**，所以这部分是重写而非搬运。
> 交互流程（生成 → 预览 → 换菜 → 确认）可照着原 weekly-menu 的设计做。

---

## 2. 已经就位的两块（你直接用，不用动）

### `packages/menu-core` —— 菜单生成逻辑

纯 TypeScript，零框架依赖，小程序里直接 import：

```ts
import { generateWeeklyMenu, replaceDishInPlan, type DishPools } from "@cfp/menu-core";

const pools: DishPools = { bigMeat: [...], smallMeat: [...], vegetable: [...] };
const plan = generateWeeklyMenu(pools);                          // 生成一周菜单
const next = replaceDishInPlan(plan, dayIndex, mealIndex, "bigMeat", pools); // 换某一道
```

- 菜品池 `pools` **由你传进去** —— 这是故意解耦的：逻辑不关心菜品从哪来。
- 你要做的是：从 CMS 拉菜品 → 整理成 `DishPools` → 交给 `generateWeeklyMenu`。
- ⚠️ CMS 的 `category` 是 kebab（`big-meat`），`DishPools` 的键是 camel（`bigMeat`），
  **别直接 groupBy**。用 menu-core 导出的契约映射：

```ts
import { RECIPE_CATEGORY_TO_SLOT, type DishPools } from "@cfp/menu-core";

function toDishPools(recipes: { name: string; category: keyof typeof RECIPE_CATEGORY_TO_SLOT }[]) {
  const pools: DishPools = { bigMeat: [], smallMeat: [], vegetable: [] } as DishPools;
  for (const r of recipes) (pools[RECIPE_CATEGORY_TO_SLOT[r.category]] as string[]).push(r.name);
  return pools;
}
```

### `apps/website` 菜谱库集合 —— 菜品数据

- 集合 slug：`recipes`，字段：`name`、`category`（big-meat / small-meat / vegetable）、`active`。
- 运营在 `/admin` 后台维护菜品，**前端不写死菜名**。
- 读取接口（Payload 自动生成）：`GET {website}/api/recipes?where[active][equals]=true&limit=0`
  —— `lib/api.ts` 的 `createRecipesUrl()` 已封装好（`limit=0` 关分页拿全量，`active` 过滤停用项）。
- 初始菜名种子在 `apps/website/src/payload/recipes.seed.ts`，由 `GET /api/seed`（需 `PAYLOAD_SEED=true`）幂等导入。

---

## 3. 这个 app 的骨架（你在这里干活）

```
apps/community-cooking/
├── src/
│   ├── app.config.ts        已注册两个页面：index、menu
│   ├── components/          ★ app 内组件（约定见 components/README.md）
│   │   ├── ScreenContainer/ 布局原语
│   │   └── DishCard/        一道菜的卡片（已对齐 CMS 的 category）
│   ├── lib/
│   │   └── api.ts           已写好后端地址解析 + createRecipesUrl()
│   └── pages/
│       ├── index/           首页（入口按钮 → menu 页）
│       └── menu/            ★ 本周菜单页，当前是占位骨架
```

### 组件约定（重要）

- 组件放 `src/components/`，**app 内部用**。等出现第 2 个小程序复用同一组件，再抽到 `packages/`。
  现在别建独立组件库（细节见 [components/README.md](src/components/README.md)）。
- **组件只展示，不发请求**：数据由页面（`pages/`）通过 props 传入。
- 可以引一个现成的小程序 UI 库（推荐 NutUI / Taro UI）补齐基础组件，没必要全自己写。

---

## 4. 你接手要做的事（建议顺序）

1. **menu 页接真实数据**：`src/pages/menu/index.tsx` 现在是写死的占位数组。
   改成：`Taro.request(createRecipesUrl(...))` 拉菜品 → 按 category 整理成 `DishPools`
   → `generateWeeklyMenu(pools)` → 渲染成周网格。
2. **补齐交互**：换菜（`replaceDishInPlan`）、周切换、保存/确认、购物清单等，
   照 weekly-menu 原交互做。
3. **状态与持久化**：用户的「本周计划」存哪（小程序缓存 / 后端）按需求定。
4. **样式打磨**：现有 CSS 只是能看的骨架，按设计稿来。

> ⚠️ 有一个**待定决策**会影响你：菜单生成是在「小程序端」跑还是「后端」跑？
> - 小程序端跑：直接用上面的 `@cfp/menu-core`（最简单，当前骨架就是这个假设）。
> - 后端跑：改成调 `apps/website` 的一个自定义接口，前端只拿结果。
> 没定之前，先按「小程序端跑」推进即可，逻辑两端通用。

---

## 5. 本地起步

```bash
pnpm install                                          # 仓库根目录
pnpm db:up                                            # 起本地 PostgreSQL
pnpm --filter @cfp/website dev                        # 起后端 + /admin（建菜品，端口 3302）
pnpm --filter @cfp/community-cooking dev:h5           # H5 预览小程序
pnpm --filter @cfp/community-cooking build:weapp      # 出微信小程序产物（手动测试）
```

质量门禁（提交前）：

```bash
pnpm --filter @cfp/community-cooking lint
pnpm --filter @cfp/community-cooking typecheck
pnpm --filter @cfp/community-cooking test
```

---

## 6. 当前状态清单

- ✅ `packages/menu-core`：生成逻辑已迁，留好「菜品池由外部传入」的口子，带测试。
- ✅ `apps/website`：菜谱库集合已建并注册；菜名种子数据已就位。
- ✅ `apps/community-cooking`：app 骨架 + 组件文件夹结构 + 两个页面占位。
- ⬜ menu 页接 CMS 真实数据（**前端接手**）。
- ⬜ 换菜/周切换/确认/购物清单等交互（**前端接手**）。
- ⬜ 种子数据导入生产 DB、部署/CI 配置（后续）。
