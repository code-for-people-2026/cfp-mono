ARG RELEASE_SHA

FROM node:22-alpine
ARG RELEASE_SHA
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV RELEASE_SHA="$RELEASE_SHA"
LABEL org.opencontainers.image.revision="$RELEASE_SHA"

RUN printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$' && corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/kith-inn-api/package.json apps/kith-inn-api/package.json
COPY packages/kith-inn-contracts/package.json packages/kith-inn-contracts/package.json
RUN pnpm install --frozen-lockfile --prod --filter @cfp/kith-inn-api...

COPY --chown=node:node apps/kith-inn-api/src apps/kith-inn-api/src
COPY --chown=node:node apps/kith-inn-api/scripts apps/kith-inn-api/scripts
COPY --chown=node:node apps/kith-inn-api/migrations apps/kith-inn-api/migrations
COPY --chown=node:node packages/kith-inn-contracts/src packages/kith-inn-contracts/src

WORKDIR /app/apps/kith-inn-api
USER node
EXPOSE 3305
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3305/api/kith-inn/health").then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "--import", "tsx", "src/main.ts"]
