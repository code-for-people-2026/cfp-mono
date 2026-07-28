#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-http://127.0.0.1:3302}"
SITE_URL="${SITE_URL%/}"
target="${1:-website}"
RETRIES="${SMOKE_RETRIES:-30}"
SLEEP="${SMOKE_SLEEP:-2}"

fail() {
  printf '{"status":"failed","error":"%s"}\n' "$1" >&2
  exit 1
}

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

[[ "$target" == website ]] || fail "invalid_target"
release_sha="${RELEASE_SHA:-}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "invalid_configuration"
for command in curl jq; do
  command -v "$command" >/dev/null || fail "missing_command"
done

website_curl=(curl -fsS -m 10)
if [[ -n "${SITE_CONNECT_TO:-}" ]]; then
  website_curl+=(--connect-to "$SITE_CONNECT_TO")
fi

website_release() {
  local endpoint="$1" contract="$2"
  "${website_curl[@]}" "$SITE_URL$endpoint" |
    jq -e --arg releaseSha "$release_sha" ".releaseSha == \$releaseSha and ($contract)"
}

retry website "${website_curl[@]}" "$SITE_URL/"
retry website_health website_release /api/health '.status == "ok"'
retry website_readiness website_release /api/ready '.ok == true and .service == "website"'
echo "Smoke tests passed"
