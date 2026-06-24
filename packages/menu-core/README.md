# @cfp/menu-core

一周菜单生成的**纯逻辑**。零框架依赖，小程序和后端都能 import。

从 `sunmer-home/apps/weekly-menu` 的 `generator.ts` 迁移而来。迁移时做了「留口子」改造：

- **菜品来源解耦**：不再 import 写死的 `dishes.ts`，菜品池由调用方通过 `dishPools` 参数传入。
  数据来自 CMS（`apps/website` 的菜谱库集合）、缓存还是别处，这个包都不关心。
- **随机源可注入**：`random` 参数默认 `Math.random`，测试可传确定值。

## 用法

```ts
import { generateWeeklyMenu, type DishPools } from "@cfp/menu-core";

// 菜品池一般从 CMS 拉取后整理而来
const pools: DishPools = {
  bigMeat: ["红烧肉", "可乐鸡翅", /* ... */],
  smallMeat: ["番茄炒蛋", "麻婆豆腐", /* ... */],
  vegetable: ["蒜蓉西兰花", "醋溜白菜", /* ... */]
};

const plan = generateWeeklyMenu(pools);              // 生成本周菜单
const next = replaceDishInPlan(plan, 0, 0, "bigMeat", pools); // 换某一道
```

## 这个包**不做**什么

- 不发网络请求、不读 CMS —— 调用方负责把菜品池准备好再传进来。
- 不决定「在小程序端还是后端跑」—— 两端都能用同一个包，这正是解耦的目的。
