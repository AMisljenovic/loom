export function expandCommandBody(body: string, args: string): string {
  const argv = splitArgs(args);
  return body
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$(\d+)/g, (match, rawIndex: string) => {
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index <= 0) return match;
      return argv[index - 1] ?? match;
    });
}

export function splitArgs(args: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const ch of args.trim()) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = undefined;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (escaped) cur += "\\";
  if (cur) out.push(cur);
  return out;
}
