FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/kith-inn-be/package.json apps/kith-inn-be/package.json
COPY packages/kith-inn-shared/package.json packages/kith-inn-shared/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN pnpm install --frozen-lockfile --filter @cfp/kith-inn-be...

FROM deps AS builder
ARG RELEASE_SHA
RUN printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'
COPY . .
RUN pnpm --filter @cfp/kith-inn-be build

FROM node:22-alpine AS runner
ARG RELEASE_SHA
LABEL org.opencontainers.image.revision="$RELEASE_SHA"
ENV NODE_ENV=production
ENV BE_PORT=3310
ENV RELEASE_SHA="$RELEASE_SHA"
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/kith-inn-be/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/kith-inn-be/dist ./dist
USER node
EXPOSE 3310
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3310/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
