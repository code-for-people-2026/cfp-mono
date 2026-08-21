#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYMENT_URL:?DEPLOYMENT_URL is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"

vercel_bin="${VERCEL_BIN:-vercel}"
if [[ ! "$DEPLOYMENT_URL" =~ ^https://[A-Za-z0-9.-]+\.vercel\.app/?$ ]]; then
  echo "invalid_preview_url" >&2
  exit 1
fi
if [[ ! "$VERCEL_PROJECT_ID" =~ ^prj_[A-Za-z0-9]+$ ]]; then
  echo "invalid_vercel_project_id" >&2
  exit 1
fi

deployment="$($vercel_bin inspect "$DEPLOYMENT_URL" --format=json)"
deployment_id="$(jq -r '.id // empty' <<<"$deployment")"
actual_project_id="$(jq -r '.projectId // empty' <<<"$deployment")"

if [[ ! "$deployment_id" =~ ^dpl_[A-Za-z0-9]+$ ]]; then
  echo "invalid_vercel_deployment_id" >&2
  exit 1
fi
if [[ "$actual_project_id" != "$VERCEL_PROJECT_ID" ]]; then
  echo "vercel_project_mismatch" >&2
  exit 1
fi

$vercel_bin remove "$deployment_id" --yes
echo "Removed Vercel preview deployment: $deployment_id"
