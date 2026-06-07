# Agents Market

> 🧩 面向 Agent 的 Subagent 市场与安装器。把专业 coding subagents 安全、可验证、可维护地安装到 Claude Code、Codex、OpenCode 项目里。

[English](./README.en.md) | [在线市场](https://tt-a1i.github.io/agents-market) | [Preview Release](https://github.com/tt-a1i/agents-market/releases/tag/preview-0.1.0) | [隐私说明](./PRIVACY.md) | [支持](./SUPPORT.md)

Agents Market 解决的问题很直接：专业 subagent 很有价值，但大多数用户不会自己发现、编写、验证、适配并长期维护每一个 agent 文件。这个项目提供一个带治理能力的 agent 市场，让编码 Agent 或开发者可以按项目场景推荐、预览、安装、更新、回滚和审计 agent packs。

## ✨ 核心能力

| 图标 | 能力 | 说明 |
| --- | --- | --- |
| 🤖 | Agent-native | CLI 输出结构化 JSON，适合 Claude Code、Codex、OpenCode 或未来 MCP/Agent 调用 |
| 🧰 | 多端生成 | 同一套 registry 可以生成 Claude Code、Codex、OpenCode 原生 agent 文件 |
| 🏷️ | 市场分层 | `core` 是深度维护的精选 coding agents，`community` 是带 provenance 的社区导入内容 |
| 🛡️ | 安全预览 | `apply --json` 默认只预览推荐、审计、策略、diff，不直接写文件 |
| 🔁 | 生命周期管理 | manifest 记录安装内容，支持 drift 检测、resolve、update、rollback、uninstall |
| 🔐 | 供应链信任 | registry bundle 支持 Ed25519 签名、checksum、lock、verify-lock、doctor 闭环 |
| 🧾 | Provenance | 社区导入 agent 带 source、license、commit、source checksum |
| ⚙️ | CI 自动化 | 可生成 GitHub workflow，持续检查 registry lock、drift、outdated、update preview、doctor |
| 🌐 | 静态市场 | 生成 `index.html`、`catalog.json`、`agents-market.json`，可部署到 GitHub Pages |
| 🚫 | 零遥测 | no telemetry or analytics；不采集遥测或分析数据，只在显式远程 registry/catalog/import/release 场景访问网络 |

## 🎯 支持目标

| 图标 | 工具 | 输出位置 |
| --- | --- | --- |
| 🟣 | Claude Code | `.claude/agents/*.md` |
| ⚫ | Codex | `.codex/agents/*.toml` |
| 🔵 | OpenCode | `.opencode/agents/*.md` |

## 🚀 快速开始

直接从 GitHub preview tag 使用：

```bash
npx github:tt-a1i/agents-market#preview-0.1.0 init --target all
npx github:tt-a1i/agents-market#preview-0.1.0 recommend
npx github:tt-a1i/agents-market#preview-0.1.0 apply --target all
```

安装推荐 pack 前先看预览：

```bash
npx github:tt-a1i/agents-market#preview-0.1.0 apply --target all --json
```

确认后再写入文件：

```bash
npx github:tt-a1i/agents-market#preview-0.1.0 apply starter-dev-pack --target all --yes
```

从 GitHub Release 安装 preview CLI：

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/install.sh | sh
```

用 Homebrew 安装：

```bash
brew install tt-a1i/tap/agents-market
```

要求 GitHub Artifact Attestation 验证：

```bash
curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/install.sh | AGENTS_MARKET_REQUIRE_ATTESTATION=1 sh
```

本地开发：

```bash
npm install
npm run build
npm run dev -- init --target all
npm run dev -- recommend
npm run dev -- apply --target all --json
npm run dev -- status
```

npm 发布后使用包名：

```bash
npx @agents-market/cli init --target all
npx @agents-market/cli recommend
npx @agents-market/cli apply --target all
```

## 🔌 Claude Code 插件市场

Claude Code 用户可以不碰项目文件，直接装 installer skill：

```
/plugin marketplace add tt-a1i/agents-market
/plugin install agents-market-installer@agents-market
```

装好后在会话里让 Claude 推荐并安装 subagent packs，skill 会走同样的 `apply --json` 预览 → 确认 → `apply --yes` 安装流程。插件源码在 `integrations/claude-plugin/`，市场清单在 `.claude-plugin/marketplace.json`。

## 🧭 推荐工作流

### 1. 🧱 初始化项目

```bash
agents-market init --target all
agents-market init --target claude --dry-run --json
```

`init` 会预览或写入：

- `.agents-market/registry-lock.json`
- Claude/Codex/OpenCode 的 agent-native installer 入口
- 项目信号检测结果
- 推荐 pack
- 下一步 `apply` 和 `doctor` 命令

### 2. 🤖 让 Agent 选择 pack

```bash
agents-market recommend --json
agents-market apply --target all --json
```

`apply --json` 是推荐的 agent-native 主入口。它会一次性返回：

- 项目信号
- 推荐或指定 pack
- audit 风险
- compatibility 结果
- policy 结果
- 文件 diff
- `nextCommands`

### 3. 🔎 搜索具体能力

```bash
agents-market search accessibility --target claude
agents-market search "next performance" --type packs
agents-market search review --tier core --json
agents-market search --type agents --category frontend --json
```

### 4. 🧪 安装前审计

```bash
agents-market audit security-pack --target all --json
agents-market policy check security-pack --target all --json
agents-market diff security-pack --target all --json
agents-market plan security-pack --target claude --policy-preset balanced --json
```

### 5. ✅ 确认安装

```bash
agents-market apply security-pack --target all --policy-preset balanced --yes
agents-market status --json
agents-market doctor --strict --json
```

## 🏷️ 市场分层

每个 agent 和 pack 都有 tier：

| 图标 | Tier | 含义 |
| --- | --- | --- |
| ⭐ | `core` | Agents Market 深度维护的精选 coding agents。用于默认推荐，prompt 质量门槛更高 |
| 🌍 | `community` | 从社区集合导入的 agents。保留 provenance、license、source checksum，但审核标准更轻 |

默认建议优先使用 `core`：

```bash
agents-market list --tier core
agents-market search security --tier core --json
```

需要探索大规模社区内容时使用 `community`：

```bash
agents-market list --tier community
agents-market search seo --tier community --json
```

## 🤖 Agent 友好的 JSON 契约

所有 CLI JSON 输出都包含 `schemaVersion`。当命令带 `--json` 且失败时，CLI 返回结构化错误，而不是让 Agent 解析裸 stderr：

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "PACK_NOT_FOUND",
    "message": "Unknown pack: nonexistent-pack",
    "hint": "Run `agents-market list --json` or `agents-market search <query> --json` to see available packs.",
    "nextCommands": [
      "agents-market search <keywords> --json",
      "agents-market list --json"
    ]
  }
}
```

发现 agent 时不要默认拉完整 prompt：

```bash
agents-market search review --json
agents-market list --agents --json --limit 20 --fields id,name,description,category,permission,tier
```

只有在明确需要审查 prompt body 时才使用：

```bash
agents-market list --agents --json --full --limit 1 --fields id,prompt
```

## ⌨️ 常用命令

```bash
# 市场浏览
agents-market list
agents-market list --agents --json
agents-market search accessibility --target claude
agents-market recommend --json

# 安装预览与确认
agents-market apply --target all --json
agents-market apply nextjs-pack --target all --policy-preset balanced --yes
agents-market plan starter-dev-pack --target all --json
agents-market diff starter-dev-pack --target all --json

# 策略与健康检查
agents-market policy init --preset balanced
agents-market policy check starter-dev-pack --target all --json
agents-market status --diff --json
agents-market doctor --strict --json

# 生命周期
agents-market outdated --json
agents-market update --dry-run --json
agents-market rollback starter-dev-pack --target claude --json
agents-market uninstall starter-dev-pack --target claude --dry-run --json

# Registry 信任链
agents-market registry info --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --json
agents-market registry verify --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --public-key https://tt-a1i.github.io/agents-market/registry-public.pem --key-id main --json
agents-market registry lock --registry https://tt-a1i.github.io/agents-market/registry.bundle.json --public-key https://tt-a1i.github.io/agents-market/registry-public.pem --key-id main
agents-market registry verify-lock --json

# 集成与 CI
agents-market integrations install --target all
agents-market ci init --provider github --yes

# 静态 catalog
agents-market catalog build --out ./site
agents-market catalog verify --dir ./site
agents-market catalog init --url https://tt-a1i.github.io/agents-market/agents-market.json --target all --json

# 导入社区 agent
agents-market import markdown ./agent.md --target claude --out ./registry/agents
agents-market import directory ./third-party-agents --target claude --out ./registry/agents --pack imported-pack --pack-out ./registry/packs
agents-market import repo owner/community-agents --target claude --path agents --out ./registry/agents --pack community-pack --pack-out ./registry/packs
```

完整命令参考见 [英文 README](./README.en.md) 和 `agents-market --help`。

## 🔁 安装 Manifest 与生命周期

安装 pack 会写入 `.agents-market/manifest.json`，记录：

- pack id 和版本
- target
- 生成文件路径
- 文件内容 hash
- registry source/version/checksum

这让后续维护可控：

| 图标 | 命令 | 用途 |
| --- | --- | --- |
| 🔍 | `status` | 检查生成文件是否 clean、modified、missing |
| 🧩 | `resolve` | 接受 registry 内容、保留本地修改、或停止跟踪某个文件 |
| 🕒 | `outdated` | 比较已安装 pack 和当前 registry 版本 |
| ⬆️ | `update` | 预览或更新已安装 pack，并保存 rollback 快照 |
| ↩️ | `rollback` | 回滚上一次 update |
| 🧹 | `uninstall` | 删除生成文件，默认跳过用户改过的文件 |
| 🩺 | `doctor` | 检查 manifest、registry lock、policy、drift、target directory |

自动化里优先使用：

```bash
agents-market status --diff --json
agents-market outdated --fail-on-outdated --json
agents-market update --dry-run --fail-on-skipped --json
agents-market doctor --strict --json
```

## 🔐 Registry 来源与签名

命令支持这些 registry source：

| 图标 | Source | 说明 |
| --- | --- | --- |
| 📦 | `bundled` | CLI 自带 registry |
| 📁 | directory | 本地 `agents/` + `packs/` registry 目录 |
| 🧳 | bundle file | `agents-market registry export` 生成的 JSON bundle |
| 🌐 | URL | HTTP(S) registry bundle |

锁定 registry：

```bash
agents-market registry lock --registry ./registry.bundle.json
```

验证 lock：

```bash
agents-market registry verify-lock --json
```

签名 bundle：

```bash
agents-market registry export --out ./registry.bundle.json --private-key ./registry-private.pem --key-id main
```

验证签名：

```bash
agents-market registry verify --registry ./registry.bundle.json --public-key ./registry-public.pem --key-id main --json
```

签名使用 Ed25519，覆盖 registry bundle checksum。签名 lock 会把 public key 和 key id 写进 `.agents-market/registry-lock.json`，后续 `verify-lock`、`doctor`、CI 会继续验证同一条信任链。

## 🧪 Prompt 质量与导入治理

`registry lint --strict` 会检查：

- 引用完整性
- 重复 ID
- tier 一致性
- permission/tool 一致性
- 推荐信号
- pack 大小
- provenance/license/source checksum
- prompt quality
- 跨 agent 重复段落

Prompt quality 是确定性评分，覆盖角色、任务、上下文获取、安全边界、输出格式、领域词、验证姿态。重复出现在多个 agent 里的模板段落会被识别为 boilerplate，不会给大批量导入内容刷分。

导入社区模板：

```bash
agents-market import repo VoltAgent/awesome-claude-code-subagents \
  --target claude \
  --path categories \
  --out ./registry/agents \
  --pack community-pack \
  --pack-out ./registry/packs
```

导入后必须跑：

```bash
agents-market registry lint --registry ./registry --strict --json
agents-market registry review --registry ./registry --summary-json registry-review.json --summary-markdown registry-review.md
```

## 🔌 Agent-native 集成

安装 agent-native 入口：

```bash
agents-market integrations install --target all
```

会生成：

| 图标 | 工具 | 入口 |
| --- | --- | --- |
| 🟣 | Claude Code | `.claude/skills/agents-market-installer/SKILL.md` |
| ⚫ | Codex | `.codex/skills/agents-market-installer/SKILL.md` |
| 🔵 | OpenCode | `.opencode/commands/agents-market.md` |

打包集成：

```bash
agents-market integrations package --target all --out ./integration-packages
```

输出：

- `agents-market-claude/`
- `agents-market-codex/`，包含 `.codex-plugin/plugin.json`
- `agents-market-opencode/`

Agent 调用时应优先走：

```bash
agents-market apply --target all --json
agents-market search <query> --json
agents-market plan <pack> --target all --json
agents-market doctor --strict --json
```

## 🌐 静态市场 Catalog

构建：

```bash
agents-market catalog build --out ./site --base-url https://example.com/agents-market
```

产物：

| 图标 | 文件 | 用途 |
| --- | --- | --- |
| 🖥️ | `index.html` | 面向人类的搜索页面 |
| 🧠 | `catalog.json` | 面向机器的完整 catalog |
| 🤖 | `agents-market.json` | 面向 Agent 的紧凑入口 |
| 📦 | `registry.bundle.json` | 可验证 registry bundle |
| 🔑 | `registry-public.pem` | hosted signature public key |
| 🧭 | `site.webmanifest` / `robots.txt` / `sitemap.xml` / `favicon.svg` | 静态站点元数据 |

部署后验证：

```bash
agents-market catalog verify --url https://example.com/agents-market/catalog.json --json
```

连接项目到 hosted catalog：

```bash
agents-market catalog init --url https://tt-a1i.github.io/agents-market/agents-market.json --target all --json
```

## 🚢 发布与供应链

Preview release 包含：

- registry bundle
- npm tarball
- SPDX SBOM
- SHA256SUMS
- 完整可验证 artifact archive
- Claude/Codex/OpenCode installer archives
- GitHub Artifact Attestations

验证 release artifact：

```bash
agents-market release verify-artifacts --archive ./agents-market-release-artifacts-0.1.0.tgz
```

发布和仓库运维流程见 [docs/operations.md](./docs/operations.md) 和 [docs/release.md](./docs/release.md)。

## 🗂️ 仓库结构

```text
registry/
  agents/      agent definitions
  packs/       pack definitions
  changelog.json
src/
  index.ts     CLI entrypoint
  registry.ts  registry loading, bundles, signatures, locks
  install.ts   target file generation
  workflow.ts  apply/recommend/install orchestration
  catalog.ts   static catalog generator and verifier
  importer.ts  markdown/directory/github import normalization
docs/
integrations/
tests/
```

## 🧠 设计原则

- 默认让 Agent 操作，而不是让用户手动翻几百个 agents。
- 默认预览，不默认写入。
- 默认推荐 `core`，社区内容可搜索、可安装，但不冒充精选内容。
- 所有可自动化输出都必须结构化、版本化、可解析。
- 安装不是一次性复制文件，必须有 manifest、drift、update、rollback。
- 远程市场必须能被签名、锁定、复验。
- 导入社区内容必须保留 provenance，而不是只复制 prompt。

## 🚫 隐私

Agents Market 不会主动上报数据。只有在你显式使用远程 registry、public key、hosted catalog、GitHub import、release 或 package source 时才访问网络。详情见 [PRIVACY.md](./PRIVACY.md)。

## 🤝 支持与贡献

- 使用问题和 bug：见 [SUPPORT.md](./SUPPORT.md)
- 安全问题：见 [SECURITY.md](./SECURITY.md)
- 贡献 agent：见 [docs/contributing-agents.md](./docs/contributing-agents.md)
- 导入第三方 agent：见 [docs/import.md](./docs/import.md)
- Package changelog：见 [CHANGELOG.md](./CHANGELOG.md)
- Registry changelog：`agents-market registry changelog --json`
