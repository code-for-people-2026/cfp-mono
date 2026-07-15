#!/usr/bin/env bash
set -euo pipefail

[[ "$1" == push ]]
case "${FAKE_DOCKER_MODE:-ok}" in
  fail) exit 1 ;;
  missing) echo "push completed without a registry digest"; exit 0 ;;
esac

case "$2" in
  *cms-ops*) suffix=2 ;;
  *cms*) suffix=1 ;;
  *be*) suffix=3 ;;
  *h5*) suffix=4 ;;
  *) exit 2 ;;
esac
printf '%s: digest: sha256:%063d%s size: 1\n' "$2" 0 "$suffix"
