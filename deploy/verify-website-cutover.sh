#!/usr/bin/env bash
set -euo pipefail

origin_ip="${WEBSITE_ORIGIN_IP:-}"
cdn_cname="${WEBSITE_CDN_CNAME:-}"
expected_sha="${EXPECTED_RELEASE_SHA:-}"
curl_bin="${CURL_BIN:-curl}"
jq_bin="${JQ_BIN:-jq}"
website_host="www.codeforpeople.cn"
apex_host="codeforpeople.cn"

fail() { printf 'website cutover verification failed: %s\n' "$1" >&2; exit 1; }
command -v "$curl_bin" >/dev/null || fail "curl is unavailable"
command -v "$jq_bin" >/dev/null || fail "jq is unavailable"
[[ "$origin_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "WEBSITE_ORIGIN_IP must be an IPv4 address"
[[ "$cdn_cname" =~ ^[A-Za-z0-9.-]+\.(kunlunsl|kunlunaq)\.com\.?$ ]] ||
  fail "WEBSITE_CDN_CNAME must be an Alibaba Cloud CDN CNAME"
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_RELEASE_SHA must be a full commit SHA"

verify_runtime() {
  local target="$1" connection="$2" response
  local connect_args=()
  if [[ "$connection" == origin ]]; then
    connect_args=(--resolve "$website_host:443:$target")
  else
    connect_args=(--connect-to "$website_host:443:$target:443")
  fi

  "$curl_bin" -fsS --proto '=https' --tlsv1.2 --max-time 15 \
    "${connect_args[@]}" "https://$website_host/" >/dev/null || fail "$connection root is unavailable"
  response="$("$curl_bin" -fsS --proto '=https' --tlsv1.2 --max-time 15 \
    "${connect_args[@]}" "https://$website_host/api/health")" || fail "$connection health is unavailable"
  "$jq_bin" -e --arg sha "$expected_sha" \
    '.status == "ok" and .releaseSha == $sha' <<<"$response" >/dev/null ||
    fail "$connection health release does not match"
  response="$("$curl_bin" -fsS --proto '=https' --tlsv1.2 --max-time 15 \
    "${connect_args[@]}" "https://$website_host/api/ready")" || fail "$connection readiness is unavailable"
  "$jq_bin" -e --arg sha "$expected_sha" \
    '.ok == true and .service == "website" and .releaseSha == $sha' <<<"$response" >/dev/null ||
    fail "$connection readiness does not match"
}

verify_redirect() {
  local scheme="$1" port="$2" result
  result="$("$curl_bin" -sS --proto "=$scheme" --max-time 15 -o /dev/null \
    -w '%{http_code} %{redirect_url}' --resolve "$apex_host:$port:$origin_ip" \
    "$scheme://$apex_host/cutover-probe?source=precutover")" || fail "$scheme apex probe failed"
  [[ "$result" == '308 https://www.codeforpeople.cn/cutover-probe?source=precutover' ]] ||
    fail "$scheme apex redirect is not canonical"
}

verify_edge_redirect() {
  local result canonical_redirect
  canonical_redirect='https://www.codeforpeople.cn/cutover-probe?source=precutover'
  result="$("$curl_bin" -sS --proto '=http' --max-time 15 -o /dev/null \
    -w '%{http_code} %{redirect_url}' --connect-to "$website_host:80:$cdn_cname:80" \
    "http://$website_host/cutover-probe?source=precutover")" || fail "edge HTTP probe failed"
  case "$result" in
    "301 $canonical_redirect"|"308 $canonical_redirect") ;;
    *) fail "edge does not force canonical HTTPS" ;;
  esac
}

verify_runtime "$origin_ip" origin
verify_redirect http 80
verify_redirect https 443
if "$curl_bin" -sS --connect-timeout 3 --max-time 5 \
  "http://$origin_ip:3302/api/health" >/dev/null 2>&1; then
  fail "origin port 3302 is publicly reachable"
fi
verify_runtime "$cdn_cname" edge
verify_edge_redirect

"$jq_bin" -cn --arg origin "$origin_ip" --arg cdn "$cdn_cname" --arg sha "$expected_sha" \
  '{status:"passed",origin:$origin,cdnCname:$cdn,releaseSha:$sha}'
