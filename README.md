# cfp-mono

码成工 / Code for People 的单体仓库（monorepo）。

本仓库使用「牛马互助协议」授权。它不是 OSI 认可的标准开源许可证，详见 [LICENSE.md](./LICENSE.md)。

## 应用

- `apps/site`：Next.js + Payload CMS 站点，包含公开主页、Payload 管理后台和共享 API。
- `apps/miniapp-fe`：Taro 前端应用，面向微信小程序，同时产出 H5 网页版。

## 共享包

- `packages/ui`：共享的 shadcn 风格 Web UI 基础组件。
- `packages/tailwind-config`：共享 Tailwind 配置。
- `packages/typescript-config`：共享 TypeScript 配置。
- `packages/eslint-config`：共享 ESLint 配置。

## 本地启动

```bash
pnpm install
pnpm db:up
pnpm dev:site
pnpm dev:miniapp:h5
```

## 验证

```bash
pnpm verify
pnpm test:e2e
```

部署说明见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
