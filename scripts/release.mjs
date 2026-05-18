#!/usr/bin/env node
// Release helper: scans Conventional Commits since the last v*.*.* tag,
// decides patch/minor/major, writes a new CHANGELOG.md section, and bumps
// package.json + package-lock.json. Does NOT commit or tag — prints the
// next steps so the human can review the diff first.
//
// Usage:
//   node scripts/release.mjs            # apply changes
//   node scripts/release.mjs --dry-run  # print what would change

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: repoRoot, encoding: "utf8", ...opts }).trim();
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8"));
}

const pkg = readJson("package.json");
const currentVersion = pkg.version;

let lastTag = null;
try {
  lastTag = sh('git describe --tags --abbrev=0 --match "v*.*.*"', { stdio: ["ignore", "pipe", "ignore"] });
} catch {
  // No prior tag — first release. Use all commits.
}

const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const sep = "\x1e";
const fieldSep = "\x1f";
const rawLog = sh(`git log ${range} --pretty=format:%H${fieldSep}%s${fieldSep}%b${sep}`);

const commits = rawLog
  .split(sep)
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => {
    const [hash, subject, body = ""] = c.split(fieldSep);
    return { hash, subject, body };
  });

if (commits.length === 0) {
  console.log(`No commits since ${lastTag ?? "repo start"} — nothing to release.`);
  process.exit(0);
}

// Conventional Commits parser.
// Matches:  type(scope)!: subject   |   type!: subject   |   type: subject
const CC_RE = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<desc>.+)$/;

const TYPE_TO_SECTION = {
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  refactor: "Changed",
};
const SKIP_TYPES = new Set(["chore", "docs", "test", "ci", "build", "style"]);

const sections = { Added: [], Changed: [], Fixed: [] };
const skipped = [];
let bump = null; // "patch" | "minor" | "major"

function raiseBump(level) {
  const rank = { patch: 1, minor: 2, major: 3 };
  if (!bump || rank[level] > rank[bump]) bump = level;
}

for (const c of commits) {
  const m = c.subject.match(CC_RE);
  if (!m) {
    skipped.push({ reason: "non-conventional", commit: c });
    continue;
  }
  const type = m.groups.type.toLowerCase();
  const desc = m.groups.desc.trim();
  const breaking = m.groups.bang === "!" || /(^|\n)BREAKING[- ]CHANGE:/i.test(c.body);

  if (SKIP_TYPES.has(type)) {
    skipped.push({ reason: `type=${type}`, commit: c });
    if (breaking) raiseBump("major");
    continue;
  }

  const section = TYPE_TO_SECTION[type];
  if (!section) {
    skipped.push({ reason: `unknown type=${type}`, commit: c });
    continue;
  }

  sections[section].push(desc);

  if (breaking) raiseBump("major");
  else if (type === "feat") raiseBump("minor");
  else raiseBump("patch");
}

if (!bump) {
  console.log(
    `No user-facing changes since ${lastTag ?? "repo start"} ` +
      `(${commits.length} commit${commits.length === 1 ? "" : "s"}, all chore/docs/test/etc).`,
  );
  if (skipped.length > 0) {
    console.log("\nSkipped:");
    for (const s of skipped.slice(0, 10)) {
      console.log(`  - [${s.reason}] ${s.commit.subject}`);
    }
    if (skipped.length > 10) console.log(`  ...and ${skipped.length - 10} more`);
  }
  process.exit(0);
}

function bumpVersion(v, level) {
  const [maj, min, pat] = v.split(".").map((n) => parseInt(n, 10));
  if (level === "major") return `${maj + 1}.0.0`;
  if (level === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const newVersion = bumpVersion(currentVersion, bump);

// Build the CHANGELOG section.
const lines = [`## ${newVersion}`, ""];
for (const name of ["Added", "Changed", "Fixed"]) {
  if (sections[name].length === 0) continue;
  lines.push(`### ${name}`, "");
  for (const item of sections[name]) lines.push(`- ${item}`);
  lines.push("");
}
const newSection = lines.join("\n");

const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const headerMatch = changelog.match(/^# Changelog\s*\n+/);
if (!headerMatch) {
  console.error("CHANGELOG.md missing `# Changelog` header — aborting.");
  process.exit(1);
}
const insertAt = headerMatch[0].length;
const newChangelog =
  changelog.slice(0, insertAt) + newSection + "\n" + changelog.slice(insertAt);

// package-lock.json updates: top-level + packages[""]
const lockPath = path.join(repoRoot, "package-lock.json");
const lockRaw = readFileSync(lockPath, "utf8");
const lock = JSON.parse(lockRaw);
lock.version = newVersion;
if (lock.packages && lock.packages[""]) lock.packages[""].version = newVersion;
const newLock = JSON.stringify(lock, null, 2) + "\n";

console.log(`Release plan`);
console.log(`  Previous tag:   ${lastTag ?? "(none)"}`);
console.log(`  Current version: ${currentVersion}`);
console.log(`  Bump level:      ${bump}`);
console.log(`  New version:     ${newVersion}`);
console.log(`  Commits scanned: ${commits.length} (skipped ${skipped.length})`);
console.log();
console.log("CHANGELOG section to insert:");
console.log("─".repeat(60));
console.log(newSection);
console.log("─".repeat(60));

if (dryRun) {
  console.log("\nDry run — no files written.");
  process.exit(0);
}

pkg.version = newVersion;
writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
writeFileSync(lockPath, newLock);
writeFileSync(changelogPath, newChangelog);

console.log();
console.log("Files updated:");
console.log("  - package.json");
console.log("  - package-lock.json");
console.log("  - CHANGELOG.md");
console.log();
console.log("Next steps (review first, then):");
console.log(`  git add package.json package-lock.json CHANGELOG.md`);
console.log(`  git commit -m "chore: release v${newVersion}"`);
console.log(`  git tag v${newVersion}`);
console.log(`  git push --follow-tags`);
