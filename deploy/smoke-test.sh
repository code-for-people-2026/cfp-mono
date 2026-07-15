#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-http://127.0.0.1:3302}"
target="${1:-website}"

# Containers need a few seconds after `up -d` before the app accepts
# connections, so poll each endpoint with a bounded retry instead of
# failing on the first refused connection.
RETRIES="${SMOKE_RETRIES:-30}"
SLEEP="${SMOKE_SLEEP:-2}"

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
  retry website curl -fsS -m 10 "$SITE_URL/"
  retry website_health curl -fsS -m 10 "$SITE_URL/api/health"
  echo "Smoke tests passed"
  exit 0
fi
[[ "$target" == "kith-inn" ]] || { echo '{"status":"failed","error":"invalid_target"}' >&2; exit 1; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${KITH_INN_COMPOSE_FILE:-$repo_root/deploy/docker-compose.kith-inn.prod.yml}"
env_file="${KITH_INN_ENV_FILE:-$repo_root/deploy/.env.verify}"
release_sha="${RELEASE_SHA:-}"
seller_id="${KITH_INN_PROVISIONED_SELLER_ID:-}"
openid="${KITH_INN_TRIAL_OPENID:-}"
fail() { printf '{"status":"failed","error":"%s"}\n' "$1" >&2; exit 1; }
for command in curl docker jq; do command -v "$command" >/dev/null || fail "missing_command"; done
[[ -f "$compose_file" && -f "$env_file" ]] || fail "invalid_configuration"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ && -n "$seller_id" && -n "$openid" ]] || fail "invalid_configuration"
compose=(docker compose -f "$compose_file" --env-file "$env_file")
started_seconds="$(date +%s)"

for service in kith-inn-cms-migrate kith-inn-cms-provision kith-inn-cms kith-inn-be kith-inn-h5; do
  image_id="$("${compose[@]}" images -q "$service")"
  [[ -n "$image_id" ]] || fail "release_mismatch"
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_id")"
  [[ "$revision" == "$release_sha" ]] || fail "release_mismatch"
done

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
  checks: ["cms_liveness","cms_readiness","be_liveness","be_readiness","h5","operator","jwt","offerings"],
  writeCount: 0,
  redactionPassed: true,
  durationMs: $durationMs,
  status: "passed"
}'
