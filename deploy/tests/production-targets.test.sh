#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
selector="$root/deploy/resolve-production-targets.sh"
website_config_check="$root/deploy/check-website-production-config.sh"
workflow="$root/.github/workflows/deploy-production.yml"
preview_workflow="$root/.github/workflows/deploy-preview.yml"
tmp="$(mktemp -d)"
worktree=""
trap 'if [[ -n "$worktree" ]]; then git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true; fi; rm -rf "$tmp"' EXIT

assert_output() {
  local file="$1" website="$2"
  grep -qx "website=$website" "$file"
}

run_selector() {
  local repo="$1" event="$2" base="$3" head="$4" output="$5"
  : > "$output"
  GITHUB_EVENT_NAME="$event" DEPLOY_BASE="$base" GITHUB_SHA="$head" \
    GITHUB_OUTPUT="$output" REPOSITORY_DIR="$repo" TURBO_BIN="$root/node_modules/.bin/turbo" \
    bash "$selector"
}

synthetic_commit() {
  local path="$1" message="$2"
  mkdir -p "$(dirname "$worktree/$path")"
  printf 'production target fixture\n' > "$worktree/$path"
  git -C "$worktree" add "$path"
  git -C "$worktree" -c user.name=fixture -c user.email=fixture@example.invalid \
    commit -m "$message" --quiet
  git -C "$worktree" rev-parse HEAD
}

if run_selector "$root" workflow_dispatch "" "$(git -C "$root" rev-parse HEAD)" "$tmp/manual" 2>/dev/null; then
  echo "生产 selector 必须拒绝非 push 事件" >&2
  exit 1
fi

run_selector "$root" push "" "$(git -C "$root" rev-parse HEAD)" "$tmp/missing-base"
assert_output "$tmp/missing-base" true
run_selector "$root" push deadbeefdeadbeefdeadbeefdeadbeefdeadbeef \
  "$(git -C "$root" rev-parse HEAD)" "$tmp/unknown-base"
assert_output "$tmp/unknown-base" true

worktree="$tmp/worktree"
git -C "$root" worktree add --detach "$worktree" HEAD >/dev/null
base="$(git -C "$worktree" rev-parse HEAD)"
head="$(synthetic_commit apps/website/.production-target-test 'test: website range')"
run_selector "$worktree" push "$base" "$head" "$tmp/website-range"
assert_output "$tmp/website-range" true

base="$head"
head="$(synthetic_commit apps/community-cooking/.production-target-test 'test: unrelated app range')"
run_selector "$worktree" push "$base" "$head" "$tmp/unrelated-range"
assert_output "$tmp/unrelated-range" false

base="$head"
head="$(synthetic_commit deploy/website-candidate.fixture 'test: website deploy range')"
run_selector "$worktree" push "$base" "$head" "$tmp/website-deploy-range"
assert_output "$tmp/website-deploy-range" true

base="$head"
head="$(synthetic_commit deploy/RUNBOOK.md 'test: deploy documentation range')"
run_selector "$worktree" push "$base" "$head" "$tmp/deploy-docs-range"
assert_output "$tmp/deploy-docs-range" false

base="$head"
head="$(synthetic_commit deploy/.production-target-test 'test: unknown deploy range')"
run_selector "$worktree" push "$base" "$head" "$tmp/shared-range"
assert_output "$tmp/shared-range" true

git -C "$root" worktree remove --force "$worktree" >/dev/null
worktree=""

deploy_job="$(sed -n '/^  deploy:/,$p' "$workflow")"
prepare_job="$(sed -n '/^  prepare:/,/^  deploy:/p' "$workflow")"
! grep -q 'workflow_dispatch' "$workflow"
grep -q '^permissions:' "$workflow"
grep -q 'actions: read' "$workflow"
! grep -q 'StrictHostKeyChecking=no' "$workflow"
grep -q 'needs: \[affected, prepare\]' <<<"$deploy_job"
grep -q 'RELEASE_SHA: \${{ github.sha }}' <<<"$deploy_job"
grep -q 'docker build --build-arg RELEASE_SHA="$RELEASE_SHA"' <<<"$deploy_job"
grep -q 'check-website-production-config.sh' <<<"$prepare_job"
grep -q 'deploy-website-candidate.sh finalize' <<<"$deploy_job"
grep -q 'deploy-website-candidate.sh restore-runtime' <<<"$deploy_job"
grep -q 'SITE_URL: https://www.codeforpeople.cn' <<<"$deploy_job"
grep -q 'docker build --build-arg RELEASE_SHA="${{ github.sha }}"' "$preview_workflow"

website_required=(
  ALIYUN_ACR_REGISTRY ALIYUN_ACR_NAMESPACE ALIYUN_ACR_USERNAME ALIYUN_ACR_PASSWORD
  ALIYUN_ACCESS_KEY_ID ALIYUN_ACCESS_KEY_SECRET ALIYUN_REGION_ID ALIYUN_RDS_INSTANCE_ID
  ECS_SSH_KEY ECS_SSH_KNOWN_HOSTS ECS_HOST ECS_USER DATABASE_URL PAYLOAD_SECRET
  NEXT_PUBLIC_SITE_URL DEEPSEEK_API_KEY
)
website_values=()
for name in "${website_required[@]}"; do
  if [[ "$name" == NEXT_PUBLIC_SITE_URL ]]; then
    website_values+=("$name=https://www.codeforpeople.cn")
  else
    website_values+=("$name=website-sentinel-$name")
  fi
done
: > "$tmp/website-configured"
env "${website_values[@]}" GITHUB_OUTPUT="$tmp/website-configured" \
  bash "$website_config_check" > "$tmp/website-configured.log"
grep -qx 'configured=true' "$tmp/website-configured"
! grep -q 'website-sentinel' "$tmp/website-configured.log"

echo "production target/config tests passed"
