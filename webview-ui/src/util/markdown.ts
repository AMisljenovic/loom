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
