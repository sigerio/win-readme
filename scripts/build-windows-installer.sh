#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -d node_modules ]; then
  npm ci
fi

npm run test
cargo tauri build --target x86_64-pc-windows-msvc --ci

bundle_dir="src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
installer="$(
  find "$bundle_dir" -maxdepth 1 -type f -name '*-setup.exe' -printf '%T@ %p\n' |
    sort -nr |
    head -n 1 |
    cut -d' ' -f2-
)"

if [ -z "$installer" ]; then
  echo "Windows installer not found in $bundle_dir" >&2
  exit 1
fi

cp -f "$installer" .
echo "Installer: $(pwd)/$(basename "$installer")"
