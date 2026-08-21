#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYMENT_URL:?DEPLOYMENT_URL is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

vercel_bin="${VERCEL_BIN:-vercel}"
retries="${PREVIEW_RETRIES:-12}"
sleep_seconds="${PREVIEW_SLEEP:-5}"

if [[ ! "$DEPLOYMENT_URL" =~ ^https://[A-Za-z0-9.-]+\.vercel\.app/?$ ]]; then
  echo "invalid_preview_url" >&2
  exit 1
fi
if [[ ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid_release_sha" >&2
  exit 1
fi
if [[ ! "$retries" =~ ^[1-9][0-9]*$ ]] || [[ ! "$sleep_seconds" =~ ^[0-9]+$ ]]; then
  echo "invalid_retry_configuration" >&2
  exit 1
fi

for ((attempt = 1; attempt <= retries; attempt += 1)); do
  health=""
  ready=""
  if health="$($vercel_bin curl /api/health --deployment "$DEPLOYMENT_URL" 2>/dev/null)" &&
    ready="$($vercel_bin curl /api/ready --deployment "$DEPLOYMENT_URL" 2>/dev/null)" &&
    jq -e --arg sha "$RELEASE_SHA" \
      '.status == "ok" and .releaseSha == $sha' <<<"$health" >/dev/null &&
    jq -e --arg sha "$RELEASE_SHA" \
      '.ok == true and .service == "website" and .releaseSha == $sha' <<<"$ready" >/dev/null; then
    echo "Vercel website preview is ready: $DEPLOYMENT_URL"
    exit 0
  fi

  if ((attempt < retries)); then
    sleep "$sleep_seconds"
  fi
done

echo "website_preview_unavailable" >&2
exit 1
