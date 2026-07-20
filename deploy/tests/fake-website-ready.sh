#!/usr/bin/env bash
set -euo pipefail

sha="$(sed -nE 's/^WEBSITE_IMAGE=.*:([0-9a-f]{40})$/\1/p' "$WEBSITE_REMOTE_ROOT/.env" | head -n 1)"
if [[ "${FAKE_DEPLOY_MODE:-success}" == readiness && "$sha" == "$CANDIDATE_SHA" ]]; then
  exit 22
fi
printf '{"ok":true,"service":"website","releaseSha":"%s"}\n' "$sha"
