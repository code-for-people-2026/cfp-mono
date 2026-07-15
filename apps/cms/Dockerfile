FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
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

FROM deps AS builder
ARG RELEASE_SHA
RUN printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'
COPY . .
RUN pnpm --filter @cfp/cms build

FROM node:22-alpine AS runner
ARG RELEASE_SHA
LABEL org.opencontainers.image.revision="$RELEASE_SHA"
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3304
ENV RELEASE_SHA="$RELEASE_SHA"
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/cms/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/cms/.next/static ./apps/cms/.next/static
USER node
EXPOSE 3304
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3304/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
WORKDIR /app/apps/cms
CMD ["node", "server.js"]
