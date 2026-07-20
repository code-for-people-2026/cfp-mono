#!/usr/bin/env bash
set -euo pipefail

destination="${!#}"
if [[ -n "${FAKE_INSTALL_FAIL_MATCH:-}" && "$destination" == *"$FAKE_INSTALL_FAIL_MATCH"* ]]; then
  exit 1
fi
exec install "$@"
