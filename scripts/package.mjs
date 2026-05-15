// Cross-platform packaging script: builds all components and produces one
// VSIX per supported platform.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
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

const binaryByTarget = new Map(targets.map((target) => {
  const ext = target.startsWith("win32-") ? ".exe" : "";
  return [target, `agent-${target}${ext}`];
}));

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("building all components...");
run("npm", ["run", "build:agent:all"]);
run("npm", ["run", "build:webview"]);
run("npm", ["run", "build:ts"]);

if (!existsSync(path.join(repoRoot, "dist"))) {
  console.error("dist/ does not exist after build - aborting");
  process.exit(1);
}

const hiddenBin = path.join(repoRoot, ".loom-package-bin");
rmSync(hiddenBin, { recursive: true, force: true });
mkdirSync(hiddenBin, { recursive: true });

function binFiles() {
  return readdirSync(path.join(repoRoot, "bin")).filter((name) => name.startsWith("agent-"));
}

try {
  for (const target of targets) {
    const keep = binaryByTarget.get(target);
    if (!keep || !existsSync(path.join(repoRoot, "bin", keep))) {
      console.error(`missing binary for ${target}: ${keep}`);
      process.exit(1);
    }

    console.log(`packaging ${target}`);
    for (const file of binFiles()) {
      if (file !== keep) {
        renameSync(path.join(repoRoot, "bin", file), path.join(hiddenBin, file));
      }
    }
    run("npx", ["vsce", "package", "--target", target, "--out", `dist/loom-${target}.vsix`]);
    for (const file of readdirSync(hiddenBin)) {
      renameSync(path.join(hiddenBin, file), path.join(repoRoot, "bin", file));
    }
  }
} finally {
  for (const file of readdirSync(hiddenBin)) {
    const targetPath = path.join(repoRoot, "bin", file);
    if (!existsSync(targetPath)) {
      renameSync(path.join(hiddenBin, file), targetPath);
    }
  }
  rmSync(hiddenBin, { recursive: true, force: true });
}

console.log("done. VSIX files in dist/");
