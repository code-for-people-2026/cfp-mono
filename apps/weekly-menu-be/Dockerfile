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
COPY apps/weekly-menu-be/package.json apps/weekly-menu-be/package.json
COPY packages/menu-core/package.json packages/menu-core/package.json
COPY packages/weekly-menu-shared/package.json packages/weekly-menu-shared/package.json
RUN pnpm install --frozen-lockfile --prod --filter @cfp/weekly-menu-be...

COPY --chown=node:node apps/weekly-menu-be/src apps/weekly-menu-be/src
COPY --chown=node:node apps/weekly-menu-be/scripts apps/weekly-menu-be/scripts
COPY --chown=node:node apps/weekly-menu-be/migrations apps/weekly-menu-be/migrations
COPY --chown=node:node packages/menu-core/src packages/menu-core/src
COPY --chown=node:node packages/weekly-menu-shared/src packages/weekly-menu-shared/src

USER node
EXPOSE 3304
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3304/api/health").then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["pnpm", "--filter", "@cfp/weekly-menu-be", "start"]
