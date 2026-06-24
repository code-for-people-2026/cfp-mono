#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-http://127.0.0.1:3302}"

# Containers need a few seconds after `up -d` before the app accepts
# connections, so poll each endpoint with a bounded retry instead of
# failing on the first refused connection.
RETRIES="${SMOKE_RETRIES:-30}"
SLEEP="${SMOKE_SLEEP:-2}"

check() {
  local url="$1"
  local attempt=1
  until curl -fsS -m 10 "$url" >/dev/null 2>&1; do
    if [ "$attempt" -ge "$RETRIES" ]; then
      echo "Smoke test failed: $url did not respond after $(((RETRIES - 1) * SLEEP))s" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep "$SLEEP"
  done
}

check "$SITE_URL/"
check "$SITE_URL/api/health"

echo "Smoke tests passed"
