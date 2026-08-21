#!/usr/bin/env bash
set -euo pipefail

: "${FAKE_VERCEL_LOG:?FAKE_VERCEL_LOG is required}"
printf 'api ' >>"$FAKE_VERCEL_LOG"
printf '%q ' "$@" >>"$FAKE_VERCEL_LOG"
printf '\n' >>"$FAKE_VERCEL_LOG"

printf '{"id":"%s","name":"%s"}\n' \
  "${FAKE_VERCEL_PROJECT_ID:-prj_fixture}" \
  "${FAKE_VERCEL_PROJECT_NAME:-cfp-website-preview-fixture}"
