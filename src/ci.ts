import type { GeneratedFile } from "./types.js";
import { assertSafePackageSpec } from "./catalog.js";
import { CLI_VERSION } from "./constants.js";

export type CiProvider = "github";

export interface CiWorkflowOptions {
  provider: CiProvider;
  packageSpec: string;
  strict: boolean;
}

const DEFAULT_PACKAGE_SPEC = `@agents-market/cli@${CLI_VERSION}`;

export function defaultCiWorkflowOptions(): CiWorkflowOptions {
  return {
    provider: "github",
    packageSpec: DEFAULT_PACKAGE_SPEC,
    strict: true
  };
}

export function generateCiWorkflow(options: Partial<CiWorkflowOptions> = {}): GeneratedFile {
  const resolved = {
    ...defaultCiWorkflowOptions(),
    ...options
  };
  if (resolved.provider !== "github") {
    throw new Error(`Unsupported CI provider: ${resolved.provider}`);
  }
  assertSafePackageSpec(resolved.packageSpec);

  return {
    path: ".github/workflows/agents-market.yml",
    content: renderGitHubWorkflow(resolved)
  };
}

function renderGitHubWorkflow(options: CiWorkflowOptions): string {
  const doctorStrict = options.strict ? " --strict" : "";
  return `name: Agents Market

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

on:
  pull_request:
    paths:
      - ".agents-market/**"
      - ".claude/agents/**"
      - ".codex/agents/**"
      - ".opencode/agents/**"
      - ".github/workflows/agents-market.yml"
  push:
    branches: [main]
    paths:
      - ".agents-market/**"
      - ".claude/agents/**"
      - ".codex/agents/**"
      - ".opencode/agents/**"
      - ".github/workflows/agents-market.yml"
  workflow_dispatch:

concurrency:
  group: agents-market-${"${{ github.ref }}"}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  doctor:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - name: Check generated agent drift
        run: npx --yes ${options.packageSpec} status --diff --json
      - name: Check installed pack versions
        run: npx --yes ${options.packageSpec} outdated --fail-on-outdated --json
      - name: Preview safe pack updates
        run: npx --yes ${options.packageSpec} update --dry-run --fail-on-skipped --json
      - name: Run Agents Market doctor
        run: npx --yes ${options.packageSpec} doctor${doctorStrict} --json
`;
}
