# PowerShell equivalent of build-agent.sh for Windows users.
# Cross-compiles the Go agent for all supported platforms.

$ErrorActionPreference = "Stop"

Push-Location (Join-Path $PSScriptRoot "..\agent")
try {
    $binDir = Join-Path $PSScriptRoot "..\bin"
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null

    $ldflags = "-s -w"

    function Build($goos, $goarch, $ext = "") {
        $outName = "agent-$goos-$goarch$ext"
        Write-Host "building $outName"
        $env:GOOS = $goos
        $env:GOARCH = $goarch
        go build -ldflags="$ldflags" -o (Join-Path $binDir $outName) ./cmd/agent
        if ($LASTEXITCODE -ne 0) { throw "go build failed for $goos/$goarch" }
    }

    Build "darwin"  "arm64"
    Build "darwin"  "amd64"
    Build "linux"   "amd64"
    Build "linux"   "arm64"
    Build "windows" "amd64" ".exe"

    # Match Node's process.arch naming (amd64 -> x64)
    Move-Item -Force (Join-Path $binDir "agent-darwin-amd64")      (Join-Path $binDir "agent-darwin-x64")
    Move-Item -Force (Join-Path $binDir "agent-linux-amd64")       (Join-Path $binDir "agent-linux-x64")
    Move-Item -Force (Join-Path $binDir "agent-windows-amd64.exe") (Join-Path $binDir "agent-win32-x64.exe")

    Write-Host "done. binaries in ./bin"
}
finally {
    Pop-Location
    Remove-Item Env:GOOS -ErrorAction SilentlyContinue
    Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
}
