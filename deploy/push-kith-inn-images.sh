#!/usr/bin/env bash
set -euo pipefail

release_sha="${RELEASE_SHA:-}"
github_output="${GITHUB_OUTPUT:-}"
docker_bin="${DOCKER_BIN:-docker}"
images=(
  "cms_digest:${KITH_INN_CMS_IMAGE:-}"
  "cms_ops_digest:${KITH_INN_CMS_OPS_IMAGE:-}"
  "be_digest:${KITH_INN_BE_IMAGE:-}"
  "h5_digest:${KITH_INN_H5_IMAGE:-}"
)

fail() {
  printf 'kith-inn image push failed: %s\n' "$1" >&2
  exit 1
}

[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_SHA must be a full lowercase commit SHA"
[[ -n "$github_output" ]] || fail "GITHUB_OUTPUT is required"
command -v "$docker_bin" >/dev/null || fail "docker command is unavailable"

for entry in "${images[@]}"; do
  image="${entry#*:}"
  [[ -n "$image" && "$image" == *":$release_sha" ]] || fail "all image tags must end with RELEASE_SHA"
  for other in "${images[@]}"; do
    [[ "$entry" == "$other" || "$image" != "${other#*:}" ]] || fail "image tags must be unique"
  done
done

results=""
for entry in "${images[@]}"; do
  key="${entry%%:*}"
  image="${entry#*:}"
  if ! push_output="$("$docker_bin" push "$image" 2>&1)"; then
    fail "$key push command failed"
  fi
  digest="$(sed -nE 's/^.*digest: (sha256:[0-9a-f]{64})( size: [0-9]+)?$/\1/p' <<< "$push_output" | sort -u)"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$key registry digest is missing or ambiguous"
  results+="$key=$digest"$'\n'
done

printf '%s' "$results" >> "$github_output"
echo "pushed four immutable kith-inn image digests"
