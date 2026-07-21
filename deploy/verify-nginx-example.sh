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

assert_server_contains() {
  local hosts="$1" listen="$2" expected="$3"
  awk -v hosts="$hosts" -v listen="$listen" -v expected="$expected" '
    /^server \{/ { block = $0; depth = 1; next }
    depth > 0 {
      block = block "\n" $0
      line = $0
      depth += gsub(/{/, "{", line) - gsub(/}/, "}", line)
      if (depth == 0 && index(block, "server_name " hosts ";") &&
          index(block, "listen " listen ";") && index(block, expected)) found = 1
    }
    END { exit found ? 0 : 1 }
  ' <<<"$config_text" || fail "$hosts on $listen must contain: $expected"
}

command -v docker >/dev/null || fail "docker is required"
command -v openssl >/dev/null || fail "openssl is required"
[[ -r "$config" ]] || fail "nginx config is missing"
config_text="$(<"$config")"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$work_dir/ssl"/{website,kith-inn}
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=kith-inn.example.invalid' \
  -keyout "$work_dir/ssl/kith-inn/privkey.pem" \
  -out "$work_dir/ssl/kith-inn/fullchain.pem" >/dev/null 2>&1
cp "$work_dir/ssl/kith-inn/privkey.pem" "$work_dir/ssl/website/privkey.pem"
cp "$work_dir/ssl/kith-inn/fullchain.pem" "$work_dir/ssl/website/fullchain.pem"

for expected in \
  'proxy_pass http://127.0.0.1:3302;' \
  'proxy_pass http://127.0.0.1:3310;' \
  'proxy_pass http://127.0.0.1:3304;' \
  'proxy_pass http://127.0.0.1:3305;' \
  'return 308 https://$host$request_uri;'; do
  grep -Fq "$expected" <<<"$config_text" || fail "required website or kith-inn route is missing"
done
[[ "$(grep -Fc 'proxy_pass http://127.0.0.1:3302;' <<<"$config_text")" == "1" ]] ||
  fail "www must be the only website proxy block"
! grep -Fq 'demo.codeforpeople.cn' <<<"$config_text" || fail "retired demo host must be absent"
[[ "$(grep -Fc 'default_server;' <<<"$config_text")" == "2" ]] ||
  fail "HTTP and HTTPS must each define one default server"
[[ "$(grep -Fc 'ssl_protocols TLSv1.2 TLSv1.3;' <<<"$config_text")" -ge "2" ]] ||
  fail "website TLS servers must reject TLS versions older than 1.2"
assert_server_contains '_cfp_default' '80 default_server' 'return 444;'
assert_server_contains '_cfp_default' '443 ssl http2 default_server' 'return 444;'
assert_server_contains 'codeforpeople.cn www.codeforpeople.cn' '80' \
  'return 308 https://www.codeforpeople.cn$request_uri;'
assert_server_contains 'codeforpeople.cn' '443 ssl http2' \
  'return 308 https://www.codeforpeople.cn$request_uri;'
assert_server_contains 'www.codeforpeople.cn' '443 ssl http2' \
  'proxy_pass http://127.0.0.1:3302;'
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
  -v "$work_dir/ssl:/etc/nginx/ssl:ro" \
  nginx:1.27-alpine nginx -t >"$work_dir/nginx.log" 2>&1; then
  cat "$work_dir/nginx.log" >&2
  fail "nginx -t rejected the materialized config"
fi

printf '{"check":"nginx-example","status":"passed"}\n'
