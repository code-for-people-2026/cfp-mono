#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verify="$root/deploy/verify-website-preview.sh"
remove="$root/deploy/remove-vercel-preview.sh"
fake="$root/deploy/tests/fake-vercel.sh"
ci_workflow="$root/.github/workflows/ci.yml"
cleanup_workflow="$root/.github/workflows/website-preview-cleanup.yml"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
url="https://cfp-website-preview-fixture.vercel.app"
: >"$tmp/vercel.log"

FAKE_VERCEL_LOG="$tmp/vercel.log" FAKE_VERCEL_SHA="$sha" VERCEL_BIN="$fake" \
  DEPLOYMENT_URL="$url" RELEASE_SHA="$sha" PREVIEW_RETRIES=1 PREVIEW_SLEEP=0 \
  bash "$verify" >"$tmp/verify.out"
grep -q 'Vercel website preview is ready' "$tmp/verify.out"
grep -q 'curl /api/health' "$tmp/vercel.log"
grep -q 'curl /api/ready' "$tmp/vercel.log"

if FAKE_VERCEL_LOG="$tmp/vercel.log" FAKE_VERCEL_SHA="$(printf 'b%.0s' {1..40})" \
  VERCEL_BIN="$fake" DEPLOYMENT_URL="$url" RELEASE_SHA="$sha" PREVIEW_RETRIES=1 \
  PREVIEW_SLEEP=0 bash "$verify" >/dev/null 2>"$tmp/mismatch.err"; then
  exit 1
fi
grep -q 'website_preview_unavailable' "$tmp/mismatch.err"

: >"$tmp/vercel.log"
FAKE_VERCEL_LOG="$tmp/vercel.log" FAKE_VERCEL_PROJECT_ID=prj_expected \
  FAKE_VERCEL_DEPLOYMENT_ID=dpl_expected VERCEL_BIN="$fake" DEPLOYMENT_URL="$url" \
  VERCEL_PROJECT_ID=prj_expected bash "$remove" >"$tmp/remove.out"
grep -q 'inspect https://cfp-website-preview-fixture.vercel.app --format=json' "$tmp/vercel.log"
grep -q 'remove dpl_expected --yes' "$tmp/vercel.log"

: >"$tmp/vercel.log"
if FAKE_VERCEL_LOG="$tmp/vercel.log" FAKE_VERCEL_PROJECT_ID=prj_other \
  VERCEL_BIN="$fake" DEPLOYMENT_URL="$url" VERCEL_PROJECT_ID=prj_expected \
  bash "$remove" >/dev/null 2>"$tmp/project.err"; then
  exit 1
fi
grep -q 'vercel_project_mismatch' "$tmp/project.err"
! grep -q '^remove ' "$tmp/vercel.log"

grep -q '^  website-preview:' "$ci_workflow"
grep -q 'WEBSITE_AFFECTED: \${{ needs.verify.outputs.website_affected }}' "$ci_workflow"
grep -q 'github.event.pull_request.head.repo.full_name' "$ci_workflow"
grep -q 'github.event.pull_request.head.sha' "$ci_workflow"
grep -q '^      issues: write$' "$ci_workflow"
grep -q 'vercel@56\.3\.2' "$ci_workflow"
grep -q 'vercel deploy' "$ci_workflow"
grep -q 'vercel deploy --yes --target=preview' "$ci_workflow"
grep -q -- '--build-env RELEASE_SHA="$PR_HEAD_SHA"' "$ci_workflow"
! grep -q 'vercel deploy .*--prod' "$ci_workflow"
grep -q 'verify-website-preview.sh' "$ci_workflow"
grep -q "failure() && steps.deploy.outputs.url != ''" "$ci_workflow"
grep -q '<!-- cfp-website-preview -->' "$ci_workflow"
! grep -q 'pull_request_target' "$ci_workflow"

grep -q 'types: \[closed\]' "$cleanup_workflow"
grep -q 'github.event.pull_request.head.repo.full_name' "$cleanup_workflow"
grep -q '^  pull-requests: read$' "$cleanup_workflow"
grep -q 'github.event.repository.default_branch' "$cleanup_workflow"
grep -q 'remove-vercel-preview.sh' "$cleanup_workflow"
! grep -q 'pull_request_target' "$cleanup_workflow"

echo "website preview tests passed"
