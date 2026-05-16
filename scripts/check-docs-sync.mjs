#!/usr/bin/env node
// Pre-commit guard: if staged changes touch source/build areas, require that
// at least one repo-facing documentation file is also staged. Bypass with
// SKIP_DOCS_CHECK=1 or `git commit --no-verify`.
import { execSync } from 'node:child_process';

if (process.env.SKIP_DOCS_CHECK === '1') process.exit(0);

let raw;
try {
  raw = execSync('git diff --cached --name-only -z', { encoding: 'buffer' });
} catch (err) {
  console.error('[loom] check-docs-sync: failed to read staged files:', err.message);
  process.exit(0); // do not block on tooling errors
}

const staged = raw.toString('utf8').split('\0').filter(Boolean);
if (staged.length === 0) process.exit(0);

const DOC_FILES = ['README.md', 'CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md'];

const TRIGGERS = [
  /^src\//,
  /^agent\//,
  /^webview-ui\/src\//,
  /^package\.json$/,
  /^scripts\//,
  /^\.github\/workflows\//,
];

const EXCLUDES = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /_test\.go$/,
  /(^|\/)__tests__\//,
  /^package-lock\.json$/,
  /\/package-lock\.json$/,
  /^agent\/go\.sum$/,
  /^dist\//,
  /^out\//,
  /^webview-ui\/dist\//,
  /^agent\/bin\//,
];

const norm = (p) => p.replace(/\\/g, '/');
const isDocRelevant = (p) => {
  const n = norm(p);
  return TRIGGERS.some((r) => r.test(n)) && !EXCLUDES.some((r) => r.test(n));
};

const relevant = staged.filter(isDocRelevant);
const docsStaged = staged.some((p) => DOC_FILES.includes(norm(p)));

if (relevant.length > 0 && !docsStaged) {
  console.error('\n[loom] Pre-commit: staged source changes without doc updates.\n');
  console.error('Doc-relevant files staged:');
  for (const f of relevant) console.error('  - ' + f);
  console.error('\nUpdate at least one of these docs when source behavior changes:');
  for (const f of DOC_FILES) console.error('  - ' + f);
  console.error('\nBypass: SKIP_DOCS_CHECK=1 git commit ...   (or git commit --no-verify)\n');
  process.exit(1);
}

process.exit(0);
