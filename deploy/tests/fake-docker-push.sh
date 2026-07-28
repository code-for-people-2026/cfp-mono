#!/usr/bin/env bash
set -euo pipefail

[[ "$1" == push ]]
case "${FAKE_DOCKER_MODE:-ok}" in
  fail) exit 1 ;;
  missing) echo "push completed without a registry digest"; exit 0 ;;
esac

case "$2" in
  *cfp-website*) suffix=5 ;;
  *) exit 2 ;;
esac
printf '%s: digest: sha256:%063d%s size: 1\n' "$2" 0 "$suffix"
