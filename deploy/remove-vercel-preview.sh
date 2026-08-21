#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYMENT_URL:?DEPLOYMENT_URL is required}"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"

vercel_bin="${VERCEL_BIN:-vercel}"
curl_bin="${CURL_BIN:-curl}"
vercel_api="${VERCEL_API:-https://api.vercel.com}"
if [[ ! "$DEPLOYMENT_URL" =~ ^https://[A-Za-z0-9.-]+\.vercel\.app/?$ ]]; then
  echo "invalid_preview_url" >&2
  exit 1
fi
if [[ ! "$VERCEL_PROJECT_ID" =~ ^prj_[A-Za-z0-9]+$ ]]; then
  echo "invalid_vercel_project_id" >&2
  exit 1
fi
if [[ ! "$VERCEL_ORG_ID" =~ ^team_[A-Za-z0-9]+$ ]]; then
  echo "invalid_vercel_org_id" >&2
  exit 1
fi

# `vercel inspect` emits valid JSON but exits non-zero for an ERROR deployment.
# Keep the JSON and validate it below so failed builds can still be cleaned up.
deployment="$($vercel_bin inspect "$DEPLOYMENT_URL" --format=json || true)"
deployment_id="$(jq -r '.id // empty' <<<"$deployment")"
deployment_project_name="$(jq -r '.name // empty' <<<"$deployment")"
project="$($curl_bin --silent --show-error --fail \
  --header "Authorization: Bearer $VERCEL_TOKEN" \
  "$vercel_api/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_ORG_ID")"
actual_project_id="$(jq -r '.id // empty' <<<"$project")"
expected_project_name="$(jq -r '.name // empty' <<<"$project")"

if [[ ! "$deployment_id" =~ ^dpl_[A-Za-z0-9]+$ ]]; then
  echo "invalid_vercel_deployment_id" >&2
  exit 1
fi
if [[ "$actual_project_id" != "$VERCEL_PROJECT_ID" ]] ||
  [[ -z "$expected_project_name" ]] ||
  [[ "$deployment_project_name" != "$expected_project_name" ]]; then
  echo "vercel_project_mismatch" >&2
  exit 1
fi

$vercel_bin remove "$deployment_id" --yes
echo "Removed Vercel preview deployment: $deployment_id"
