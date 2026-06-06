import type { AgentDefinition } from "./types.js";

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
  score: number;
  maxScore: number;
  grade: "excellent" | "good" | "needs-work" | "poor";
  dimensions: PromptQualityDimension[];
  suggestions: string[];
}

export interface PromptQualityReport {
  averageScore: number;
  minScore: number;
  maxScore: number;
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

export function scorePromptQuality(agent: AgentDefinition): PromptQualityScore {
  const prompt = agent.prompt.trim();
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
    score,
    maxScore,
    grade: gradePrompt(score),
    dimensions,
    suggestions
  };
}

export function scoreRegistryPrompts(agents: AgentDefinition[]): PromptQualityReport {
  const scores = agents.map((agent) => scorePromptQuality(agent));
  const total = scores.reduce((sum, score) => sum + score.score, 0);
  return {
    averageScore: scores.length === 0 ? 100 : Math.round(total / scores.length),
    minScore: scores.length === 0 ? 100 : Math.min(...scores.map((score) => score.score)),
    maxScore: 100,
    agents: scores
  };
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
