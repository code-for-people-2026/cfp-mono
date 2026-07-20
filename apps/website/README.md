# Code For People Website

为“工友敲键盘 / 数据平权、AI 下乡”准备的官方网站。

## Tech Stack

- Next.js App Router
- shadcn-style local UI components
- Payload CMS

## Development

From the monorepo root:

```bash
pnpm install
pnpm dev:website
```

Public site: http://localhost:3302

Payload admin: http://localhost:3302/admin

From this package directory, the equivalent command is:

```bash
pnpm dev
```

## Payload

本地开发可通过 `DATABASE_URI=file:./payload.db` 使用 SQLite，也可直接使用默认的
`payload.db`。所有生产 runtime（Vercel 或自托管）都必须使用 Postgres 并配置：

- `PAYLOAD_SECRET`
- one Postgres URL: `PAYLOAD_DATABASE_URL`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
  `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL`

包内 build 命令会设置内部标记 `CFP_WEBSITE_BUILD=1`，因此 CI 和 Docker 镜像构建不需要
读取线上凭据。运行中的容器不得设置该标记；生产启动会在 `next start` 前校验上述配置。

Admin bootstrap is intentionally narrow. Set `ALLOW_ADMIN_BOOTSTRAP=true` only long enough to
create the first `/admin` user; after one admin exists, anonymous creation is blocked either way.

For Payload schema changes against Postgres:

```bash
pnpm payload:migrate:create
pnpm payload:migrate
```

`PAYLOAD_DB_PUSH=true` is available for disposable preview environments, but production should use
migrations.
