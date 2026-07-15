#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/push-kith-inn-images.sh"
fake="$root/deploy/tests/fake-docker-push.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sha=1234567890abcdef1234567890abcdef12345678

run_push() {
  local output="$1"
  shift
  : > "$output"
  env \
    RELEASE_SHA="$sha" \
    KITH_INN_CMS_IMAGE="registry.example/cfp/kith-inn-cms:$sha" \
    KITH_INN_CMS_OPS_IMAGE="registry.example/cfp/kith-inn-cms-ops:$sha" \
    KITH_INN_BE_IMAGE="registry.example/cfp/kith-inn-be:$sha" \
    KITH_INN_H5_IMAGE="registry.example/cfp/kith-inn-h5:$sha" \
    GITHUB_OUTPUT="$output" DOCKER_BIN="$fake" "$@" bash "$script"
}

run_push "$tmp/success"
grep -qx "cms_digest=sha256:$(printf '%063d1' 0)" "$tmp/success"
grep -qx "cms_ops_digest=sha256:$(printf '%063d2' 0)" "$tmp/success"
grep -qx "be_digest=sha256:$(printf '%063d3' 0)" "$tmp/success"
grep -qx "h5_digest=sha256:$(printf '%063d4' 0)" "$tmp/success"
[[ "$(wc -l < "$tmp/success")" -eq 4 ]]

for mode in fail missing; do
  if run_push "$tmp/$mode" "FAKE_DOCKER_MODE=$mode" > "$tmp/$mode.log" 2>&1; then
    echo "$mode 模式必须失败" >&2
    exit 1
  fi
  [[ ! -s "$tmp/$mode" ]]
done

if env RELEASE_SHA=short GITHUB_OUTPUT="$tmp/invalid-sha" DOCKER_BIN="$fake" bash "$script" > /dev/null 2>&1; then
  echo "短 SHA 必须失败" >&2
  exit 1
fi

if env \
  RELEASE_SHA="$sha" GITHUB_OUTPUT="$tmp/duplicate" DOCKER_BIN="$fake" \
  KITH_INN_CMS_IMAGE="registry.example/same:$sha" \
  KITH_INN_CMS_OPS_IMAGE="registry.example/same:$sha" \
  KITH_INN_BE_IMAGE="registry.example/be:$sha" \
  KITH_INN_H5_IMAGE="registry.example/h5:$sha" \
  bash "$script" > /dev/null 2>&1; then
  echo "重复 image tag 必须失败" >&2
  exit 1
fi
[[ ! -s "$tmp/duplicate" ]]

echo "kith-inn image push tests passed"
