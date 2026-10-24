FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.2.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bubu-log-core/package.json apps/bubu-log-core/package.json
COPY packages/eslint-config packages/eslint-config
RUN pnpm install --frozen-lockfile --filter @cfp/bubu-log-core... --ignore-scripts
COPY apps/bubu-log-core apps/bubu-log-core
RUN BUBU_BUILD_TYPES_VERIFIED=true NODE_OPTIONS=--max-old-space-size=1024 RAYON_NUM_THREADS=1 pnpm --filter @cfp/bubu-log-core build
RUN chown -R node:node apps/bubu-log-core/.next
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/bubu-log-core
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3321"]
