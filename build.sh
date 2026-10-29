#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-desktop}"
CLIENT_DIR="${CLIENT_DIR:-${EQUICORD_DIR:-${SCRIPT_DIR}/../Equicord}}"
if [[ ! -d "$CLIENT_DIR" && -d "${SCRIPT_DIR}/../Vencord" ]]; then
    CLIENT_DIR="${SCRIPT_DIR}/../Vencord"
fi
PLUGIN_DIR="${CLIENT_DIR}/src/userplugins/catgifs"

if [[ ! -f "${CLIENT_DIR}/package.json" || ! -d "${CLIENT_DIR}/src" ]]; then
    printf 'Equicord or Vencord source checkout not found at %s\nSet CLIENT_DIR to its path.\n' "$CLIENT_DIR" >&2
    exit 1
fi
if [[ "$TARGET" != "desktop" && "$TARGET" != "web" && "$TARGET" != "all" ]]; then
    printf 'Usage: %s [desktop|web|all]\n' "$0" >&2
    exit 1
fi

mkdir -p "$PLUGIN_DIR"
cp "$SCRIPT_DIR"/src/* "$PLUGIN_DIR"/
printf 'Copied CatGIFs into %s\n' "$PLUGIN_DIR"

cd "$CLIENT_DIR"
if [[ "$TARGET" != "web" ]]; then
    corepack pnpm --config.verify-deps-before-run=false build --dev
fi
if [[ "$TARGET" != "desktop" ]]; then
    corepack pnpm --config.verify-deps-before-run=false buildWeb --dev
fi
