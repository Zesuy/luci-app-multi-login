#!/bin/sh
# shellcheck disable=SC1091
[ "${ML_MIGRATION_EMBEDDED:-0}" = 1 ] || . "$(dirname "$0")/../multilogin-migrate.sh"
ml_prerm "$@"
