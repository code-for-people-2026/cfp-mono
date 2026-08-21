#!/usr/bin/env bash
set -euo pipefail

: "${FAKE_VERCEL_LOG:?FAKE_VERCEL_LOG is required}"
printf '%q ' "$@" >>"$FAKE_VERCEL_LOG"
printf '\n' >>"$FAKE_VERCEL_LOG"

case "${1:-}" in
  curl)
    case "${2:-}" in
      /api/health)
        printf '{"status":"ok","releaseSha":"%s"}\n' "${FAKE_VERCEL_SHA:-unknown}"
        ;;
      /api/ready)
        printf '{"ok":true,"service":"website","releaseSha":"%s"}\n' \
          "${FAKE_VERCEL_SHA:-unknown}"
        ;;
      *)
        exit 1
        ;;
    esac
    ;;
  inspect)
    printf '{"id":"%s","name":"%s"}\n' \
      "${FAKE_VERCEL_DEPLOYMENT_ID:-dpl_fixture}" \
      "${FAKE_VERCEL_DEPLOYMENT_PROJECT_NAME:-cfp-website-preview-fixture}"
    ;;
  remove)
    ;;
  *)
    exit 1
    ;;
esac
