#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EQUICORD_DIR="${EQUICORD_DIR:-${SCRIPT_DIR}/../Equicord}"
PLUGIN_DIR="${EQUICORD_DIR}/src/userplugins/catgifs"

if [[ ! -f "${EQUICORD_DIR}/package.json" || ! -d "${EQUICORD_DIR}/src" ]]; then
    printf 'Equicord source checkout not found at %s\nSet EQUICORD_DIR to its path.\n' "$EQUICORD_DIR" >&2
    exit 1
fi

mkdir -p "$PLUGIN_DIR"
cp "$SCRIPT_DIR"/src/* "$PLUGIN_DIR"/
printf 'Copied CatGIFs into %s\n' "$PLUGIN_DIR"

cd "$EQUICORD_DIR"
corepack pnpm --config.verify-deps-before-run=false build --dev
