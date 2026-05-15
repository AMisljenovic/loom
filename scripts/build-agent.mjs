// Cross-platform build script for the Go agent.
// Works on Windows (PowerShell/cmd), macOS, and Linux without bash.
//
// Usage:
//   node scripts/build-agent.mjs          # builds for current platform only (fast, dev loop)
//   node scripts/build-agent.mjs --all    # cross-compiles all platforms (release)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const agentDir = path.join(repoRoot, "agent");
const binDir = path.join(repoRoot, "bin");

const buildAll = process.argv.includes("--all");

// Map Go's GOOS/GOARCH to Node's process.platform/process.arch
const targets = [
  { goos: "darwin",  goarch: "arm64", nodePlatform: "darwin", nodeArch: "arm64", ext: "" },
  { goos: "darwin",  goarch: "amd64", nodePlatform: "darwin", nodeArch: "x64",   ext: "" },
  { goos: "linux",   goarch: "amd64", nodePlatform: "linux",  nodeArch: "x64",   ext: "" },
  { goos: "linux",   goarch: "arm64", nodePlatform: "linux",  nodeArch: "arm64", ext: "" },
  { goos: "windows", goarch: "amd64", nodePlatform: "win32",  nodeArch: "x64",   ext: ".exe" },
];

function checkGo() {
  const result = spawnSync("go", ["version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    console.error("Error: Go is not installed or not on PATH.");
    console.error("Install from https://go.dev/dl/ and open a new shell.");
    process.exit(1);
  }
  console.log(result.stdout.trim());
}

function buildOne(target) {
  const outName = `agent-${target.nodePlatform}-${target.nodeArch}${target.ext}`;
  const outPath = path.join(binDir, outName);
  console.log(`building ${outName}`);
  const result = spawnSync(
    "go",
    ["build", "-ldflags=-s -w", "-o", outPath, "./cmd/agent"],
    {
      cwd: agentDir,
      env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch },
      stdio: "inherit",
      shell: false,
    }
  );
  if (result.status !== 0) {
    console.error(`Build failed for ${target.goos}/${target.goarch}`);
    process.exit(result.status ?? 1);
  }
}

function currentTarget() {
  // Match the current host
  const platform = process.platform; // 'darwin' | 'linux' | 'win32'
  const arch = process.arch;         // 'arm64' | 'x64'
  const found = targets.find(t => t.nodePlatform === platform && t.nodeArch === arch);
  if (!found) {
    console.error(`No build target for ${platform}-${arch}`);
    process.exit(1);
  }
  return found;
}

function main() {
  checkGo();
  if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

  const list = buildAll ? targets : [currentTarget()];
  for (const t of list) buildOne(t);

  console.log(`done. binaries in ${path.relative(repoRoot, binDir)}`);
}

main();
