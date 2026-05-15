// Cross-platform packaging script — produces a VSIX per platform.
// Run after build-agent.mjs --all has produced binaries for every target.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const targets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
];

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32", // npm/npx need shell on Windows
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("building all components...");
run("npm", ["run", "build:agent:all"]);
run("npm", ["run", "build:webview"]);
run("npm", ["run", "build:ts"]);

if (!existsSync(path.join(repoRoot, "dist"))) {
  console.error("dist/ does not exist after build — aborting");
  process.exit(1);
}

for (const t of targets) {
  console.log(`packaging ${t}`);
  run("npx", ["vsce", "package", "--target", t, "--out", `dist/loom-${t}.vsix`]);
}

console.log("done. VSIX files in dist/");
