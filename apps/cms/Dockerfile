# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/cms/package.json apps/cms/package.json
COPY packages/kith-inn-payload/package.json packages/kith-inn-payload/package.json
COPY packages/kith-inn-shared/package.json packages/kith-inn-shared/package.json
COPY packages/kith-inn-v1-payload/package.json packages/kith-inn-v1-payload/package.json
COPY packages/kith-inn-v1-shared/package.json packages/kith-inn-v1-shared/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN pnpm install --frozen-lockfile --filter @cfp/cms...

# Short-lived production operations retain the CLI source/toolchain without
# expanding the minimal Next standalone runtime image.
FROM deps AS jobs
ARG RELEASE_SHA
RUN test -n "$RELEASE_SHA"
LABEL org.opencontainers.image.source="https://github.com/code-for-people-2026/cfp-mono"
LABEL org.opencontainers.image.revision=$RELEASE_SHA
ENV NODE_ENV=production
ENV PAYLOAD_DB_PUSH=false
ENV RELEASE_SHA=$RELEASE_SHA
COPY . .
WORKDIR /app/apps/cms
USER node
CMD ["./node_modules/.bin/tsx", "migrations/run.ts"]

FROM deps AS builder
ARG RELEASE_SHA
RUN test -n "$RELEASE_SHA"
COPY . .
RUN pnpm --filter @cfp/cms build

FROM node:22-bookworm-slim AS runner
ARG RELEASE_SHA
LABEL org.opencontainers.image.source="https://github.com/code-for-people-2026/cfp-mono"
LABEL org.opencontainers.image.revision=$RELEASE_SHA
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3304
ENV RELEASE_SHA=$RELEASE_SHA
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next/static ./apps/cms/.next/static
USER nextjs
EXPOSE 3304
HEALTHCHECK --interval=2s --timeout=2s --start-period=5s --retries=30 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3304/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/cms/server.js"]
