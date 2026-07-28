#!/usr/bin/env bash
set -euo pipefail

peer_workflow="${1:?peer workflow filename is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"

[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]] || {
  echo "GITHUB_RUN_ID must be numeric." >&2
  exit 1
}

poll_seconds="${PRODUCTION_RUN_POLL_SECONDS:-15}"
settle_seconds="${PRODUCTION_RUN_SETTLE_SECONDS:-5}"
[[ "$poll_seconds" =~ ^[0-9]+$ && "$settle_seconds" =~ ^[0-9]+$ ]] || {
  echo "Production run polling intervals must be non-negative integers." >&2
  exit 1
}

active_statuses='["queued","in_progress","waiting","pending","requested"]'
empty_passes=0
while (( empty_passes < 2 )); do
  runs_json="$(gh run list --repo "$GITHUB_REPOSITORY" --workflow "$peer_workflow" \
    --limit 100 --json databaseId,status)"
  older_run_id="$(jq -r --argjson current "$GITHUB_RUN_ID" --argjson active "$active_statuses" '
    [ .[] as $run
      | select($run.databaseId < $current)
      | select($active | index($run.status))
      | $run.databaseId ]
    | min // empty
  ' <<<"$runs_json")"

  if [[ -z "$older_run_id" ]]; then
    (( empty_passes += 1 ))
    (( empty_passes == 2 )) || sleep "$settle_seconds"
    continue
  fi

  empty_passes=0
  echo "Waiting for older shared-RDS production run $older_run_id from $peer_workflow."
  while true; do
    status="$(gh run view "$older_run_id" --repo "$GITHUB_REPOSITORY" --json status --jq .status)"
    [[ "$active_statuses" == *"\"$status\""* ]] || break
    sleep "$poll_seconds"
  done
done

echo "No older active $peer_workflow run can overlap the shared-RDS deployment."
