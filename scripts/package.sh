#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build:agent
npm run build:webview
npm run build:ts

# Build a separate VSIX per platform so users only download their arch.
# This requires `vsce` to be installed.
TARGETS=(
  "darwin-arm64"
  "darwin-x64"
  "linux-x64"
  "linux-arm64"
  "win32-x64"
)

for t in "${TARGETS[@]}"; do
  echo "packaging $t"
  npx vsce package --target "$t" --out "dist/loom-$t.vsix"
done
