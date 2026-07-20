#!/usr/bin/env bash
set -euo pipefail

url=""
write_out=false
edge=false
for arg in "$@"; do
  [[ "$arg" == http://* || "$arg" == https://* ]] && url="$arg"
  [[ "$arg" == '%{http_code} %{redirect_url}' ]] && write_out=true
  [[ "$arg" == --connect-to ]] && edge=true
done

mode="${FAKE_CUTOVER_MODE:-success}"
sha="${FAKE_RELEASE_SHA:?FAKE_RELEASE_SHA is required}"
if [[ "$url" == *':3302/'* ]]; then
  [[ "$mode" == exposed ]] && exit 0
  exit 52
fi
[[ "$mode" == edge-failure && "$edge" == true ]] && exit 22
if [[ "$write_out" == true ]]; then
  if [[ "$mode" == bad-redirect ]]; then
    printf '302 https://codeforpeople.cn/cutover-probe?source=precutover'
  else
    printf '308 https://www.codeforpeople.cn/cutover-probe?source=precutover'
  fi
elif [[ "$url" == */api/health ]]; then
  [[ "$mode" == release-mismatch ]] && sha=0000000000000000000000000000000000000000
  jq -cn --arg sha "$sha" '{status:"ok",releaseSha:$sha}'
elif [[ "$url" == */api/ready ]]; then
  jq -cn --arg sha "$sha" '{ok:true,service:"website",releaseSha:$sha}'
fi
