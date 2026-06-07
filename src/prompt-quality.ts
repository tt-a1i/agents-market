import { resolveTier } from "./tier.js";
import type { AgentDefinition, RegistryTier } from "./types.js";

// Paragraphs shared verbatim across this many agents are treated as template boilerplate
// and excluded from per-agent prompt quality scoring, so a pasted guardrails block
// cannot lift hundreds of imported prompts to identical scores.
const BOILERPLATE_MIN_AGENTS = 5;
const BOILERPLATE_MIN_LENGTH = 60;

export interface BoilerplateIndex {
  minAgents: number;
  paragraphs: Map<string, number>;
}

export interface BoilerplateParagraphSummary {
  agents: number;
  chars: number;
  preview: string;
}

export interface BoilerplateReport {
  minAgents: number;
  paragraphCount: number;
  affectedAgentCount: number;
  topParagraphs: BoilerplateParagraphSummary[];
}

export interface PromptBoilerplateUsage {
  paragraphs: number;
  chars: number;
  ratio: number;
}

export interface PromptQualityDimension {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  passed: boolean;
  message: string;
}

export interface PromptQualityScore {
  agentId: string;
  tier: RegistryTier;
  score: number;
  maxScore: number;
  grade: "excellent" | "good" | "needs-work" | "poor";
  dimensions: PromptQualityDimension[];
  suggestions: string[];
  boilerplate?: PromptBoilerplateUsage;
}

export interface PromptQualityReport {
  averageScore: number;
  minScore: number;
  maxScore: number;
  boilerplate: BoilerplateReport;
  agents: PromptQualityScore[];
}

interface DimensionRule {
  id: string;
  label: string;
  maxScore: number;
  test: (agent: AgentDefinition, prompt: string, lowerPrompt: string) => boolean;
  pass: string;
  fail: string;
}

const rules: DimensionRule[] = [
  {
    id: "role",
    label: "Role framing",
    maxScore: 15,
    test: (_agent, prompt) => /^you are\b/i.test(prompt.trim()) || /\byou are\b/i.test(prompt),
    pass: "Defines a clear agent role.",
    fail: "Start with a clear role such as \"You are a ...\"."
  },
  {
    id: "task",
    label: "Task specificity",
    maxScore: 20,
    test: (agent, prompt, lowerPrompt) =>
      prompt.length >= 80 &&
      [agent.category, ...agent.tags, ...agent.description.toLowerCase().split(/[^a-z0-9.+#-]+/)]
        .filter((term) => term.length >= 4)
        .some((term) => lowerPrompt.includes(term.toLowerCase())),
    pass: "States a concrete task in enough detail.",
    fail: "Name the concrete task, trigger, and responsibility in the prompt body."
  },
  {
    id: "context",
    label: "Context gathering",
    maxScore: 15,
    test: (_agent, _prompt, lowerPrompt) =>
      hasAny(lowerPrompt, ["read", "inspect", "review", "relevant", "actual", "source", "docs", "documentation", "rendered", "screenshot", "logs", "diff"]),
    pass: "Tells the agent how to gather task context.",
    fail: "Tell the agent what project context, sources, files, diffs, logs, docs, or rendered state to inspect first."
  },
  {
    id: "constraints",
    label: "Safety and scope",
    maxScore: 15,
    test: (_agent, _prompt, lowerPrompt) =>
      hasAny(lowerPrompt, ["do not", "don't", "avoid", "unless", "prefer", "narrowest", "minimal", "targeted", "confirmation", "policy", "readonly"]),
    pass: "Includes guardrails for scope or safety.",
    fail: "Add constraints that prevent broad rewrites, unsafe commands, policy bypass, or unconfirmed changes."
  },
  {
    id: "output",
    label: "Expected output",
    maxScore: 15,
    test: (_agent, _prompt, lowerPrompt) =>
      hasAny(lowerPrompt, ["report", "return", "summarize", "findings", "recommend", "fixes", "source links", "evidence", "commands", "outcome"]),
    pass: "Specifies the output shape.",
    fail: "Describe the expected answer format, evidence, findings, commands, or remediation details."
  },
  {
    id: "domain",
    label: "Domain specificity",
    maxScore: 10,
    test: (agent, _prompt, lowerPrompt) => {
      const terms = new Set(
        [agent.category, ...agent.tags, ...agent.name.split(/\s+/), ...agent.description.split(/[^A-Za-z0-9.+#-]+/)]
          .map((term) => term.toLowerCase())
          .filter((term) => term.length >= 5)
      );
      let matches = 0;
      for (const term of terms) if (lowerPrompt.includes(term)) matches += 1;
      return matches >= 2;
    },
    pass: "Uses domain-specific language from the agent's purpose.",
    fail: "Include domain terms that distinguish this agent from a generic assistant."
  },
  {
    id: "verification",
    label: "Verification posture",
    maxScore: 10,
    test: (_agent, _prompt, lowerPrompt) =>
      hasAny(lowerPrompt, ["verify", "test", "typecheck", "lint", "build", "reproduce", "check", "ground", "evidence", "uncertainty", "source"]),
    pass: "Encourages verification or evidence-backed output.",
    fail: "Ask the agent to verify claims, reproduce issues, run targeted checks, cite sources, or mark uncertainty."
  }
];

export function scorePromptQuality(agent: AgentDefinition, boilerplate?: BoilerplateIndex): PromptQualityScore {
  const stripped = boilerplate ? stripBoilerplate(agent, boilerplate) : undefined;
  const prompt = (stripped?.prompt ?? agent.prompt).trim();
  const lowerPrompt = prompt.toLowerCase();
  const dimensions = rules.map((rule) => {
    const passed = rule.test(agent, prompt, lowerPrompt);
    return {
      id: rule.id,
      label: rule.label,
      score: passed ? rule.maxScore : 0,
      maxScore: rule.maxScore,
      passed,
      message: passed ? rule.pass : rule.fail
    };
  });
  const score = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const maxScore = dimensions.reduce((sum, dimension) => sum + dimension.maxScore, 0);
  const suggestions = dimensions.filter((dimension) => !dimension.passed).map((dimension) => dimension.message);

  return {
    agentId: agent.id,
    tier: resolveTier(agent),
    score,
    maxScore,
    grade: gradePrompt(score),
    dimensions,
    suggestions,
    boilerplate: stripped?.usage
  };
}

export function buildBoilerplateIndex(agents: AgentDefinition[], minAgents = BOILERPLATE_MIN_AGENTS): BoilerplateIndex {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const seen = new Set<string>();
    for (const paragraph of splitParagraphs(agent.prompt)) {
      seen.add(normalizeParagraph(paragraph, agent));
    }
    for (const key of seen) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const paragraphs = new Map<string, number>();
  for (const [key, count] of counts) {
    if (count >= minAgents) paragraphs.set(key, count);
  }
  return { minAgents, paragraphs };
}

export function scoreRegistryPrompts(agents: AgentDefinition[]): PromptQualityReport {
  const boilerplate = buildBoilerplateIndex(agents);
  const scores = agents.map((agent) => scorePromptQuality(agent, boilerplate));
  const total = scores.reduce((sum, score) => sum + score.score, 0);
  return {
    averageScore: scores.length === 0 ? 100 : Math.round(total / scores.length),
    minScore: scores.length === 0 ? 100 : Math.min(...scores.map((score) => score.score)),
    maxScore: 100,
    boilerplate: summarizeBoilerplate(agents, boilerplate),
    agents: scores
  };
}

function stripBoilerplate(
  agent: AgentDefinition,
  boilerplate: BoilerplateIndex
): { prompt: string; usage: PromptBoilerplateUsage } {
  const paragraphs = splitParagraphs(agent.prompt);
  const kept: string[] = [];
  let removedParagraphs = 0;
  let removedChars = 0;
  for (const paragraph of paragraphs) {
    if (boilerplate.paragraphs.has(normalizeParagraph(paragraph, agent))) {
      removedParagraphs += 1;
      removedChars += paragraph.length;
      continue;
    }
    kept.push(paragraph);
  }
  const totalChars = agent.prompt.trim().length;
  return {
    prompt: kept.join("\n\n"),
    usage: {
      paragraphs: removedParagraphs,
      chars: removedChars,
      ratio: totalChars === 0 ? 0 : Math.round((removedChars / totalChars) * 100) / 100
    }
  };
}

function summarizeBoilerplate(agents: AgentDefinition[], boilerplate: BoilerplateIndex): BoilerplateReport {
  const previews = new Map<string, string>();
  let affectedAgentCount = 0;
  for (const agent of agents) {
    let affected = false;
    for (const paragraph of splitParagraphs(agent.prompt)) {
      const key = normalizeParagraph(paragraph, agent);
      if (!boilerplate.paragraphs.has(key)) continue;
      affected = true;
      if (!previews.has(key)) previews.set(key, paragraph.slice(0, 120));
    }
    if (affected) affectedAgentCount += 1;
  }
  const topParagraphs = [...boilerplate.paragraphs.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 5)
    .map(([key, count]) => ({
      agents: count,
      chars: key.length,
      preview: previews.get(key) ?? key.slice(0, 120)
    }));
  return {
    minAgents: boilerplate.minAgents,
    paragraphCount: boilerplate.paragraphs.size,
    affectedAgentCount,
    topParagraphs
  };
}

function splitParagraphs(prompt: string): string[] {
  return prompt
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= BOILERPLATE_MIN_LENGTH);
}

// Normalize so the same template paragraph hashes identically across agents even when
// it interpolates the agent's own name or id.
function normalizeParagraph(paragraph: string, agent: AgentDefinition): string {
  let normalized = paragraph.toLowerCase().replace(/\s+/g, " ").trim();
  for (const marker of [agent.name.toLowerCase(), agent.id.toLowerCase()]) {
    if (marker.length < 3) continue;
    normalized = normalized.split(marker).join("<agent>");
  }
  return normalized;
}

function gradePrompt(score: number): PromptQualityScore["grade"] {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "needs-work";
  return "poor";
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}
