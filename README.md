# cfp-mono

码成工 / Code for People 的单体仓库（monorepo）。

本仓库使用「牛马互助协议」授权。它不是 OSI 认可的标准开源许可证，详见 [LICENSE.md](./LICENSE.md)。

## 应用

- `apps/website`：Next.js + Payload CMS 官方网站，面向外部访问者介绍宣言、协议和 7×7 方向地图（含 `/map` 互动矩阵）。**当前唯一在维护、且为阿里云部署目标的应用。**

### 已退役 / 已归档

- `apps/site`：早期的 Next.js + Payload 试验站，**已退役并从仓库删除**，其阿里云流水线由 website 接管。
- `apps/miniapp-fe`：Taro 微信小程序 + H5 前端，**已归档**（代码保留，已移出 workspace）。
- `apps/2026-duanwu-booth-assistant`：一次性线下活动 H5 app，**已归档**（活动结束，已移出 workspace、已下线 Vercel）。

## 共享包

- `packages/ui`：共享的 shadcn 风格 Web UI 基础组件。
- `packages/tailwind-config`：共享 Tailwind 配置。
- `packages/typescript-config`：共享 TypeScript 配置。
- `packages/eslint-config`：共享 ESLint 配置。

## 本地启动

```bash
pnpm install
pnpm db:up
pnpm dev:website
```

## 验证

```bash
pnpm verify
pnpm test:e2e
```

部署说明见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
