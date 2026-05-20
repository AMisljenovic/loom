const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeMarkdownHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const parsed = new URL(href);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

// Wrapper tags the agent uses for structural signalling (plan handoff,
// reference blocks, diagnostics follow-ups). They're meaningful to the
// host parser (e.g. `extractProposedPlan` in src/shared/plans.ts) but
// shouldn't appear in the rendered transcript.
//
// Also strips semantic tags that some models (notably reasoning-heavy
// OpenAI-compatible / Gemini configs) emit inline when referring to
// paths, files, or symbols (e.g. `<path>src/foo.ts</path>`). Loom does
// not instruct this format — the model produces it on its own — and
// ReactMarkdown escapes unknown HTML so the raw tags would otherwise
// surface as visible text in REASONING and Summary cards. The wrapped
// content survives the strip; only the angle-bracket markers go away.
const STRUCTURAL_TAGS = [
  "proposed_plan",
  "references",
  "diagnostics-followup",
  "affected-files",
  "diagnostics",
  "path",
  "file",
  "filename",
  "dir",
  "function",
  "class",
  "command",
  "code_ref",
];

const STRUCTURAL_TAG_RE = new RegExp(
  `<\\s*/?\\s*(?:${STRUCTURAL_TAGS.join("|")})\\s*/?\\s*>`,
  "gi",
);

// Strip structural wrapper tags before Markdown rendering. Tag *contents*
// are kept (so the plan body still shows); only the open/close markers
// disappear. Trailing blank lines created by tag removal are collapsed.
export function stripStructuralTags(text: string): string {
  if (!text) return text;
  return text
    .replace(STRUCTURAL_TAG_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}
