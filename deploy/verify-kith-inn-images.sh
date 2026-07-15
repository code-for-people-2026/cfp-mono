#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'kith-inn image verification failed: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 4 ]] || die "usage: $0 <40-char-release-sha> <cms-image> <be-image> <h5-image>"
release_sha=$1
cms_image=$2
be_image=$3
h5_image=$4
[[ $release_sha =~ ^[0-9a-f]{40}$ ]] || die "release SHA must be 40 lowercase hex characters"
command -v docker >/dev/null || die "docker is required"
command -v curl >/dev/null || die "curl is required"

tmp_dir=$(mktemp -d)
containers=()
cleanup() {
  if ((${#containers[@]})); then docker rm -f "${containers[@]}" >/dev/null 2>&1 || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

wait_healthy() {
  local name=$1 state
  for _ in {1..45}; do
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$name")
    case $state in
      healthy) return ;;
      unhealthy) docker logs "$name" >&2 || true; die "$name became unhealthy" ;;
    esac
    sleep 1
  done
  docker logs "$name" >&2 || true
  die "$name did not become healthy"
}

host_port() {
  docker port "$1" "$2/tcp" | tail -n 1 | sed 's/.*://'
}

layers_match() {
  local root=$1 pattern=$2 layer
  while IFS= read -r -d '' layer; do
    if grep -aE -- "$pattern" "$layer" >/dev/null; then return 0; fi
  done < <(find "$root" -name layer.tar -print0)
  return 1
}

scan_image() {
  local role=$1 image=$2 archive="$tmp_dir/$role.tar" unpacked="$tmp_dir/$role"
  local metadata_pattern='(PAYLOAD_SECRET|JWT_SECRET|CMS_INTERNAL_TOKEN|WX_SECRET|DEEPSEEK_API_KEY|KITH_INN_TRIAL_OPENID|KITH_INN_MINIPROGRAM_PRIVATE_KEY)='
  local layer_pattern='-----BEGIN (OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|192\.168\.31\.120|taozi-dev-openid'

  if { docker image inspect "$image"; docker history --no-trunc "$image"; } \
    | grep -aE -- "$metadata_pattern" >/dev/null; then
    die "$role image metadata/history contains secret assignment"
  fi
  mkdir -p "$unpacked"
  docker image save -o "$archive" "$image"
  tar -xf "$archive" -C "$unpacked"
  if layers_match "$unpacked" "$layer_pattern"; then
    die "$role image layers contain a common secret or local fixture"
  fi
  if [[ $role == h5 ]] && layers_match "$unpacked" \
    'https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+)'; then
    die "h5 image contains a local-network URL"
  fi
}

for pair in "cms:$cms_image" "be:$be_image" "h5:$h5_image"; do
  role=${pair%%:*}
  image=${pair#*:}
  docker image inspect "$image" >/dev/null || die "$role image not found: $image"
  [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$release_sha" ]] \
    || die "$role image revision label does not match $release_sha"
  [[ $(docker image inspect --format '{{json .Config.Healthcheck.Test}}' "$image") != null ]] \
    || die "$role image has no healthcheck"
  uid=$(docker run --rm --entrypoint sh "$image" -c 'id -u')
  [[ $uid =~ ^[0-9]+$ && $uid -ne 0 ]] || die "$role image runs as root"
  scan_image "$role" "$image"
done

cms_name="kith-image-verify-cms-$$"
containers+=("$cms_name")
docker run -d --name "$cms_name" --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1::3304 \
  -e PAYLOAD_DATABASE_URL=postgresql://verify:runtime-password@postgres.runtime.internal:5432/cfp \
  -e PAYLOAD_SECRET=runtime-payload-value-0123456789 \
  -e JWT_SECRET=runtime-jwt-value-0123456789 \
  -e CMS_INTERNAL_TOKEN=runtime-internal-value-0123456789 \
  "$cms_image" >/dev/null
wait_healthy "$cms_name"
curl -fsS "http://127.0.0.1:$(host_port "$cms_name" 3304)/api/health" >/dev/null

be_name="kith-image-verify-be-$$"
containers+=("$be_name")
docker run -d --name "$be_name" --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1::3310 \
  -e JWT_SECRET=runtime-jwt-value-0123456789 \
  -e CMS_BASE_URL=http://cms.runtime.internal:3304 \
  -e CMS_INTERNAL_TOKEN=runtime-internal-value-0123456789 \
  -e WX_APPID=wx-runtime-appid -e WX_SECRET=runtime-wx-value-0123456789 \
  -e DEEPSEEK_API_KEY=runtime-deepseek-value-0123456789 \
  "$be_image" >/dev/null
wait_healthy "$be_name"
curl -fsS "http://127.0.0.1:$(host_port "$be_name" 3310)/" >/dev/null

h5_name="kith-image-verify-h5-$$"
containers+=("$h5_name")
docker run -d --name "$h5_name" --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1::8080 "$h5_image" >/dev/null
wait_healthy "$h5_name"
h5_url="http://127.0.0.1:$(host_port "$h5_name" 8080)"
curl -fsS "$h5_url/" -o "$tmp_dir/index.html"
curl -fsS "$h5_url/verify/spa/fallback" -o "$tmp_dir/fallback.html"
cmp -s "$tmp_dir/index.html" "$tmp_dir/fallback.html" || die "h5 SPA fallback differs from index.html"
curl -fsS "$h5_url/release.json" -o "$tmp_dir/release.json"
grep -Fq "\"releaseSha\":\"$release_sha\"" "$tmp_dir/release.json" \
  || die "h5 release trace does not match $release_sha"

printf 'kith-inn images verified for %s\n' "$release_sha"
