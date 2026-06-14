#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-http://127.0.0.1:3300}"
MINIAPP_H5_URL="${MINIAPP_H5_URL:-http://127.0.0.1:3301}"

curl -fsS "$SITE_URL/" >/dev/null
curl -fsS "$SITE_URL/api/health" >/dev/null
curl -fsS "$SITE_URL/api/miniapp/demo" >/dev/null
curl -fsS "$MINIAPP_H5_URL/" >/dev/null

echo "Smoke tests passed"

