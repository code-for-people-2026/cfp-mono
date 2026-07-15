# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/kith-inn-fe/package.json apps/kith-inn-fe/package.json
COPY packages/kith-inn-shared/package.json packages/kith-inn-shared/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN pnpm install --frozen-lockfile --filter @cfp/kith-inn-fe...

FROM deps AS builder
ARG RELEASE_SHA
ARG BE_BASE_URL
RUN test -n "$RELEASE_SHA" && test -n "$BE_BASE_URL"
COPY . .
RUN BE_BASE_URL="$BE_BASE_URL" pnpm --filter @cfp/kith-inn-fe build:h5

FROM nginx:1.27-alpine AS runner
ARG RELEASE_SHA
LABEL org.opencontainers.image.source="https://github.com/code-for-people-2026/cfp-mono"
LABEL org.opencontainers.image.revision=$RELEASE_SHA
ENV RELEASE_SHA=$RELEASE_SHA
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/kith-inn-fe/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder --chown=nginx:nginx /app/apps/kith-inn-fe/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=2s --start-period=5s --retries=30 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
