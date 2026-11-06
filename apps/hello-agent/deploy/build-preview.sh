#!/usr/bin/env bash
# Use the existing Docker engine; prune only reproducible, unused build cache.
set -euo pipefail
source_root=${1:?usage: build-preview.sh SOURCE_ROOT RELEASE}
release=${2:?release required}
[[ "$release" =~ ^preview-[a-zA-Z0-9_-]+$ ]] || exit 2
exec 9>/var/lock/cfp-hello-agent-deploy.lock
flock -n 9 || { echo 'Another build/deployment/cleanup is in progress' >&2; exit 1; }
if docker image inspect "cfp-hello-agent:$release" >/dev/null 2>&1; then
  echo 'Release tags are immutable; choose a new release name' >&2
  exit 1
fi
free_bytes=$(df -B1 --output=avail /var/lib/docker | tail -1)
(( free_bytes >= 8 * 1024 * 1024 * 1024 )) || { echo 'Build requires at least 8 GiB free; running services were not stopped' >&2; exit 1; }
cleanup() {
  build_status=$?
  trap - EXIT
  set +e
  docker builder prune --all --force --keep-storage 1GB
  cache_status=$?
  if (( build_status != 0 )); then exit "$build_status"; fi
  exit "$cache_status"
}
trap cleanup EXIT
DOCKER_BUILDKIT=1 docker build --network host \
  -f "$source_root/apps/hello-agent/Dockerfile.preview" \
  --label cn.codeforpeople.service=hello-agent \
  --label cn.codeforpeople.release="$release" \
  -t "cfp-hello-agent:$release" "$source_root"
