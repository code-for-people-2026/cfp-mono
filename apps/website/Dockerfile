FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Install workspace dependencies. Only the manifests of the packages that
# remain in the workspace are copied so this layer caches on lockfile changes.
# A root .dockerignore keeps the host's node_modules out of the build context,
# so the musl (alpine) install below survives the `COPY . .` in the builder
# stage — important for Payload's native deps (sharp, pg).
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json ./
COPY apps/website/package.json apps/website/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/tailwind-config/package.json packages/tailwind-config/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --filter @cfp/website build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3302
# Start Next directly. The Payload Postgres adapter applies the committed
# migrations automatically on first connection in production (prodMigrations
# in payload.config.ts), so there is no separate `payload migrate` step here.
CMD ["pnpm", "--filter", "@cfp/website", "start"]
