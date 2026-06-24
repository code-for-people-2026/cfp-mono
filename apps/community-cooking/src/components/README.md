# components/ — app 内组件

这里放 **community-cooking 自己用的 Taro 组件**（`<View>/<Text>` 那一套，不是网页 DOM）。

## 为什么放这里，而不是 `packages/`

我们现在只有这一个小程序在用这些组件。**组件库是「抽」出来的，不是一开始就「设计」的**：
等出现第 2 个小程序、真的在重复同一个组件时，再把它抽到 `packages/ui-miniapp`。
现在就建独立库 = 给一个用户造工厂，是过度设计。

> 判断标准：同一个组件在 **2~3 个地方**被真实复用 → 抽到 `packages/`；否则留在这里。

## 目录约定

每个组件一个文件夹，`index.tsx` + `index.css` 配对：

```
components/
├── ScreenContainer/   布局原语：统一页面外边距/背景
│   ├── index.tsx
│   └── index.css
└── DishCard/          领域组件：一道菜（大荤/小荤/素菜）
    ├── index.tsx
    └── index.css
```

- **布局原语**（ScreenContainer 这类）：无业务含义，纯排版，最容易将来被抽走。
- **领域组件**（DishCard 这类）：带「社区做饭」业务语义，跟菜单功能绑定。

## 边界

- 不在组件里直接发网络请求 —— 数据从页面（`pages/`）传入 props，组件只负责展示。
- 菜单生成算法不属于组件，也不属于这里 —— 它是纯逻辑，去向待定（见仓库根的迁移说明：
  `packages/menu-core` 还是放后端，取决于「生成在小程序端还是后端跑」的决策）。
