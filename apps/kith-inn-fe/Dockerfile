FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
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
ARG BE_BASE_URL
ARG RELEASE_SHA
RUN printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'
COPY . .
RUN BE_BASE_URL="$BE_BASE_URL" pnpm --filter @cfp/kith-inn-fe build:h5 \
  && printf '{"releaseSha":"%s"}\n' "$RELEASE_SHA" > apps/kith-inn-fe/dist/release.json

FROM nginx:1.27-alpine AS runner
ARG RELEASE_SHA
LABEL org.opencontainers.image.revision="$RELEASE_SHA"
ENV RELEASE_SHA="$RELEASE_SHA"
COPY --chown=nginx:nginx apps/kith-inn-fe/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder --chown=nginx:nginx /app/apps/kith-inn-fe/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=6 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health"]
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
