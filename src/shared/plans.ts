export interface ProposedPlan {
  markdown: string;
}

const PLAN_BLOCK = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i;

export function extractProposedPlan(text: string): ProposedPlan | undefined {
  const match = PLAN_BLOCK.exec(text);
  const markdown = match?.[1]?.trim();
  if (!markdown) {
    return undefined;
  }
  return { markdown };
}
