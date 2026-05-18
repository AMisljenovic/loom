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
const STEP_HEAD_NUMBERED = /^\s*(\d+)[.)]\s+(.+)$/;
const STEP_HEAD_HEADING = /^\s{0,3}#{1,3}\s+(.+)$/;

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
  for (const rawLine of lines) {
    const headingMatch = rawLine.match(STEP_HEAD_HEADING);
    const numberedMatch = !headingMatch ? rawLine.match(STEP_HEAD_NUMBERED) : null;
    if (headingMatch || numberedMatch) {
      if (current) {
        steps.push({ index: stepIndex++, title: current.title, body: current.bodyLines.join("\n").trim() });
      }
      const title = (headingMatch ? headingMatch[1] : numberedMatch![2]).trim();
      current = { title, bodyLines: [] };
      continue;
    }
    if (current) {
      current.bodyLines.push(rawLine);
    }
  }
  if (current) {
    steps.push({ index: stepIndex++, title: current.title, body: current.bodyLines.join("\n").trim() });
  }
  return { markdown, steps };
}
