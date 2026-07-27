#!/usr/bin/env bash
set -euo pipefail

release_sha="${RELEASE_SHA:-}"
images=("${KITH_INN_V1_CMS_IMAGE:-}" "${KITH_INN_V1_CMS_OPS_IMAGE:-}" "${KITH_INN_V1_BE_IMAGE:-}")
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid RELEASE_SHA" >&2; exit 1; }
for image in "${images[@]}"; do
  [[ -n "$image" ]] || { echo "all three image names are required" >&2; exit 1; }
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
  user="$(docker image inspect --format '{{ .Config.User }}' "$image")"
  [[ "$revision" == "$release_sha" ]] || { echo "image revision mismatch" >&2; exit 1; }
  [[ -n "$user" && "$user" != "root" && "$user" != "0" ]] || { echo "image must run as non-root" >&2; exit 1; }
  if docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" |
    grep -Eq '^(PAYLOAD_DATABASE_URL|PAYLOAD_SECRET|KITH_INN_V1_JWT_SECRET|KITH_INN_V1_INTERNAL_TOKEN|KITH_INN_V1_OPERATOR_OPENID|WX_SECRET)='; then
    echo "image config contains a secret-bearing environment variable" >&2
    exit 1
  fi
done

container="kith-inn-v1-image-verify-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m -e KITH_INN_V1_JWT_SECRET=fake-image-contract-value "${KITH_INN_V1_BE_IMAGE}" >/dev/null
health_state=starting
for _ in $(seq 1 30); do
  health_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")"
  [[ "$health_state" == healthy ]] && break
  if [[ "$(docker inspect --format '{{.State.Status}}' "$container")" == exited ]]; then
    docker logs "$container" >&2
    echo "BE image exited before becoming healthy" >&2
    exit 1
  fi
  sleep 2
done
[[ "$health_state" == healthy ]] || { docker logs "$container" >&2; echo "BE image healthcheck failed" >&2; exit 1; }
[[ "$(docker exec "$container" id -u)" != 0 ]] || { echo "BE image process runs as root" >&2; exit 1; }
echo "verified three kith-inn-v1 image contracts"
