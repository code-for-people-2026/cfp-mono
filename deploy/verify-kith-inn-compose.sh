#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
website_compose="$repo_root/deploy/docker-compose.prod.yml"
kith_compose="$repo_root/deploy/docker-compose.kith-inn.prod.yml"
website_env="$repo_root/deploy/.env.website.verify.example"
env_file="${1:-$repo_root/deploy/.env.verify}"
fail() {
  printf 'kith-inn compose verification failed: %s\n' "$1" >&2
  exit 1
}
command -v docker >/dev/null || fail "docker is required"
command -v jq >/dev/null || fail "jq is required"
[[ -f "$env_file" ]] || fail "verification env file is missing"
grep -q 'KITH_INN_' "$website_compose" && fail "website compose requires kith-inn variables"
grep -Fq 'PAYLOAD_SECRET: ${KITH_INN_PAYLOAD_SECRET:?' "$kith_compose" ||
  fail "host PAYLOAD secret must use the kith-inn-specific variable"
WEBSITE_IMAGE=sha256:0000000000000000000000000000000000000000000000000000000000000000 WEBSITE_ENV_FILE="$website_env" \
  docker compose -f "$website_compose" config --quiet ||
  fail "website-only compose requires kith-inn variables"
if ! WEBSITE_ENV_FILE="$website_env" docker compose -f "$website_compose" -f "$kith_compose" --env-file "$env_file" \
  config --format json kith-inn-h5 | jq -e '
  def digest: type == "string" and test("^(?:.+@)?sha256:[0-9a-f]{64}$");
  def dependency($service; $dependency; $condition):
    (.services[$service].depends_on | keys) == [$dependency] and
    .services[$service].depends_on[$dependency].condition == $condition;
  def loopback($service; $target):
    (.services[$service].ports | length) == 1 and
    .services[$service].ports[0].host_ip == "127.0.0.1" and
    .services[$service].ports[0].target == $target;
  ([
    .services["kith-inn-cms"].image,
    .services["kith-inn-cms-migrate"].image,
    .services["kith-inn-cms-provision"].image,
    .services["kith-inn-be"].image,
    .services["kith-inn-h5"].image
  ] | all(digest))
  and (.services["kith-inn-cms-migrate"].image == .services["kith-inn-cms-provision"].image)
  and (.services["kith-inn-cms-migrate"].image != .services["kith-inn-cms"].image)
  and (.services["kith-inn-cms-migrate"].working_dir == "/app/apps/cms")
  and (.services["kith-inn-cms-provision"].working_dir == "/app/apps/cms")
  and (.services["kith-inn-cms-migrate"].command == ["./node_modules/.bin/tsx", "migrations/run.ts"])
  and (.services["kith-inn-cms-provision"].command == ["./node_modules/.bin/tsx", "seed/run.ts", "kith-inn"])
  and dependency("kith-inn-cms-provision"; "kith-inn-cms-migrate"; "service_completed_successfully")
  and dependency("kith-inn-cms"; "kith-inn-cms-provision"; "service_completed_successfully")
  and dependency("kith-inn-be"; "kith-inn-cms"; "service_healthy")
  and dependency("kith-inn-h5"; "kith-inn-be"; "service_healthy")
  and ((.services["kith-inn-cms"].healthcheck.test // []) | length > 0)
  and ((.services["kith-inn-be"].healthcheck.test // []) | length > 0)
  and loopback("kith-inn-cms"; 3304)
  and loopback("kith-inn-be"; 3310)
  and loopback("kith-inn-h5"; 8080)
  and ([.services | to_entries[] |
    select(.key | startswith("kith-inn")) |
    select(.value.environment.KITH_INN_TRIAL_OPENID? != null) |
    .key] == ["kith-inn-cms-provision"])
' >/dev/null; then
  fail "rendered topology violates the deployment contract"
fi
printf '{"check":"kith-inn-compose","status":"passed"}\n'
