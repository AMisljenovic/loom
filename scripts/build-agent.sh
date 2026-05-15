#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../agent"
mkdir -p ../bin

LDFLAGS="-s -w"

build() {
  local goos=$1 goarch=$2 ext=${3:-}
  echo "building agent-${goos}-${goarch}${ext}"
  GOOS=$goos GOARCH=$goarch go build -ldflags="$LDFLAGS" \
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
