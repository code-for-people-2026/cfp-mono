FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json ./
COPY apps/miniapp-fe/package.json apps/miniapp-fe/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --filter @cfp/miniapp-fe build:h5

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/apps/miniapp-fe/dist /usr/share/nginx/html
EXPOSE 80
