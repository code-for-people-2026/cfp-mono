#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${1:-$repo_root/deploy/nginx.example.conf}"
work_dir="$repo_root/test-results/nginx-example-$$"

fail() {
  printf 'nginx example verification failed: %s\n' "$1" >&2
  exit 1
}

assert_restricted_server() {
  local host="$1" allowlist="$2"
  awk -v host="$host" -v allowlist="$allowlist" '
    /^server \{/ { block = $0; depth = 1; next }
    depth > 0 {
      block = block "\n" $0
      line = $0
      depth += gsub(/{/, "{", line) - gsub(/}/, "}", line)
      if (depth == 0 && index(block, "server_name " host ";") &&
          index(block, "allow " allowlist ";") && index(block, "deny all;")) found = 1
    }
    END { exit found ? 0 : 1 }
  ' <<<"$config_text" || fail "$host must bind its allowlist and deny all in one server block"
}

command -v docker >/dev/null || fail "docker is required"
command -v openssl >/dev/null || fail "openssl is required"
[[ -r "$config" ]] || fail "nginx config is missing"
config_text="$(<"$config")"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$work_dir/ssl"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=kith-inn.example.invalid' \
  -keyout "$work_dir/ssl/privkey.pem" \
  -out "$work_dir/ssl/fullchain.pem" >/dev/null 2>&1

for expected in \
  'proxy_pass http://127.0.0.1:3302;' \
  'proxy_pass http://127.0.0.1:3310;' \
  'proxy_pass http://127.0.0.1:3304;' \
  'proxy_pass http://127.0.0.1:3305;' \
  'return 308 https://$host$request_uri;'; do
  grep -Fq "$expected" <<<"$config_text" || fail "required website or kith-inn route is missing"
done
[[ "$(grep -Fc 'allow 192.0.2.0/24;' <<<"$config_text")" == "1" ]] ||
  fail "CMS allowlist must appear exactly once"
[[ "$(grep -Fc 'allow 198.51.100.0/24;' <<<"$config_text")" == "1" ]] ||
  fail "H5 allowlist must appear exactly once"
[[ "$(grep -Fc 'deny all;' <<<"$config_text")" == "2" ]] ||
  fail "CMS and H5 must each deny non-allowlisted traffic"
assert_restricted_server 'cms.kith-inn.example.invalid' '192.0.2.0/24'
assert_restricted_server 'h5.kith-inn.example.invalid' '198.51.100.0/24'

if ! docker run --rm \
  -v "$config:/etc/nginx/conf.d/default.conf:ro" \
  -v "$work_dir/ssl:/etc/nginx/ssl/kith-inn:ro" \
  nginx:1.27-alpine nginx -t >"$work_dir/nginx.log" 2>&1; then
  cat "$work_dir/nginx.log" >&2
  fail "nginx -t rejected the materialized config"
fi

printf '{"check":"nginx-example","status":"passed"}\n'
