#!/usr/bin/env bash
set -euo pipefail
[[ "${FAKE_DEPLOY_MODE:-success}" != shared-cms ]] || exit 1
printf '{"ok":true,"service":"cms"}\n'
