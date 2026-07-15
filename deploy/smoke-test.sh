#!/usr/bin/env bash
set -euo pipefail

RETRIES="${SMOKE_RETRIES:-30}"
SLEEP="${SMOKE_SLEEP:-2}"

retry() {
  local category="$1"
  shift
  local attempt=1
  until "$@" >/dev/null 2>&1; do
    if [ "$attempt" -ge "$RETRIES" ]; then
      printf '{"status":"failed","error":"%s"}\n' "$category" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep "$SLEEP"
  done
}

if [[ "${1:-website}" != "kith-inn" ]]; then
  SITE_URL="${SITE_URL:-http://127.0.0.1:3302}"
  retry website_unavailable curl -fsS -m 10 "$SITE_URL/"
  retry website_health_failed curl -fsS -m 10 "$SITE_URL/api/health"
  echo "Smoke tests passed"
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${KITH_INN_COMPOSE_ENV_FILE:-$repo_root/deploy/.env.verify}"
export WEBSITE_ENV_FILE="${WEBSITE_ENV_FILE:-./.env.website.verify.example}"
compose=(docker compose -f "$repo_root/deploy/docker-compose.prod.yml" \
  -f "$repo_root/deploy/docker-compose.kith-inn.prod.yml" --env-file "$env_file")
started="$SECONDS"

fail() {
  printf '{"status":"failed","error":"%s"}\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null && command -v curl >/dev/null && command -v jq >/dev/null ||
  fail invalid_configuration
[[ -f "$env_file" && "${RELEASE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail invalid_configuration

snapshot() {
  local raw parsed lines
  raw="$("${compose[@]}" run --rm --no-deps -T kith-inn-cms-migrate \
    ./node_modules/.bin/tsx smoke/snapshot.ts 2>/dev/null)" || fail business_snapshot_unavailable
  parsed="$(printf '%s\n' "$raw" | jq -Rrc '
    fromjson? | select(.status == "captured" and (.counts | type == "object" and length == 15) and
      all(.counts[]; (.count | type == "number" and . >= 0 and floor == .) and
        (.digest | type == "string" and test("^[0-9a-f]{32}$")))) | .counts')"
  lines="$(printf '%s\n' "$parsed" | awk 'NF { n++ } END { print n + 0 }')"
  [[ "$lines" == 1 ]] || fail business_snapshot_unavailable
  printf '%s' "$parsed"
}

before="$(snapshot)"
cms_url="${KITH_INN_CMS_SMOKE_URL:-http://127.0.0.1:3304}"
be_url="${KITH_INN_BE_SMOKE_URL:-http://127.0.0.1:3310}"
h5_url="${KITH_INN_H5_SMOKE_URL:-http://127.0.0.1:3305}"
retry cms_liveness_failed curl -fsS -m 5 "$cms_url/api/health"
retry cms_readiness_failed "${compose[@]}" exec -T kith-inn-cms node -e \
  "fetch('http://127.0.0.1:3304/api/ready',{headers:{'x-internal-token':process.env.CMS_INTERNAL_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
retry be_liveness_failed curl -fsS -m 5 "$be_url/"
retry be_readiness_failed curl -fsS -m 5 "$be_url/ready"
retry h5_unavailable curl -fsS -m 5 "$h5_url/"

for service in kith-inn-cms kith-inn-be kith-inn-h5; do
  actual="$("${compose[@]}" exec -T "$service" sh -c 'printf %s "$RELEASE_SHA"' 2>/dev/null)" ||
    fail release_mismatch
  [[ "$actual" == "$RELEASE_SHA" ]] || fail release_mismatch
done

logs="$("${compose[@]}" logs --no-color --no-log-prefix kith-inn-cms-provision 2>/dev/null)" ||
  fail provision_evidence_invalid
summary="$(printf '%s\n' "$logs" | jq -Rrc '
  fromjson? | select(.project == "kith-inn" and (.status == "provisioned" or .status == "reconciled") and
    (.sellerId | tostring | test("^[1-9][0-9]*$")))')"
lines="$(printf '%s\n' "$summary" | awk 'NF { n++ } END { print n + 0 }')"
[[ "$lines" == 1 ]] || fail provision_evidence_invalid
seller_id="$(printf '%s' "$summary" | jq -er '.sellerId | tostring')" || fail provision_evidence_invalid
trial_openid="$("${compose[@]}" config --format json kith-inn-cms-provision |
  jq -er '.services["kith-inn-cms-provision"].environment.KITH_INN_TRIAL_OPENID | strings | select(length > 0)')" ||
  fail invalid_configuration
unset logs summary

export KITH_INN_TRIAL_OPENID="$trial_openid"
export KITH_INN_PROVISIONED_SELLER_ID="$seller_id"
export KITH_INN_BE_SMOKE_URL=http://127.0.0.1:3310
export KITH_INN_SMOKE_TTL_SECONDS=60
cli="$("${compose[@]}" exec -T -e KITH_INN_TRIAL_OPENID -e KITH_INN_PROVISIONED_SELLER_ID \
  -e KITH_INN_BE_SMOKE_URL -e KITH_INN_SMOKE_TTL_SECONDS kith-inn-be npm run smoke:deployed 2>&1)" || {
  unset KITH_INN_TRIAL_OPENID trial_openid KITH_INN_PROVISIONED_SELLER_ID
  fail authenticated_read_failed
}
unset KITH_INN_TRIAL_OPENID trial_openid KITH_INN_PROVISIONED_SELLER_ID
printf '%s\n' "$cli" | jq -Rre --arg seller "$seller_id" \
  'fromjson? | select(.status == "passed" and (.sellerId | tostring) == $seller and .ttlSeconds <= 60)' \
  >/dev/null || fail authenticated_read_failed

after="$(snapshot)"
[[ "$before" == "$after" ]] || fail write_delta_detected
printf '{"status":"passed","project":"kith-inn","releaseSha":"%s","checks":{"health":true,"authenticatedRead":true,"writeDelta":0},"durationSeconds":%d}\n' \
  "$RELEASE_SHA" "$((SECONDS - started))"
