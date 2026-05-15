#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../agent"
mkdir -p ../bin

LDFLAGS="-s -w"

# CGO enables tree-sitter for the workspace symbol index. Without CGO the
# indexer compiles but returns empty symbol lists (find_symbol still works,
# it just has nothing to find). Each platform needs a matching CC.
# Override per-target via CC_<GOOS>_<GOARCH> environment variables. If unset
# we fall back to CGO_ENABLED=0 for that target so the build always succeeds.
build() {
  local goos=$1 goarch=$2 ext=${3:-}
  local cc_var="CC_${goos}_${goarch}"
  local cc="${!cc_var:-}"
  local cgo=0
  if [ -n "$cc" ]; then
    cgo=1
  fi
  echo "building agent-${goos}-${goarch}${ext} (cgo=${cgo}${cc:+, CC=$cc})"
  CGO_ENABLED=$cgo CC="$cc" GOOS=$goos GOARCH=$goarch go build -ldflags="$LDFLAGS" \
    -o "../bin/agent-${goos}-${goarch}${ext}" ./cmd/agent
}

# Match Node's process.platform / process.arch naming
build darwin  arm64
build darwin  amd64    # → rename to x64 below
build linux   amd64    # → rename to x64 below
build linux   arm64
build windows amd64 .exe

# Node calls amd64 "x64". Rename so binaryPath() in agentClient.ts finds them.
mv ../bin/agent-darwin-amd64  ../bin/agent-darwin-x64
mv ../bin/agent-linux-amd64   ../bin/agent-linux-x64
mv ../bin/agent-windows-amd64.exe ../bin/agent-win32-x64.exe

echo "done. binaries in ./bin"
