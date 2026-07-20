#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/push-website-image.sh"
fake="$root/deploy/tests/fake-docker-push.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sha=1234567890abcdef1234567890abcdef12345678
run_push() {
  local output="$1"; shift; : > "$output"
  env RELEASE_SHA="$sha" WEBSITE_IMAGE_TAG="registry.example/cfp-website:$sha" \
    GITHUB_OUTPUT="$output" DOCKER_BIN="$fake" "$@" bash "$script"
}

run_push "$tmp/success"
grep -qx "website_digest=sha256:$(printf '%063d5' 0)" "$tmp/success"
for mode in fail missing; do
  if run_push "$tmp/$mode" "FAKE_DOCKER_MODE=$mode" >"$tmp/$mode.log" 2>&1; then exit 1; fi
  [[ ! -s "$tmp/$mode" ]]
done
if env RELEASE_SHA=short GITHUB_OUTPUT="$tmp/invalid" DOCKER_BIN="$fake" bash "$script" >/dev/null 2>&1; then exit 1; fi
echo 'website image push tests passed'
