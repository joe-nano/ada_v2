#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFDIR="${JODA_ONEDRIVE_CONFDIR:-$ROOT_DIR/.onedrive}"

mkdir -p "$CONFDIR"

exec onedrive --confdir "$CONFDIR" "$@"

