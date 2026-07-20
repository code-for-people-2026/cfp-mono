#!/usr/bin/env bash
set -euo pipefail

release_sha="${RELEASE_SHA:-}"
image="${WEBSITE_IMAGE_TAG:-}"
github_output="${GITHUB_OUTPUT:-}"
docker_bin="${DOCKER_BIN:-docker}"
fail() { printf 'website image push failed: %s\n' "$1" >&2; exit 1; }

[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_SHA must be a full lowercase commit SHA"
[[ -n "$github_output" && "$image" == *":$release_sha" ]] || fail "image tag or output is invalid"
command -v "$docker_bin" >/dev/null || fail "docker command is unavailable"

if ! push_output="$("$docker_bin" push "$image" 2>&1)"; then
  fail "push command failed"
fi
digest="$(sed -nE 's/^.*digest: (sha256:[0-9a-f]{64})( size: [0-9]+)?$/\1/p' \
  <<< "$push_output" | sort -u)"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "registry digest is missing or ambiguous"
printf 'website_digest=%s\n' "$digest" >> "$github_output"
echo 'pushed immutable website image digest'
