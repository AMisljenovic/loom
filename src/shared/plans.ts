export interface ProposedPlan {
  markdown: string;
}

export interface PlanStep {
  index: number;
  title: string;
  body: string;
}

export interface ParsedPlan {
  markdown: string;
  steps: PlanStep[];
}

const PLAN_BLOCK = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i;
const STEP_LIST_ITEM = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)(.+)$/;
const HEADING = /^\s{0,3}#{1,4}\s+(.+)$/;
const BOLD_HEADING = /^\s*\*\*([^*]+)\*\*:?\s*$/;

export function extractProposedPlan(text: string): ProposedPlan | undefined {
  const match = PLAN_BLOCK.exec(text);
  const markdown = match?.[1]?.trim();
  if (!markdown) {
    return undefined;
  }
  return { markdown };
}

export function parseProposedPlan(markdown: string): ParsedPlan {
  const lines = markdown.split(/\r?\n/);
  const steps: PlanStep[] = [];
  let current: { title: string; bodyLines: string[] } | undefined;
  let stepIndex = 0;
  let section: "root" | "actionable" | "blocked" = "root";

  const pushCurrent = () => {
    if (!current) return;
    steps.push({ index: stepIndex++, title: current.title, body: current.bodyLines.join("\n").trim() });
    current = undefined;
  };

  for (const rawLine of lines) {
    const heading = headingText(rawLine);
    if (heading !== undefined) {
      pushCurrent();
      section = classifySection(heading);
      continue;
    }

    const listMatch = rawLine.match(STEP_LIST_ITEM);
    if (listMatch && shouldCollectListItem(section, rawLine, listMatch[1].length)) {
      pushCurrent();
      const title = cleanStepTitle(listMatch[2]);
      if (title) {
        current = { title, bodyLines: [] };
      }
      continue;
    }

    if (current) {
      current.bodyLines.push(rawLine);
    }
  }
  pushCurrent();
  return { markdown, steps };
}

function headingText(line: string): string | undefined {
  const heading = line.match(HEADING)?.[1] ?? line.match(BOLD_HEADING)?.[1];
  return heading ? cleanStepTitle(heading) : undefined;
}

function classifySection(title: string): "root" | "actionable" | "blocked" {
  const lower = title.toLowerCase();
  if (/\b(summary|assumptions?|scope|out of scope|public apis?|interfaces?|data-flow|data flow|rollout|risks?|constraints?)\b/.test(lower)) {
    return "blocked";
  }
  if (/\b(implementation|implement|key changes?|changes?|test plan|tests?|verification|validation)\b/.test(lower)) {
    return "actionable";
  }
  return "root";
}

function shouldCollectListItem(section: "root" | "actionable" | "blocked", line: string, indent: number): boolean {
  if (indent > 1) return false;
  if (section === "actionable") return true;
  if (section === "blocked") return false;
  return /^\s{0,1}\d+[.)]\s+/.test(line);
}

function cleanStepTitle(text: string): string {
  return text
    .trim()
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .trim();
}
