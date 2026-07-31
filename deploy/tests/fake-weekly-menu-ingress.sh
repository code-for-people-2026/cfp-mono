#!/usr/bin/env bash
set -euo pipefail

output_file=""
write_format=""
url="${!#}"
args=("$@")
for ((index = 0; index < ${#args[@]}; index += 1)); do
  case "${args[$index]}" in
    -o) output_file="${args[$((index + 1))]}" ;;
    -w) write_format="${args[$((index + 1))]}" ;;
  esac
done

printf '%s\n' "$url" >>"$FAKE_WEEKLY_LOG"
if [[ -n "${FAKE_WEEKLY_ARGS_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"$FAKE_WEEKLY_ARGS_LOG"
fi

case "$url" in
  */api/health)
    status=200
    body="{\"status\":\"ok\",\"release\":\"${FAKE_WEEKLY_RELEASE}\"}"
    ;;
  */api/ready)
    status=200
    body='{"status":"ready"}'
    ;;
  */api/v1/weekly-menu/bootstrap)
    status=401
    body='{"error":{"code":"UNAUTHORIZED"}}'
    ;;
  *) exit 22 ;;
esac

if [[ -n "$output_file" ]]; then
  printf '%s\n' "$body" >"$output_file"
else
  printf '%s\n' "$body"
fi
[[ "$write_format" != *'%{http_code}'* ]] || printf '%s' "$status"
