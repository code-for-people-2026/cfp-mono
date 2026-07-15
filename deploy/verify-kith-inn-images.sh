#!/usr/bin/env bash
set -euo pipefail

release_sha="${RELEASE_SHA:-}"
cms_image="${KITH_INN_CMS_IMAGE:-}"
be_image="${KITH_INN_BE_IMAGE:-}"
h5_image="${KITH_INN_H5_IMAGE:-}"

fail() {
  printf 'kith-inn image verification failed: %s\n' "$1" >&2
  exit 1
}

[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_SHA must be a full lowercase commit SHA"
[[ -n "$cms_image" && -n "$be_image" && -n "$h5_image" ]] || fail "all three image names are required"
command -v docker >/dev/null || fail "docker is required"

containers=()
last_container=""
cleanup() {
  if ((${#containers[@]})); then
    docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

assert_image_contract() {
  local role="$1" image="$2" user revision config
  docker image inspect "$image" >/dev/null 2>&1 || fail "$role image is missing"
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
  [[ "$revision" == "$release_sha" ]] || fail "$role image revision label does not match RELEASE_SHA"
  user="$(docker image inspect --format '{{ .Config.User }}' "$image")"
  case "$user" in
    ""|root|0|0:0) fail "$role image must declare a non-root user" ;;
  esac
  config="$(docker image inspect --format '{{json .Config.Healthcheck}}' "$image")"
  [[ "$config" != "null" && "$config" != "<nil>" ]] || fail "$role image must declare a healthcheck"
  if docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" |
    grep -Eq '^(PAYLOAD_SECRET|JWT_SECRET|CMS_INTERNAL_TOKEN|WX_SECRET|DEEPSEEK_API_KEY|KITH_INN_TRIAL_OPENID)='; then
    fail "$role image config contains a secret-bearing environment variable"
  fi
}

start_container() {
  local role="$1" image="$2"
  shift 2
  local name="kith-inn-image-verify-${role}-$$"
  docker run -d --name "$name" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m "$@" "$image" >/dev/null
  containers+=("$name")
  last_container="$name"
}

wait_healthy() {
  local role="$1" name="$2" status
  for _ in $(seq 1 30); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$name")"
    [[ "$status" == "healthy" ]] && return
    if [[ "$(docker inspect --format '{{.State.Status}}' "$name")" == "exited" ]]; then
      docker logs "$name" >&2 || true
      fail "$role container exited before becoming healthy"
    fi
    sleep 2
  done
  docker logs "$name" >&2 || true
  fail "$role container did not become healthy"
}

assert_runtime_contract() {
  local role="$1" name="$2"
  [[ "$(docker exec "$name" id -u)" != "0" ]] || fail "$role container runs as root"
  [[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$name")" == "true" ]] || fail "$role root filesystem is writable"
}

assert_no_forbidden_content() {
  local role="$1" name="$2" path="$3" pattern
  pattern='192\.168\.31\.120|taozi-(v1-)?dev-openid|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
  if docker exec "$name" sh -c "grep -R -a -E '$pattern' '$path' 2>/dev/null" >/dev/null; then
    fail "$role runtime files contain a forbidden secret or local fixture string"
  fi
}

assert_image_contract cms "$cms_image"
assert_image_contract be "$be_image"
assert_image_contract h5 "$h5_image"

start_container cms "$cms_image" \
  -e NODE_ENV=production \
  -e PAYLOAD_DB_PUSH=false \
  -e PAYLOAD_DATABASE_URL=postgresql://cms:local-validation@rds.internal/cfp \
  -e PAYLOAD_SECRET=payload-7f19c4a2 \
  -e JWT_SECRET=jwt-7f19c4a2 \
  -e CMS_INTERNAL_TOKEN=internal-7f19c4a2
cms_container="$last_container"
start_container be "$be_image" \
  -e NODE_ENV=production \
  -e JWT_SECRET=jwt-7f19c4a2 \
  -e CMS_BASE_URL=http://cms:3304 \
  -e CMS_INTERNAL_TOKEN=internal-7f19c4a2 \
  -e WX_APPID=wx7f19c4a2 \
  -e WX_SECRET=wx-7f19c4a2 \
  -e DEEPSEEK_API_KEY=sk-7f19c4a2
be_container="$last_container"
start_container h5 "$h5_image"
h5_container="$last_container"

wait_healthy cms "$cms_container"
wait_healthy be "$be_container"
wait_healthy h5 "$h5_container"
assert_runtime_contract cms "$cms_container"
assert_runtime_contract be "$be_container"
assert_runtime_contract h5 "$h5_container"

docker exec "$h5_container" sh -c \
  'test "$(wget -qO- http://127.0.0.1:8080/orders/example)" = "$(cat /usr/share/nginx/html/index.html)"' ||
  fail "h5 SPA fallback does not serve index.html"
if docker exec "$h5_container" find /usr/share/nginx/html -name '*.map' -print -quit | grep -q .; then
  fail "h5 runtime contains source maps"
fi
if docker exec "$h5_container" grep -R -a -F '/auth/dev-login' /usr/share/nginx/html >/dev/null 2>&1; then
  fail "h5 runtime contains dev-login"
fi

assert_no_forbidden_content cms "$cms_container" /app
assert_no_forbidden_content be "$be_container" /app
assert_no_forbidden_content h5 "$h5_container" /usr/share/nginx/html

printf '{"releaseSha":"%s","cmsImageId":"%s","beImageId":"%s","h5ImageId":"%s","status":"passed"}\n' \
  "$release_sha" \
  "$(docker image inspect --format '{{.Id}}' "$cms_image")" \
  "$(docker image inspect --format '{{.Id}}' "$be_image")" \
  "$(docker image inspect --format '{{.Id}}' "$h5_image")"
