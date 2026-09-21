#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
# Only synthetic credentials are rendered; no container or database is changed by this test.
cat > "$tmp/runtime.env" <<'ENV'
KITH_INN_DATABASE_URL=postgresql://runtime:fixture@example.invalid/kith_inn_test
KITH_INN_WECHAT_APP_ID=fixture
KITH_INN_WECHAT_APP_SECRET=fixture
KITH_INN_WECHAT_OWNER_OPEN_ID=fixture
ENV
export KITH_INN_IMAGE="example.invalid/cfp-kith-inn-api:$sha"
export KITH_INN_ENV_FILE="$tmp/runtime.env"
unset KITH_INN_HOST_PORT
compose=(docker compose -f "$root/deploy/docker-compose.kith-inn.yml")
"${compose[@]}" config --format json > "$tmp/compose.json"
jq -e --arg image "$KITH_INN_IMAGE" '
  .name == "cfp-kith-inn" and (.services | keys) == ["kith-inn-api"] and
  (.services["kith-inn-api"] |
    .image == $image and .environment.PORT == "3305" and
    .environment.RELEASE_SHA == null and .read_only == true and
    .cap_drop == ["ALL"] and .security_opt == ["no-new-privileges:true"] and
    .ports == [{ mode: "ingress", target: 3305, published: "3305", protocol: "tcp", host_ip: "127.0.0.1" }])
' "$tmp/compose.json" >/dev/null
KITH_INN_HOST_PORT=3395 "${compose[@]}" config --format json > "$tmp/isolated.json"
jq -e '.services["kith-inn-api"].ports[0].published == "3395"' "$tmp/isolated.json" >/dev/null
if KITH_INN_IMAGE= "${compose[@]}" config >/dev/null 2>&1; then
  echo 'Missing image must fail' >&2; exit 1
fi
if KITH_INN_ENV_FILE= "${compose[@]}" config >/dev/null 2>&1; then
  echo 'Missing private env file must fail' >&2; exit 1
fi
grep -Fqx 'USER node' "$root/apps/kith-inn-api/Dockerfile"
grep -Fq '/api/kith-inn/health' "$root/apps/kith-inn-api/Dockerfile"
grep -Fq 'proxy_pass http://127.0.0.1:3305;' "$root/deploy/nginx.kith-inn.example.conf"
grep -Fq 'location /api/kith-inn/' "$root/deploy/nginx.kith-inn.example.conf"
echo 'kith inn deploy config tests passed (no deployment performed)'
# Read-only runtime must not invoke Corepack or download a package manager at startup.
grep -Fqx 'WORKDIR /app/apps/kith-inn-api' "$root/apps/kith-inn-api/Dockerfile"
grep -Fqx 'CMD ["node", "--import", "tsx", "src/main.ts"]' "$root/apps/kith-inn-api/Dockerfile"
