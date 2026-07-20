#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-http://127.0.0.1:3302}"
SITE_URL="${SITE_URL%/}"
target="${1:-website}"

# Containers need a few seconds after `up -d` before the app accepts
# connections, so poll each endpoint with a bounded retry instead of
# failing on the first refused connection.
RETRIES="${SMOKE_RETRIES:-30}"
SLEEP="${SMOKE_SLEEP:-2}"
fail() { printf '{"status":"failed","error":"%s"}\n' "$1" >&2; exit 1; }

retry() {
  local label="$1"
  shift
  local attempt=1
  until "$@" >/dev/null 2>&1; do
    if [ "$attempt" -ge "$RETRIES" ]; then
      printf '{"status":"failed","error":"%s_unavailable"}\n' "$label" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep "$SLEEP"
  done
}

if [[ "$target" == "website" ]]; then
  release_sha="${RELEASE_SHA:-}"
  [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "invalid_configuration"
  for command in curl jq; do command -v "$command" >/dev/null || fail "missing_command"; done
  website_release() {
    local endpoint="$1" contract="$2"
    curl -fsS -m 10 "$SITE_URL$endpoint" |
      jq -e --arg releaseSha "$release_sha" ".releaseSha == \$releaseSha and ($contract)"
  }
  retry website curl -fsS -m 10 "$SITE_URL/"
  retry website_health website_release /api/health '.status == "ok"'
  retry website_readiness website_release /api/ready '.ok == true and .service == "website"'
  echo "Smoke tests passed"
  exit 0
fi
[[ "$target" == "kith-inn" ]] || { echo '{"status":"failed","error":"invalid_target"}' >&2; exit 1; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${KITH_INN_COMPOSE_FILE:-$repo_root/deploy/docker-compose.kith-inn.prod.yml}"
project_directory="${KITH_INN_PROJECT_DIRECTORY:-$(dirname "$compose_file")}"
env_file="${KITH_INN_ENV_FILE:-$repo_root/deploy/.env.verify}"
release_sha="${RELEASE_SHA:-}"
seller_id="${KITH_INN_PROVISIONED_SELLER_ID:-}"
openid="${KITH_INN_TRIAL_OPENID:-}"
for command in curl docker jq; do command -v "$command" >/dev/null || fail "missing_command"; done
[[ -f "$compose_file" && -f "$env_file" ]] || fail "invalid_configuration"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ && -n "$seller_id" && -n "$openid" ]] || fail "invalid_configuration"

https_origin() {
  local value="${1%/}" authority host port
  [[ "$value" =~ ^https://[A-Za-z0-9.-]+(:[1-9][0-9]{0,4})?$ ]] || fail "invalid_configuration"
  authority="${value#https://}"
  host="$(printf '%s' "${authority%%:*}" | tr '[:upper:]' '[:lower:]')"
  [[ "$host" == *.* && "$host" != *..* && "$host" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || fail "invalid_configuration"
  [[ ! "$host" =~ ^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$ ]] || fail "invalid_configuration"
  case "$host" in
    localhost|*.localhost|*.local|*.lan|home.arpa|*.home.arpa|*.invalid|*.example|*.test|example.com|*.example.com|example.net|*.example.net|example.org|*.example.org)
      fail "invalid_configuration" ;;
  esac
  if [[ "$authority" == *:* ]]; then
    port="${authority##*:}"
    (( 10#$port > 0 && 10#$port <= 65535 )) || fail "invalid_configuration"
  fi
  printf '%s' "$value"
}

is_unauthorized() {
  local code
  code="$(curl -sS -o /dev/null -m 10 -w '%{http_code}' "$1")" || return 1
  [[ "$code" == 401 ]]
}

ingress_release() {
  local endpoint="$1" contract="$2"
  curl -fsS -m 10 "$public_be_url$endpoint" |
    jq -e --arg releaseSha "$release_sha" ".releaseSha == \$releaseSha and ($contract)"
}

public_be_url="$(https_origin "${KITH_INN_BE_BASE_URL:-}")"
compose=(docker compose --project-directory "$project_directory" -f "$compose_file" --env-file "$env_file")
started_seconds="$(date +%s)"

for service in kith-inn-cms kith-inn-be kith-inn-h5; do
  image_id="$("${compose[@]}" images -q "$service")"
  [[ -n "$image_id" ]] || fail "release_mismatch"
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_id")"
  [[ "$revision" == "$release_sha" ]] || fail "release_mismatch"
done
ops_images="$("${compose[@]}" config --format json | jq -er '[.services["kith-inn-cms-migrate"].image, .services["kith-inn-cms-provision"].image] | unique | select(length == 1) | .[]')" || fail "release_mismatch"
ops_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$ops_images")" || fail "release_mismatch"
[[ "$ops_revision" == "$release_sha" ]] || fail "release_mismatch"

host_port() {
  local binding
  binding="$("${compose[@]}" port "$1" "$2")" || fail "invalid_configuration"
  printf '%s' "${binding##*:}"
}
cms_port="$(host_port kith-inn-cms 3304)"
be_port="$(host_port kith-inn-be 3310)"
h5_port="$(host_port kith-inn-h5 8080)"
retry cms_liveness curl -fsS -m 10 "http://127.0.0.1:$cms_port/api/health" || exit 1
retry cms_readiness "${compose[@]}" exec -T kith-inn-cms node -e \
  "fetch('http://127.0.0.1:3304/api/ready',{headers:{'x-internal-token':process.env.CMS_INTERNAL_TOKEN}}).then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true||b.service!=='cms')process.exit(1)}).catch(()=>process.exit(1))" || exit 1
retry be_liveness curl -fsS -m 10 "http://127.0.0.1:$be_port/" || exit 1
retry be_readiness curl -fsS -m 10 "http://127.0.0.1:$be_port/ready" || exit 1
retry h5 curl -fsS -m 10 "http://127.0.0.1:$h5_port/" || exit 1
retry be_ingress_liveness ingress_release / '.status == "ok"' || exit 1
retry be_ingress_readiness ingress_release /ready '.ok == true and .service == "kith-inn-be"' || exit 1
retry be_ingress_auth_boundary is_unauthorized "$public_be_url/offerings" || exit 1

snapshot() {
  KITH_INN_PROVISIONED_SELLER_ID="$seller_id" "${compose[@]}" run --rm --no-deps \
    -e KITH_INN_PROVISIONED_SELLER_ID kith-inn-cms-migrate \
    ./node_modules/.bin/tsx smoke/business-snapshot-cli.ts 2>/dev/null | tail -n 1
}
before="$(snapshot)" || fail "business_snapshot_failed"
jq -e --arg seller "$seller_id" '
  .schemaVersion == 1 and .sellerId == $seller and .counts.sellers == 1 and .counts.offerings > 0 and
  (.recordCount | type == "number") and (.digest | test("^sha256:[0-9a-f]{64}$"))
' <<<"$before" >/dev/null || fail "business_snapshot_failed"

smoke_result="$(
  KITH_INN_TRIAL_OPENID="$openid" KITH_INN_PROVISIONED_SELLER_ID="$seller_id" \
  KITH_INN_BE_SMOKE_URL="http://127.0.0.1:3310" KITH_INN_SMOKE_TTL_SECONDS=60 \
    "${compose[@]}" exec -T -e KITH_INN_TRIAL_OPENID -e KITH_INN_PROVISIONED_SELLER_ID \
    -e KITH_INN_BE_SMOKE_URL -e KITH_INN_SMOKE_TTL_SECONDS \
    kith-inn-be node dist/smoke-deployed.js
)" || fail "authenticated_read_failed"
jq -e --arg seller "$seller_id" '
  .status == "passed" and (.sellerId | tostring) == $seller and
  (.offeringCount | type == "number") and .offeringCount > 0 and .ttlSeconds == 60
' <<<"$smoke_result" >/dev/null || fail "authenticated_read_failed"

after="$(snapshot)" || fail "business_snapshot_failed"
[[ "$before" == "$after" ]] || fail "business_write_detected"
duration_ms="$(( ($(date +%s) - started_seconds) * 1000 ))"
jq -cn --arg releaseSha "$release_sha" --argjson durationMs "$duration_ms" '{
  releaseSha: $releaseSha,
  checks: ["cms_liveness","cms_readiness","be_liveness","be_readiness","h5","be_ingress_liveness","be_ingress_readiness","be_ingress_auth_boundary","operator","jwt","offerings"],
  writeCount: 0,
  redactionPassed: true,
  durationMs: $durationMs,
  status: "passed"
}'
