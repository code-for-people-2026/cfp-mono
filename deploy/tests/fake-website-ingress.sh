#!/usr/bin/env bash
set -euo pipefail

url="${!#}"
printf '%s\n' "$url" >>"$FAKE_INGRESS_LOG"
if [[ -n "${FAKE_INGRESS_ARGS_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"$FAKE_INGRESS_ARGS_LOG"
fi
case "$url" in
  */api/health) printf '{"status":"ok","releaseSha":"%s"}\n' "$FAKE_INGRESS_SHA" ;;
  */api/ready) printf '{"ok":true,"service":"website","releaseSha":"%s"}\n' "$FAKE_INGRESS_SHA" ;;
  */) printf '<!doctype html>ok\n' ;;
  *) exit 22 ;;
esac
