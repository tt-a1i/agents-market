# Coding Agent Subagent Mechanisms Research

## Executive Summary

Claude Code, Codex, and OpenCode all have mechanisms for specialized agents/subagents, but they are not interchangeable:

- Claude Code: `.claude/agents/*.md`, YAML frontmatter plus Markdown body. Automatic delegation can happen based on `description`.
- Codex: `.codex/agents/*.toml`, TOML custom agent files. Subagents are enabled, but Codex only spawns them when explicitly asked.
- OpenCode: `.opencode/agents/*.md` or `opencode.json`, YAML frontmatter plus Markdown body or JSON config. It has primary agents and subagents; primary agents can invoke subagents, and users can use `@` mentions.

For this new repository, the practical design opportunity is to author equivalent agent rosters for each target tool if cross-tool support matters.

## Cross-Tool Comparison

| Tool | Project path | User/global path | File format | Auto routing | Explicit invocation | Parallel subagents |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/agents/` | `~/.claude/agents/` | Markdown + YAML frontmatter | Yes, based on `description` and context | Natural language, `@` mention, `claude --agent`, settings `agent` | Yes; foreground/background, fork, worktree isolation |
| Codex | `.codex/agents/` | `~/.codex/agents/` | TOML | No; explicit spawn required | Prompt "spawn/delegate/use agents"; CLI `/agent` to inspect threads | Yes; Codex app and CLI, max thread/depth settings |
| OpenCode | `.opencode/agents/` or `opencode.json` | `~/.config/opencode/agents/` | Markdown + YAML frontmatter or JSON | Yes for primary-agent-to-subagent routing | `@` mention; primary agent selection; config default primary agent | Yes via Task tool/subagents |

## Codex Agents

Codex has official subagent workflows and custom agents. The closest match to Claude Code `.claude/agents` is Codex `.codex/agents`, but the semantics are different: Codex does not automatically spawn subagents just because a task matches an agent description. You must explicitly ask for subagents or parallel agent work.

### Codex Locations

- Project custom agents: `.codex/agents/`
- Personal custom agents: `~/.codex/agents/`
- Global subagent settings: `[agents]` in Codex configuration

Codex also has `AGENTS.md` and skills, but those are separate:

- `AGENTS.md`: persistent project/global instructions loaded into Codex. It is not an agent roster.
- Skills: reusable task workflows under `.agents/skills` or other skill scopes. They can be implicitly or explicitly invoked, but they are not independent spawned agent threads.
- Plugins: distribution bundles for skills, app integrations, MCP config, hooks, and related assets. They are not themselves subagents.
- MCP: tool/context extension mechanism, not a subagent definition.
- Automations/cloud tasks/worktrees: scheduling or isolated parallel execution surfaces, adjacent to agents but not the same as same-session subagents.

### Codex Built-In Agents

Codex documents these built-ins:

- `default`: general-purpose fallback.
- `worker`: execution-focused agent for implementation and fixes.
- `explorer`: read-heavy codebase exploration agent.

### Codex Custom Agent Format

Codex custom agents are standalone TOML files. Each file defines one custom agent and acts like a configuration layer for spawned Codex sessions.

Required fields:

- `name`
- `description`
- `developer_instructions`

Common optional fields:

- `nickname_candidates`
- `model`
- `model_reasoning_effort`
- `sandbox_mode`
- `mcp_servers`
- `skills.config`

Example:

```toml
name = "code-reviewer"
description = "PR reviewer focused on correctness, security, regressions, and missing tests."
developer_instructions = """
Review code like an owner.
Prioritize behavioral correctness, security, maintainability, and missing tests.
Return findings with file paths, severity, and concise remediation.
Do not modify files.
"""
model = "gpt-5.5"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
nickname_candidates = ["Atlas", "Delta", "Echo"]
```

### Codex Invocation And Parallelism

Codex subagent workflows are available by default in current releases, surfaced in the Codex app and CLI. IDE visibility is documented as coming later.

Codex only spawns subagents when explicitly asked. Good trigger prompts look like:

```text
Review this branch with parallel subagents.
Spawn one subagent for security risks, one for test gaps, and one for maintainability.
Wait for all three, then summarize findings by category with file references.
```

Codex handles orchestration: spawning agents, routing follow-ups, waiting for results, closing threads, and returning a consolidated response. In the CLI, `/agent` lets you inspect and switch active agent threads.

Useful `[agents]` settings:

- `agents.max_threads`: concurrent open agent thread cap; default documented as 6.
- `agents.max_depth`: spawned agent nesting depth; default documented as 1.
- `agents.job_max_runtime_seconds`: default timeout for some worker jobs.

### Codex Permissions And Sandboxing

Subagents inherit the current sandbox policy. In interactive CLI sessions, approval requests can surface from inactive agent threads. In non-interactive contexts, actions that need fresh approval fail and the error is returned to the parent workflow.

Codex reapplies parent turn runtime overrides when spawning children, including interactive permission changes or `--yolo`, even if a custom agent file sets different defaults. You can still set a custom agent to read-only or otherwise override sandbox-related config for that spawned session.

### Codex Difference From Claude Code

- Codex uses TOML, not Markdown/YAML.
- Codex requires explicit spawn instructions; Claude Code can automatically delegate based on description.
- Codex custom agents are heavier because they are session configuration layers.
- Codex has documented nesting controls (`agents.max_depth`), while Claude Code named subagents generally cannot spawn subagents.
- Codex `AGENTS.md` should not be confused with custom agents; it is durable instruction context.

## OpenCode Agents

OpenCode has first-class agents and subagents. Its mechanism is closer to Claude Code than Codex in authoring shape because Markdown agent files use YAML frontmatter plus a prompt body.

### OpenCode Agent Types

OpenCode has two main agent types:

- Primary agents: the assistants users interact with directly. Users can switch them during a session, commonly with Tab or the configured keybind.
- Subagents: specialized assistants invoked by primary agents for focused tasks. Users can also invoke them manually with `@` mentions.

Documented built-ins:

- Primary: `build`, `plan`
- Subagents: `general`, `explore`, `scout`

`build` is the default full-development primary agent. `plan` is restricted for planning and analysis.

### OpenCode Locations

- Project Markdown agents: `.opencode/agents/`
- Global Markdown agents: `~/.config/opencode/agents/`
- JSON-style configuration: `opencode.json` under the `agent` key

In Markdown mode, the filename is the agent name. For example:

- `.opencode/agents/reviewer.md` defines `reviewer`.
- `~/.config/opencode/agents/docs-writer.md` defines `docs-writer`.

### OpenCode Markdown Format

OpenCode Markdown agents use YAML frontmatter plus prompt body:

```md
---
description: Reviews code for quality, correctness, and security
mode: subagent
model: anthropic/claude-sonnet-4-5
permission:
  edit: deny
  write: deny
---

You are a code review specialist.
Focus on correctness, regressions, security issues, and missing tests.
Return concise findings with file paths and suggested fixes.
```

Important options:

- `description`: required routing/help text.
- `mode`: `primary`, `subagent`, or `all`.
- `permission`: preferred modern control for tool access.
- `model`: per-agent model override.
- `prompt`: path to a separate system prompt file.
- `steps`: max agentic iterations.
- `hidden`: hide a subagent from the `@` autocomplete menu.
- `color`: UI color.
- `temperature`, `top_p`, and provider-specific model options.

### OpenCode JSON Configuration

Agents can also be defined in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-5",
      "prompt": "You are a code reviewer. Focus on security, performance, and maintainability.",
      "permission": {
        "edit": "deny",
        "write": "deny"
      }
    }
  }
}
```

OpenCode also supports `default_agent`, but the default must be a primary agent, not a subagent.

### OpenCode Invocation And Routing

OpenCode primary agents can invoke subagents for specific tasks. Users can manually invoke subagents with `@` mentions. This makes OpenCode closer to Claude Code than Codex for description-driven routing, although the exact routing and permission model is OpenCode-specific.

Task permissions control which subagents an agent can invoke via the Task tool:

```json
{
  "agent": {
    "orchestrator": {
      "mode": "primary",
      "permission": {
        "task": {
          "*": "deny",
          "orchestrator-*": "allow",
          "code-reviewer": "ask"
        }
      }
    }
  }
}
```

If a subagent is denied through `permission.task`, it is removed from the Task tool description, so the model is less likely to attempt that delegation. Users can still directly invoke subagents through `@` autocomplete.

### OpenCode Difference From Claude Code

- OpenCode has first-class primary agents and subagents in one agent system.
- OpenCode Markdown agent identity comes from filename; Claude Code identity comes from frontmatter `name`.
- OpenCode uses `permission` for allow/ask/deny style controls; Claude Code uses fields such as `tools`, `disallowedTools`, and `permissionMode`.
- OpenCode supports `opencode.json` agent definitions; Claude Code's file-based custom subagents are Markdown files under `.claude/agents`.
- Claude Code has additional documented subagent-specific fields like `memory`, `hooks`, `skills`, `mcpServers`, `background`, `effort`, and `isolation: worktree`.

## Definition Locations

Claude Code supports several subagent sources, in priority order:

1. Managed settings
2. `--agents` CLI JSON for the current session
3. Project agents under `.claude/agents/`
4. User agents under `~/.claude/agents/`
5. Plugin `agents/` directories

Project agents are discovered by walking upward from the current working directory. User agents apply across projects. Project and user `agents/` directories are scanned recursively, but the agent identity comes from the `name` frontmatter field, not the filename or subfolder.

## File Format

Example:

```md
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code after changes.
tools: Read, Grep, Glob, Bash
model: inherit
color: cyan
---

You are a senior code reviewer. Inspect diffs, prioritize correctness and security,
and return findings with file paths and actionable fixes.
```

Required fields:

- `name`: unique identifier, generally lowercase with hyphens.
- `description`: when Claude should delegate to this subagent.

Important optional fields:

- `tools`: allowlist. If omitted, inherits all available tools.
- `disallowedTools`: denylist applied before `tools`.
- `model`: `sonnet`, `opus`, `haiku`, full model ID, or `inherit`.
- `permissionMode`: `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, or `plan`.
- `maxTurns`: maximum agentic turns.
- `skills`: preloaded skills.
- `mcpServers`: MCP servers scoped to the agent.
- `hooks`: lifecycle hooks scoped to the agent.
- `memory`: `user`, `project`, or `local` persistent memory.
- `background`: run as non-blocking background task by default.
- `effort`: reasoning effort override.
- `isolation`: `worktree` for a temporary git worktree.
- `color`: UI color.
- `initialPrompt`: first user turn when this agent runs as the main session agent.

## Invocation Modes

Automatic delegation:

- Claude compares the user's task, current context, and each subagent `description`.
- Descriptions should be specific and action-oriented.
- Wording such as "use proactively" encourages automatic use.

Explicit delegation:

- Natural language: "Use the code-reviewer subagent to review my changes."
- `@` mention: `@"code-reviewer (agent)" review the auth changes`; this guarantees that subagent is selected for the task.
- Main-thread agent: `claude --agent code-reviewer`.
- Project default: `.claude/settings.json` with `{ "agent": "code-reviewer" }`.

## Runtime Behavior

Named subagents:

- Start in their own fresh context window.
- Receive their system prompt and the task prompt written by the parent.
- Do not receive the parent conversation history or prior tool results.
- Usually load project memory such as `CLAUDE.md` and git status, except special built-ins like Explore and Plan.
- Keep intermediate tool results in their own transcript.
- Return only their final message to the parent as the Agent tool result.

Forked subagents:

- Inherit the full parent conversation, system prompt, tools, model, and history.
- Useful when the side task needs too much context to restate.
- Still keep their tool calls outside the main conversation and return a final result.

## Parallelism

Multiple subagents can run concurrently for independent work. Good cases include separate research tracks, independent module audits, test/log analysis, or competing implementation approaches. Poor cases include tightly sequential work, small tasks, or parallel edits to the same files.

Related but distinct mechanisms:

- `/agents`: manage subagents in the current session.
- `claude agents`: agent view for background sessions.
- Agent teams: coordinated sessions with shared task lists and inter-agent messaging.
- Dynamic workflows: scripted multi-subagent orchestration.
- Worktrees: isolation for file edits.

## Tool And Permission Rules

Subagents inherit parent tools by default, unless restricted. Some UI/session-bound tools are unavailable to subagents even if listed. Subagents cannot spawn other subagents.

Foreground subagents block the main conversation and pass permission prompts to the user. Background subagents run concurrently, but auto-deny actions that would require interactive permission.

`isolation: worktree` lets a subagent edit in a temporary git worktree, reducing conflict risk.

## Local Project Findings

Checked paths:

- `/Users/tsk/tt-a1i/agents_market`: no `.claude`, no agents, no settings, no hooks, no commands.
- `/Users/tsk/tt-a1i/.claude`: exists, contains `settings.local.json` and `skills/manim`, but no `agents/`.
- `/Users/tsk/.claude`: has `settings.json`, no user-level `agents/` files found.
- `/Users/tsk/tt-a1i/warp/.claude`: settings only.
- `/Users/tsk/tt-a1i/ccusage/.claude`: settings and `CLAUDE.md`, but no agents.

Therefore, no local custom Claude Code agents are currently defined for `agents_market`.

## Practical Recommendations

If you want this project to use custom agents, create a source-of-truth roster first, then generate tool-specific versions:

- Claude Code: `.claude/agents/*.md`
- Codex: `.codex/agents/*.toml`
- OpenCode: `.opencode/agents/*.md`

Start with 3 to 5 specialists instead of many overlapping ones.

Good starter set:

- `code-reviewer`: read-only review after changes.
- `debugger`: investigate failures and optionally edit.
- `test-runner`: run tests, summarize failing cases, avoid file edits.
- `docs-researcher`: search docs and return citations/summaries.
- `frontend-verifier`: browser or screenshot verification if tooling is configured.

Keep `description` highly specific, because it is the routing signal.

## Sources

- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agents
- https://code.claude.com/docs/en/agent-sdk/subagents
- https://code.claude.com/docs/en/settings
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/concepts/subagents
- https://developers.openai.com/codex/skills
- https://developers.openai.com/codex/guides/agents-md
- https://dev.opencode.ai/docs/agents/
- https://dev.opencode.ai/docs/config/
