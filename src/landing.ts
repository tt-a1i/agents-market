import { resolveTier } from "./tier.js";
import type { AgentDefinition, PackDefinition, Registry, RegistryMetadata } from "./types.js";

// Marketing landing page for the static site root. Implements the Claude Design
// handoff (dark-first, IBM Plex, jade accent): nav → hero with typing terminal →
// stats → capabilities → workflow → tiers → featured packs/agents → install
// switcher → trust chain → CTA. The functional browse catalog lives at
// catalog.html; this page links to it.

export interface LandingOptions {
  title: string;
  bundleUrl: string;
  siteUrl?: string;
  metadata?: RegistryMetadata;
}

interface FeaturedPackCopy {
  id: string;
  name: string;
  desc: string;
  tags: string[];
}

interface FeaturedAgentCopy {
  id: string;
  name: string;
  desc: string;
}

// Curated marketing copy (zh) for known bundled entries; tier, counts,
// permissions, and categories always come from the registry at build time.
const FEATURED_PACKS: FeaturedPackCopy[] = [
  {
    id: "starter-dev-pack",
    name: "Starter Dev Pack",
    desc: "面向 review、debugging、tests 与文档研究的基线 coding agents。",
    tags: ["js · ts", "python", "go · rust"]
  },
  {
    id: "security-pack",
    name: "Security Pack",
    desc: "应用安全审计、依赖风险、secrets 扫描与代码审查，安装前可做 audit 与 policy 检查。",
    tags: ["security", "audit"]
  },
  {
    id: "nextjs-pack",
    name: "Next.js Pack",
    desc: "面向 Next.js 项目的前端、性能与可访问性组合，按 package.json 信号自动推荐。",
    tags: ["nextjs", "frontend"]
  },
  {
    id: "agency-engineering-1",
    name: "Agency Engineering",
    desc: "从 agency-agents 导入的工程类 agents，按主题拆成可发现、可选装的 pack。",
    tags: ["imported", "engineering"]
  },
  {
    id: "agency-marketing-2",
    name: "Agency Marketing",
    desc: "SEO、付费媒体、社媒与内容策略，覆盖中外多平台的增长场景。",
    tags: ["imported", "marketing"]
  },
  {
    id: "voltagent-quality-security-1",
    name: "VoltAgent Quality & Security",
    desc: "质量保障与安全方向的 VoltAgent 集合，带完整 provenance 与 license。",
    tags: ["imported", "quality"]
  }
];

const FEATURED_AGENTS: FeaturedAgentCopy[] = [
  { id: "agency-code-reviewer", name: "Code Reviewer", desc: "专注正确性、安全、可维护性与性能的代码审查 —— 给出可执行反馈，而非风格偏好。" },
  { id: "agency-security-architect", name: "Security Architect", desc: "威胁建模、secure-by-design 架构与信任边界分析，覆盖 web、API、云原生与分布式系统。" },
  { id: "agency-prompt-engineer", name: "Prompt Engineer", desc: "系统化地编写、测试与优化 prompt，把模糊指令变成可靠、可上线的 AI 行为。" },
  { id: "agency-frontend-developer", name: "Frontend Developer", desc: "精通现代 Web 技术与 React / Vue / Angular，负责 UI 实现与性能优化。" },
  { id: "agency-devops-automator", name: "DevOps Automator", desc: "基础设施自动化、CI/CD 流水线开发与云端运维的专家型 agent。" },
  { id: "agency-ux-researcher", name: "UX Researcher", desc: "用户行为分析、可用性测试与数据驱动的设计洞察，输出可落地的研究结论。" }
];

const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>';

export function renderLandingHtml(registry: Registry, options: LandingOptions): string {
  const description = "把专业 coding subagents 安全、可验证、可维护地装进 Claude Code、Codex、OpenCode 项目里。";
  const pageTitle = `${options.title} — 面向 Agent 的 subagent 市场与安装器`;
  const year = new Date().getFullYear();
  const packCards = FEATURED_PACKS.flatMap((copy) => {
    const pack = registry.packs.find((candidate) => candidate.id === copy.id);
    return pack ? [renderPackCard(copy, pack)] : [];
  }).join("\n");
  const agentCards = FEATURED_AGENTS.flatMap((copy) => {
    const agent = registry.agents.find((candidate) => candidate.id === copy.id);
    return agent ? [renderAgentCard(copy, agent)] : [];
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeAttribute(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeAttribute(pageTitle)}">
<meta property="og:description" content="${escapeAttribute(description)}">
<meta property="og:site_name" content="${escapeAttribute(options.title)}">
${options.siteUrl ? `<meta property="og:url" content="${escapeAttribute(options.siteUrl)}">` : ""}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeAttribute(pageTitle)}">
<meta name="twitter:description" content="${escapeAttribute(description)}">
${options.siteUrl ? `<link rel="canonical" href="${escapeAttribute(options.siteUrl)}">` : ""}
<link rel="manifest" href="site.webmanifest">
<link rel="sitemap" type="application/xml" href="sitemap.xml">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${LANDING_CSS}
</style>
</head>
<body>

<header class="nav" id="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="#top" aria-label="${escapeAttribute(options.title)}">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="brand-name">Agents&nbsp;<b>Market</b></span>
    </a>
    <nav class="nav-links" aria-label="主导航">
      <a href="#capabilities">能力</a>
      <a href="#workflow">工作流</a>
      <a href="#market">市场</a>
      <a href="#install">安装</a>
      <a href="#trust">信任</a>
    </nav>
    <div class="nav-right">
      <a class="gh-pill" href="https://github.com/tt-a1i/agents-market" target="_blank" rel="noopener">
        <span class="star">★</span><span class="gh-label">GitHub</span>
      </a>
      <a class="btn btn-primary" href="#install">安装 CLI</a>
      <button class="nav-toggle" id="navToggle" aria-label="菜单">≡</button>
    </div>
  </div>
</header>

<main id="top">

<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">AGENT-NATIVE MARKETPLACE · v0.1.0 preview</span>
      <h1>给你的 coding agent，<br>配一支<span class="hl">专业 subagent 团队</span></h1>
      <p class="sub">Agents Market 是面向 Agent 的 subagent 市场与安装器。推荐、预览、安装、更新、回滚、审计 —— 全程结构化输出，可签名、可锁定、零遥测。</p>

      <div class="hero-cta">
        <div class="cmd" data-copy="brew install tt-a1i/tap/agents-market">
          <span class="dollar">$</span>
          <code>brew install tt-a1i/tap/agents-market</code>
          <button class="copy" aria-label="复制命令" title="复制">${COPY_ICON}</button>
        </div>
        <div class="cmd-row">
          <span class="alt"><b>或 npx 免安装</b>&nbsp;·&nbsp;npx github:tt-a1i/agents-market#preview-0.1.0 init</span>
        </div>
        <div class="hero-links">
          <a class="text-link" href="catalog.html">在线市场 <span class="arr">→</span></a>
          <a class="text-link" href="#workflow">看看怎么用 <span class="arr">→</span></a>
        </div>
      </div>

      <div class="targets">
        <div class="targets-label">一套 registry，生成三端原生 agent</div>
        <div class="target-row">
          <span class="target"><span class="dot" style="background:var(--brand-claude)"></span><b>Claude Code</b><span class="path">.claude/agents/*.md</span></span>
          <span class="target"><span class="dot" style="background:var(--brand-codex)"></span><b>Codex</b><span class="path">.codex/agents/*.toml</span></span>
          <span class="target"><span class="dot" style="background:var(--brand-opencode)"></span><b>OpenCode</b><span class="path">.opencode/agents/*.md</span></span>
        </div>
      </div>
    </div>

    <div class="terminal" aria-hidden="true">
      <div class="term-bar">
        <span class="tl"><i></i><i></i><i></i></span>
        <span class="term-title">agents-market — apply --target all --json</span>
      </div>
      <div class="term-body" id="term"></div>
    </div>
  </div>
</section>

<section class="stats">
  <div class="wrap stats-inner">
    <div class="stat"><div class="n" data-count="${registry.agents.length}">0</div><div class="lbl">精选 + 社区 <b>agents</b></div></div>
    <div class="stat"><div class="n" data-count="${registry.packs.length}">0</div><div class="lbl">可安装 <b>packs</b></div></div>
    <div class="stat"><div class="n kbd-num">3</div><div class="lbl">原生 <b>targets</b></div></div>
    <div class="stat"><div class="n"><span class="pre">0</span></div><div class="lbl">遥测 · <b>no telemetry</b></div></div>
  </div>
</section>

<section class="section" id="capabilities">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">核心能力</span>
      <h2>不是复制 prompt，<br>而是有治理的安装生命周期。</h2>
      <p class="lede">专业 subagent 很有价值，但发现、验证、适配、长期维护每个 agent 文件的成本很高。Agents Market 把这一整套变成可被 Agent 调用的、确定性的工作流。</p>
    </div>

    <div class="cap-grid reveal">
      <article class="cap">
        <div class="cap-top"><span class="cap-idx">01</span><span class="cap-glyph">
          <svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 11 7 17l4 6M23 11l4 6-4 6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="17" r="1.6" fill="currentColor" stroke="none"/></svg>
        </span></div>
        <h3>Agent-native</h3>
        <p>所有命令 <code>--json</code> 输出结构化、版本化结果，带 <code>schemaVersion</code> 与 <code>nextCommands</code>，天然适合 Claude Code、Codex、OpenCode 调用。</p>
      </article>
      <article class="cap">
        <div class="cap-top"><span class="cap-idx">02</span><span class="cap-glyph">
          <svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 6c5 3 9 3 9 3v6c0 6-4 10-9 13-5-3-9-7-9-13V9s4 0 9-3Z" stroke-linejoin="round"/><path d="M13 16.5 16 19.5 21.5 14" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span></div>
        <h3>安全预览</h3>
        <p><code>apply --json</code> 默认只返回推荐、审计、策略检查与文件 diff，<b style="color:var(--text);font-weight:500">不直接写文件</b>。确认后再 <code>--yes</code> 落地。</p>
      </article>
      <article class="cap">
        <div class="cap-top"><span class="cap-idx">03</span><span class="cap-glyph">
          <svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M26 17a9 9 0 1 1-3-6.7" stroke-linecap="round"/><path d="M26 8v5h-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span></div>
        <h3>生命周期管理</h3>
        <p>安装写入 <code>manifest.json</code>，记录文件 hash 与 registry 来源，支撑 drift 检测、resolve、update、rollback、uninstall。</p>
      </article>
      <article class="cap">
        <div class="cap-top"><span class="cap-idx">04</span><span class="cap-glyph">
          <svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="15" width="16" height="12" rx="2"/><path d="M12 15v-3a5 5 0 0 1 10 0v3" stroke-linecap="round"/><circle cx="17" cy="20.5" r="1.5" fill="currentColor" stroke="none"/></svg>
        </span></div>
        <h3>供应链信任</h3>
        <p>registry bundle 支持 Ed25519 签名、checksum、lock、verify-lock、doctor 闭环，确保远程市场内容可被签名、锁定、复验。</p>
      </article>
      <article class="cap">
        <div class="cap-top"><span class="cap-idx">05</span><span class="cap-glyph">
          <svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 8h10l4 4v14H10z" stroke-linejoin="round"/><path d="M20 8v4h4M13 17h8M13 21h6" stroke-linecap="round"/></svg>
        </span></div>
        <h3>Provenance</h3>
        <p>社区导入的 agent 保留 source、license、commit 与 source checksum —— 来源透明、可追溯，而不是匿名拷贝一段 prompt。</p>
      </article>
      <article class="cap">
        <div class="cap-top"><span class="cap-idx">06</span><span class="cap-glyph">
          <svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="17" cy="17" r="9"/><path d="M11 11l12 12" stroke-linecap="round"/></svg>
        </span></div>
        <h3>零遥测</h3>
        <p>不采集任何遥测或分析数据。只有在你显式使用远程 registry、hosted catalog、GitHub 导入或 release 时才访问网络。</p>
      </article>
    </div>
  </div>
</section>

<section class="section" id="workflow" style="background:var(--bg-soft);border-block:1px solid var(--line)">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">推荐工作流</span>
      <h2>init → preview → apply → doctor</h2>
      <p class="lede">默认预览、不默认写入；默认推荐 <code style="font-family:var(--font-mono);color:var(--accent)">core</code>。整条链路对人和对 Agent 都是可解析的。</p>
    </div>

    <div class="flow reveal">
      <div class="flow-step">
        <h4>初始化项目</h4>
        <p>锁定 registry、装好 agent-native 入口、检测项目信号并给出推荐。</p>
        <code class="flow-cmd">agents-market init <span class="fl">--target all</span></code>
      </div>
      <div class="flow-step">
        <h4>预览推荐</h4>
        <p>一次返回信号、推荐 pack、audit、compatibility、policy 和文件 diff。</p>
        <code class="flow-cmd">apply <span class="fl">--target all --json</span></code>
      </div>
      <div class="flow-step active">
        <h4>确认安装</h4>
        <p>检查无误后写入；带 policy 预设，按目标生成原生 agent 文件。</p>
        <code class="flow-cmd">apply security-pack <span class="fl">--yes</span></code>
      </div>
      <div class="flow-step">
        <h4>健康检查</h4>
        <p>校验 manifest、registry lock、policy、drift 与 target 目录闭环。</p>
        <code class="flow-cmd">doctor <span class="fl">--strict --json</span></code>
      </div>
    </div>
  </div>
</section>

<section class="section" id="market">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">市场分层</span>
      <h2>精选有门槛，<br>社区有出处。</h2>
      <p class="lede">每个 agent 与 pack 都带 tier。默认推荐深度维护的 <code style="font-family:var(--font-mono);color:var(--accent)">core</code>，需要规模时再探索带 provenance 的 <code style="font-family:var(--font-mono);color:var(--accent)">community</code>。</p>
    </div>

    <div class="tiers reveal">
      <div class="tier core">
        <div class="tier-head">
          <span class="tier-badge">★ core</span>
          <h3>精选 coding agents</h3>
        </div>
        <p class="tier-sub">Agents Market 深度维护，用于默认推荐，prompt 质量门槛更高。</p>
        <ul>
          <li>确定性 prompt quality 评分把关</li>
          <li>覆盖 review / debug / test / docs 等核心场景</li>
          <li>跨 agent 重复段落会被识别为 boilerplate</li>
        </ul>
        <div class="tier-cmd">
          <div class="cmd" data-copy="agents-market list --tier core">
            <span class="dollar">$</span><code>agents-market list --tier core</code>
            <button class="copy" aria-label="复制">${COPY_ICON}</button>
          </div>
        </div>
      </div>
      <div class="tier community">
        <div class="tier-head">
          <span class="tier-badge">🌍 community</span>
          <h3>带出处的社区导入</h3>
        </div>
        <p class="tier-sub">从社区集合导入，保留 license 与 source checksum，可搜索可安装但不冒充精选。</p>
        <ul>
          <li>完整保留 source / commit / 作者信息</li>
          <li>导入必须经过 lint --strict 与 review</li>
          <li>覆盖营销、财务、安全、设计等数百个领域</li>
        </ul>
        <div class="tier-cmd">
          <div class="cmd" data-copy="agents-market search seo --tier community --json">
            <span class="dollar">$</span><code>search seo --tier community --json</code>
            <button class="copy" aria-label="复制">${COPY_ICON}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section" style="background:var(--bg-soft);border-block:1px solid var(--line)">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">精选内容</span>
      <h2>按场景安装，不用翻几百个 agent。</h2>
    </div>

    <div class="reveal">
      <div class="feat-tabs" role="tablist">
        <button class="feat-tab" role="tab" aria-selected="true" data-panel="packs">Packs</button>
        <button class="feat-tab" role="tab" aria-selected="false" data-panel="agents">Agents</button>
      </div>

      <div class="feat-panel active" data-panel="packs" role="tabpanel">
        <div class="card-grid">
${packCards}
        </div>
      </div>

      <div class="feat-panel" data-panel="agents" role="tabpanel">
        <div class="card-grid">
${agentCards}
        </div>
      </div>

      <div class="feat-foot">
        <a class="text-link" href="catalog.html">在线浏览完整市场 <span class="arr">→</span></a>
        <span class="alt mono" style="color:var(--faint);font-size:13px">agents-market search &lt;query&gt; --json</span>
      </div>
    </div>
  </div>
</section>

<section class="section" id="install">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">安装方式</span>
      <h2>选一种你习惯的方式开始。</h2>
      <p class="lede">从日常使用到要求 checksum / attestation 验证的环境，都有对应入口。</p>
    </div>

    <div class="install-grid reveal">
      <div class="install-menu" role="tablist" aria-label="安装方式">
        <button class="install-opt" role="tab" aria-selected="true" data-install="brew">
          <span class="io-ic">🍺</span>
          <span><span class="io-t">Homebrew</span><span class="io-d">macOS / Linux 日常使用</span></span>
        </button>
        <button class="install-opt" role="tab" aria-selected="false" data-install="npx">
          <span class="io-ic">⚡</span>
          <span><span class="io-t">npx 免安装</span><span class="io-d">一次性试用、CI</span></span>
        </button>
        <button class="install-opt" role="tab" aria-selected="false" data-install="sh">
          <span class="io-ic">🛡</span>
          <span><span class="io-t">校验安装脚本</span><span class="io-d">checksum / attestation 验证</span></span>
        </button>
        <button class="install-opt" role="tab" aria-selected="false" data-install="plugin">
          <span class="io-ic">🔌</span>
          <span><span class="io-t">Claude Code 插件</span><span class="io-d">会话内自助安装 packs</span></span>
        </button>
      </div>

      <div class="install-view">
        <div class="iv-bar">
          <span class="tl"><i></i><i></i><i></i></span>
          <span class="iv-title">zsh</span>
          <button class="iv-copy" aria-label="复制">复制</button>
        </div>
        <div class="iv-body" id="installBody"></div>
      </div>
    </div>
  </div>
</section>

<section class="section" id="trust" style="background:var(--bg-soft);border-block:1px solid var(--line)">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">供应链信任 · 隐私</span>
      <h2>可签名、可锁定、可复验。</h2>
      <p class="lede">远程市场不是"信我就好"。从签名导出到 doctor，是一条能被反复验证的信任链。</p>
    </div>

    <div class="trust-grid reveal">
      <div class="chain">
        <h3>一条可验证的信任链</h3>
        <p>Ed25519 签名覆盖 registry bundle checksum，公钥与 key id 写进 lock，后续持续验证同一条链。</p>
        <div class="chain-steps">
          <div class="chain-step">
            <span class="node">01</span>
            <span class="ct"><b>签名导出</b><code>registry export --private-key …</code><p>Ed25519 签名 bundle，覆盖内容 checksum。</p></span>
          </div>
          <div class="chain-step">
            <span class="node">02</span>
            <span class="ct"><b>锁定</b><code>registry lock</code><p>把 public key、key id 写进 registry-lock.json。</p></span>
          </div>
          <div class="chain-step">
            <span class="node">03</span>
            <span class="ct"><b>复验</b><code>registry verify-lock --json</code><p>每次安装、CI 都校验同一条信任链。</p></span>
          </div>
          <div class="chain-step">
            <span class="node">04</span>
            <span class="ct"><b>体检</b><code>doctor --strict --json</code><p>manifest、lock、policy、drift 一次闭环检查。</p></span>
          </div>
        </div>
      </div>

      <div class="privacy">
        <div class="big kbd-num">0</div>
        <h3>零遥测，零分析</h3>
        <p>Agents Market 不会主动上报任何数据。只有在你显式触发这些操作时才访问网络：</p>
        <ul>
          <li>使用远程 registry / public key</li>
          <li>连接 hosted catalog</li>
          <li>从 GitHub 导入社区 agent</li>
          <li>下载 release 或 package source</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="section cta">
  <div class="wrap cta-inner">
    <h2>让 Agent 替你挑 subagent。</h2>
    <p>装好 CLI，剩下的交给 <code style="font-family:var(--font-mono);color:var(--accent)">apply --json</code> 的预览 → 确认 → 安装流程。</p>
    <div class="cmd" data-copy="brew install tt-a1i/tap/agents-market">
      <span class="dollar">$</span><code>brew install tt-a1i/tap/agents-market</code>
      <button class="copy" aria-label="复制">${COPY_ICON}</button>
    </div>
    <div class="cta-btns">
      <a class="btn btn-primary btn-lg" href="catalog.html">打开在线市场</a>
      <a class="btn btn-ghost btn-lg" href="https://github.com/tt-a1i/agents-market" target="_blank" rel="noopener">查看 GitHub</a>
    </div>
  </div>
</section>

</main>

<footer>
  <div class="wrap">
    <div class="foot-inner">
      <div class="foot-brand">
        <a class="brand" href="#top">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span class="brand-name">Agents&nbsp;<b>Market</b></span>
        </a>
        <p>面向 Agent 的 subagent 市场与安装器。安全、可验证、可维护地把专业 coding subagents 装进你的项目。</p>
      </div>
      <div class="foot-cols">
        <div class="foot-col">
          <h5>产品</h5>
          <a href="#capabilities">核心能力</a>
          <a href="#workflow">工作流</a>
          <a href="#market">市场分层</a>
          <a href="#install">安装方式</a>
        </div>
        <div class="foot-col">
          <h5>资源</h5>
          <a href="catalog.html">在线市场</a>
          <a href="${escapeAttribute(options.bundleUrl)}">Registry Bundle</a>
          <a href="https://github.com/tt-a1i/agents-market" target="_blank" rel="noopener">GitHub</a>
          <a href="https://github.com/tt-a1i/agents-market/releases/tag/preview-0.1.0" target="_blank" rel="noopener">Preview Release</a>
        </div>
        <div class="foot-col">
          <h5>治理</h5>
          <a href="https://github.com/tt-a1i/agents-market/blob/main/PRIVACY.md" target="_blank" rel="noopener">隐私说明</a>
          <a href="https://github.com/tt-a1i/agents-market/blob/main/SECURITY.md" target="_blank" rel="noopener">安全</a>
          <a href="https://github.com/tt-a1i/agents-market/blob/main/SUPPORT.md" target="_blank" rel="noopener">支持</a>
        </div>
      </div>
    </div>
    <div class="foot-bottom">
      <span>MIT License · © ${year} Agents Market contributors</span>
      <span>no telemetry · no analytics</span>
    </div>
  </div>
</footer>

<script>
${LANDING_JS}
</script>

</body>
</html>
`;
}

function renderPackCard(copy: FeaturedPackCopy, pack: PackDefinition): string {
  const tier = resolveTier(pack);
  const tags = copy.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  return `          <article class="card">
            <div class="card-top"><span class="card-id">${escapeHtml(pack.id)}</span><span class="badge ${tier}">${tier}</span></div>
            <h3>${escapeHtml(copy.name)}</h3>
            <p class="desc">${escapeHtml(copy.desc)}</p>
            <div class="card-foot">
              <div class="tags">${tags}</div>
              <span class="count">${pack.agents.length} agents</span>
            </div>
          </article>`;
}

function renderAgentCard(copy: FeaturedAgentCopy, agent: AgentDefinition): string {
  const tier = resolveTier(agent);
  const dots = ["claude", "codex", "opencode"]
    .filter((target) => agent.recommendedTargets.includes(target as AgentDefinition["recommendedTargets"][number]))
    .map((target) => `<i style="background:var(--brand-${target})"></i>`)
    .join("");
  return `          <article class="card">
            <div class="card-top"><span class="card-id">${escapeHtml(agent.permission)}</span><span class="badge ${tier}">${tier}</span></div>
            <h3>${escapeHtml(copy.name)}</h3>
            <p class="desc">${escapeHtml(copy.desc)}</p>
            <div class="card-foot">
              <div class="targets-mini" title="Claude · Codex · OpenCode">${dots}</div>
              <span class="count">${escapeHtml(agent.category)}</span>
            </div>
          </article>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

const LANDING_CSS = String.raw`
/* Agents Market — landing. Dark-first, IBM Plex, jade accent. */
:root {
  --accent: #34d39e;
  --radius: 12px;
  --fs: 1;
  --on-accent: #06251a;
  --accent-soft: color-mix(in oklab, var(--accent) 15%, transparent);
  --accent-line: color-mix(in oklab, var(--accent) 38%, transparent);
  --brand-claude: #b08cff;
  --brand-codex:  #c9cdd4;
  --brand-opencode: #5b9dff;
  --font-sans: "IBM Plex Sans", "IBM Plex Sans SC", system-ui, -apple-system, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --maxw: 1180px;
  --r-sm: calc(var(--radius) * 0.5);
  --r-lg: calc(var(--radius) * 1.5);
  color-scheme: dark;
}
[data-theme="dark"] {
  --bg:        oklch(0.158 0.006 165);
  --bg-soft:   oklch(0.188 0.007 165);
  --surface:   oklch(0.208 0.008 165);
  --surface-2: oklch(0.248 0.009 165);
  --line:      oklch(1 0 0 / 0.085);
  --line-2:    oklch(1 0 0 / 0.16);
  --text:      oklch(0.955 0.004 150);
  --muted:     oklch(0.74 0.009 155);
  --faint:     oklch(0.58 0.009 155);
  --glow: color-mix(in oklab, var(--accent) 22%, transparent);
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: calc(16px * var(--fs));
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow-x: hidden;
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
h1, h2, h3, h4 { margin: 0; font-weight: 600; line-height: 1.1; letter-spacing: -0.02em; }
p { margin: 0; }
a { color: inherit; text-decoration: none; }
button { font-family: inherit; }
::selection { background: var(--accent-soft); color: var(--text); }
.wrap { width: 100%; max-width: var(--maxw); margin-inline: auto; padding-inline: 28px; }
.section { padding-block: clamp(72px, 10vw, 136px); position: relative; }
.eyebrow {
  font-family: var(--font-mono);
  font-size: 12px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--accent);
  display: inline-flex; align-items: center; gap: 9px;
}
.eyebrow::before { content: ""; width: 18px; height: 1px; background: var(--accent-line); }
.section-head { max-width: 720px; margin-bottom: clamp(40px, 5vw, 64px); }
.section-head h2 { font-size: clamp(28px, 4vw, 46px); margin-top: 18px; text-wrap: balance; }
.section-head .lede { margin-top: 18px; color: var(--muted); font-size: clamp(16px, 1.5vw, 19px); max-width: 60ch; text-wrap: pretty; }
.mono { font-family: var(--font-mono); }
.kbd-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.nav { position: sticky; top: 0; z-index: 100; border-bottom: 1px solid transparent; transition: background .3s ease, border-color .3s ease, backdrop-filter .3s ease; }
.nav[data-stuck="1"] {
  background: color-mix(in oklab, var(--bg) 72%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  border-bottom-color: var(--line);
}
.nav-inner { height: 66px; display: flex; align-items: center; gap: 28px; }
.brand { display: flex; align-items: center; gap: 11px; flex-shrink: 0; }
.brand-mark { width: 26px; height: 26px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; }
.brand-mark i { border-radius: 3px; background: var(--text); display: block; }
.brand-mark i:nth-child(1) { background: var(--accent); }
.brand-mark i:nth-child(4) { background: var(--accent); opacity: .5; }
.brand-name { font-weight: 600; font-size: 15.5px; letter-spacing: -0.01em; }
.brand-name b { font-weight: 600; }
.nav-links { display: flex; gap: 4px; margin-left: 8px; }
.nav-links a { padding: 8px 13px; border-radius: var(--r-sm); color: var(--muted); font-size: 14px; font-weight: 500; transition: color .15s, background .15s; }
.nav-links a:hover { color: var(--text); background: var(--surface); }
.nav-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.gh-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 13px; border: 1px solid var(--line-2); border-radius: 999px; font-size: 13px; color: var(--muted); font-weight: 500; transition: border-color .15s, color .15s; }
.gh-pill:hover { color: var(--text); border-color: var(--text); }
.gh-pill .star { color: var(--accent); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 14px; cursor: pointer; border-radius: var(--r-sm); padding: 10px 18px; border: 1px solid transparent; transition: transform .12s, background .15s, border-color .15s; white-space: nowrap; }
.btn:active { transform: translateY(1px); }
.btn-primary { background: var(--accent); color: var(--on-accent); }
.btn-primary:hover { background: color-mix(in oklab, var(--accent) 88%, white); }
.btn-ghost { background: transparent; color: var(--text); border-color: var(--line-2); }
.btn-ghost:hover { border-color: var(--text); }
.btn-lg { padding: 14px 24px; font-size: 15px; }
.nav-toggle { display: none; }
.hero { position: relative; padding-top: clamp(56px, 8vw, 96px); padding-bottom: clamp(60px, 8vw, 110px); overflow: hidden; }
.hero::before {
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(60% 50% at 18% 0%, var(--glow), transparent 70%),
    radial-gradient(50% 45% at 92% 8%, color-mix(in oklab, var(--brand-claude) 10%, transparent), transparent 72%);
  opacity: .9;
}
.hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: clamp(36px, 5vw, 72px); align-items: center; }
.hero-copy { max-width: 600px; }
.hero h1 { font-size: clamp(38px, 5.6vw, 68px); margin-top: 22px; letter-spacing: -0.035em; line-height: 1.04; text-wrap: balance; }
.hero h1 .hl { color: var(--accent); }
.hero .sub { margin-top: 24px; font-size: clamp(16px, 1.6vw, 19px); color: var(--muted); max-width: 52ch; text-wrap: pretty; }
.hero-cta { margin-top: 34px; display: flex; flex-direction: column; gap: 16px; align-items: flex-start; }
.cmd { display: inline-flex; align-items: center; gap: 14px; background: var(--surface); border: 1px solid var(--line-2); border-radius: var(--r-sm); padding: 11px 11px 11px 16px; font-family: var(--font-mono); font-size: 14px; max-width: 100%; }
.cmd .dollar { color: var(--accent); user-select: none; }
.cmd code { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmd .copy { margin-left: 4px; flex-shrink: 0; width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--line-2); border-radius: var(--r-sm); background: var(--bg-soft); color: var(--muted); cursor: pointer; transition: color .15s, border-color .15s; }
.cmd .copy:hover { color: var(--text); border-color: var(--text); }
.cmd .copy.copied { color: var(--accent); border-color: var(--accent-line); }
.cmd .copy.copy-failed { color: #f2b33d; border-color: #f2b33d; }
.cmd-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.cmd-row .alt { font-size: 13.5px; color: var(--faint); font-family: var(--font-mono); }
.cmd-row .alt b { color: var(--muted); font-weight: 500; }
.hero-links { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; }
.text-link { display: inline-flex; align-items: center; gap: 6px; font-size: 14.5px; font-weight: 500; color: var(--text); border-bottom: 1px solid var(--line-2); padding-bottom: 2px; transition: color .15s, border-color .15s; }
.text-link:hover { color: var(--accent); border-color: var(--accent-line); }
.text-link .arr { transition: transform .2s; }
.text-link:hover .arr { transform: translateX(3px); }
.targets { margin-top: 34px; display: flex; flex-direction: column; gap: 2px; }
.targets-label { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); margin-bottom: 12px; }
.target-row { display: flex; flex-wrap: wrap; gap: 10px; }
.target { display: inline-flex; align-items: center; gap: 9px; padding: 8px 14px 8px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: 13px; }
.target .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.target b { font-weight: 600; font-size: 13.5px; }
.target .path { font-family: var(--font-mono); font-size: 11.5px; color: var(--faint); }
.terminal { position: relative; z-index: 1; background: oklch(0.13 0.007 165); border: 1px solid var(--line-2); border-radius: var(--r-lg); box-shadow: 0 40px 80px -40px rgba(0,0,0,.6), 0 0 0 1px var(--line) inset; overflow: hidden; font-family: var(--font-mono); }
.term-bar { display: flex; align-items: center; gap: 8px; padding: 13px 16px; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
.term-bar .tl { display: flex; gap: 7px; }
.term-bar .tl i { width: 11px; height: 11px; border-radius: 50%; background: rgba(255,255,255,.18); }
.term-title { margin-left: 8px; font-size: 12px; color: rgba(255,255,255,.42); letter-spacing: .02em; }
.term-body { padding: 20px; font-size: 13px; line-height: 1.75; min-height: 360px; color: rgba(255,255,255,.86); }
.term-body .ln { white-space: pre-wrap; }
.term-body .prompt { color: var(--accent); }
.term-body .flag { color: var(--brand-opencode); }
.term-body .dim { color: rgba(255,255,255,.4); }
.term-body .ok { color: var(--accent); }
.term-body .warn { color: #f2b33d; }
.term-body .key { color: var(--brand-claude); }
.term-body .str { color: #9bd9b6; }
.term-body .cursor { display: inline-block; width: 8px; height: 15px; vertical-align: -2px; background: var(--accent); margin-left: 2px; animation: blink 1.1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.stats { border-block: 1px solid var(--line); background: var(--bg-soft); }
.stats-inner { display: grid; grid-template-columns: repeat(4, 1fr); padding-block: 40px; }
.stat { padding-inline: 12px; position: relative; }
.stat + .stat::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 1px; height: 46px; background: var(--line); }
.stat .n { font-family: var(--font-mono); font-size: clamp(30px, 4vw, 44px); font-weight: 500; letter-spacing: -0.02em; color: var(--text); font-variant-numeric: tabular-nums; }
.stat .n .pre { color: var(--accent); }
.stat .lbl { margin-top: 6px; color: var(--muted); font-size: 13.5px; }
.stat .lbl b { color: var(--text); font-weight: 500; }
.cap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
.cap { background: var(--bg); padding: 32px 30px 34px; transition: background .2s; }
.cap:hover { background: var(--surface); }
.cap-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
.cap-idx { font-family: var(--font-mono); font-size: 12.5px; color: var(--faint); letter-spacing: .08em; }
.cap-glyph { width: 34px; height: 34px; position: relative; color: var(--accent); }
.cap h3 { font-size: 19px; margin-bottom: 9px; letter-spacing: -0.01em; }
.cap p { color: var(--muted); font-size: 14.5px; line-height: 1.62; }
.cap p code { font-family: var(--font-mono); font-size: .92em; color: var(--text); background: var(--surface-2); padding: 1px 6px; border-radius: 5px; }
.flow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; counter-reset: step; }
.flow-step { position: relative; padding-top: 26px; border-top: 2px solid var(--line-2); }
.flow-step::before { counter-increment: step; content: counter(step, decimal-leading-zero); position: absolute; top: -1px; left: 0; font-family: var(--font-mono); font-size: 12px; color: var(--faint); transform: translateY(-130%); }
.flow-step.active { border-top-color: var(--accent); }
.flow-step.active::before { color: var(--accent); }
.flow-step h4 { font-size: 17px; margin-bottom: 8px; }
.flow-step p { color: var(--muted); font-size: 14px; margin-bottom: 14px; }
.flow-cmd { font-family: var(--font-mono); font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 9px 12px; display: block; white-space: nowrap; overflow-x: auto; scrollbar-width: none; }
.flow-cmd::-webkit-scrollbar { display: none; }
.flow-cmd .fl { color: var(--accent); }
.tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.tier { border: 1px solid var(--line-2); border-radius: var(--r-lg); padding: 34px 32px; background: var(--surface); position: relative; overflow: hidden; }
.tier.core { border-color: var(--accent-line); }
.tier.core::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(80% 60% at 100% 0%, var(--accent-soft), transparent 60%); }
.tier-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; position: relative; }
.tier-badge { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; padding: 5px 11px; border-radius: 999px; }
.tier.core .tier-badge { background: var(--accent); color: var(--on-accent); }
.tier.community .tier-badge { background: var(--surface-2); color: var(--muted); border: 1px solid var(--line-2); }
.tier h3 { font-size: 23px; position: relative; }
.tier .tier-sub { color: var(--muted); font-size: 14.5px; margin-top: 12px; position: relative; }
.tier ul { list-style: none; padding: 0; margin: 22px 0 0; display: flex; flex-direction: column; gap: 13px; position: relative; }
.tier li { display: flex; gap: 12px; font-size: 14.5px; color: var(--text); align-items: flex-start; }
.tier li::before {
  content: ""; flex-shrink: 0; width: 16px; height: 16px; margin-top: 3px;
  border-radius: 5px; background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.2 6.7 11 12 5' fill='none' stroke='%2334d39e' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: center;
}
.tier .tier-cmd { margin-top: 26px; }
.feat-tabs { display: flex; gap: 8px; margin-bottom: 30px; }
.feat-tab { appearance: none; border: 1px solid var(--line-2); background: transparent; color: var(--muted); font-weight: 500; font-size: 14px; padding: 9px 18px; border-radius: 999px; cursor: pointer; transition: color .15s, background .15s, border-color .15s; }
.feat-tab[aria-selected="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.feat-panel { display: none; }
.feat-panel.active { display: block; animation: fade .35s ease; }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } }
.card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.card { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); padding: 24px 24px 22px; display: flex; flex-direction: column; gap: 14px; transition: border-color .2s, transform .2s, background .2s; }
.card:hover { border-color: var(--line-2); transform: translateY(-3px); }
.card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-id { font-family: var(--font-mono); font-size: 12px; color: var(--faint); }
.badge { font-family: var(--font-mono); font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
.badge.core { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-line); }
.badge.community { background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); }
.card h3 { font-size: 18px; letter-spacing: -0.01em; }
.card .desc { color: var(--muted); font-size: 14px; line-height: 1.6; flex: 1; }
.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 14px; border-top: 1px solid var(--line); }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-family: var(--font-mono); font-size: 11px; color: var(--muted); background: var(--bg-soft); padding: 3px 8px; border-radius: 5px; }
.card .targets-mini { display: flex; gap: 5px; }
.card .targets-mini i { width: 7px; height: 7px; border-radius: 50%; }
.card .count { font-family: var(--font-mono); font-size: 12px; color: var(--faint); white-space: nowrap; }
.feat-foot { margin-top: 32px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.install-grid { display: grid; grid-template-columns: 320px 1fr; gap: 28px; align-items: start; }
.install-menu { display: flex; flex-direction: column; gap: 8px; }
.install-opt { appearance: none; text-align: left; cursor: pointer; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius); padding: 16px 18px; display: flex; gap: 14px; align-items: center; transition: border-color .15s, background .15s; }
.install-opt:hover { border-color: var(--line-2); }
.install-opt[aria-selected="true"] { border-color: var(--accent-line); background: var(--accent-soft); }
.install-opt .io-ic { width: 38px; height: 38px; flex-shrink: 0; border-radius: 9px; background: var(--bg-soft); border: 1px solid var(--line); display: grid; place-items: center; font-family: var(--font-mono); font-size: 15px; color: var(--accent); }
.install-opt[aria-selected="true"] .io-ic { background: var(--bg); }
.install-opt .io-t { font-weight: 600; font-size: 14.5px; }
.install-opt .io-d { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.install-view { border: 1px solid var(--line-2); border-radius: var(--r-lg); background: oklch(0.13 0.007 165); overflow: hidden; min-height: 230px; }
.install-view .iv-bar { padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 9px; font-family: var(--font-mono); font-size: 12px; color: rgba(255,255,255,.5); }
.install-view .iv-bar .tl { display: flex; gap: 6px; }
.install-view .iv-bar .tl i { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,.16); }
.install-view .iv-body { padding: 24px; font-family: var(--font-mono); font-size: 13.5px; line-height: 2; color: rgba(255,255,255,.88); }
.install-view .iv-body .row { display: flex; align-items: center; gap: 12px; }
.install-view .iv-body .pr { color: var(--accent); }
.install-view .iv-body .cm { color: rgba(255,255,255,.4); margin-left: 2px; }
.install-view .iv-copy { margin-left: auto; font-size: 11.5px; color: rgba(255,255,255,.5); border: 1px solid rgba(255,255,255,.16); border-radius: 6px; padding: 4px 10px; cursor: pointer; transition: color .15s, border-color .15s; }
.install-view .iv-copy:hover { color: #fff; border-color: rgba(255,255,255,.4); }
.install-view .iv-copy.copied { color: var(--accent); border-color: var(--accent-line); }
.install-view .iv-copy.copy-failed { color: #f2b33d; border-color: #f2b33d; }
.install-view .iv-note { margin-top: 18px; color: rgba(255,255,255,.46); font-family: var(--font-sans); font-size: 13px; line-height: 1.6; }
.install-view .iv-note a { color: var(--brand-opencode); border-bottom: 1px solid transparent; }
.install-view .iv-note a:hover { border-bottom-color: currentColor; }
.trust-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 28px; align-items: stretch; }
.chain { border: 1px solid var(--line-2); border-radius: var(--r-lg); background: var(--surface); padding: 34px 32px; }
.chain h3 { font-size: 21px; margin-bottom: 6px; }
.chain > p { color: var(--muted); font-size: 14.5px; margin-bottom: 28px; }
.chain-steps { display: flex; flex-direction: column; gap: 0; }
.chain-step { display: flex; gap: 16px; position: relative; padding-bottom: 22px; }
.chain-step:last-child { padding-bottom: 0; }
.chain-step .node { width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px; border: 1px solid var(--accent-line); background: var(--accent-soft); display: grid; place-items: center; font-family: var(--font-mono); font-size: 13px; color: var(--accent); z-index: 1; }
.chain-step:not(:last-child) .node::after { content: ""; position: absolute; left: 16.5px; top: 34px; bottom: -2px; width: 1px; background: var(--line-2); }
.chain-step .ct b { font-weight: 600; font-size: 15px; display: block; }
.chain-step .ct code { font-family: var(--font-mono); font-size: 12.5px; color: var(--accent); }
.chain-step .ct p { color: var(--muted); font-size: 13.5px; margin-top: 3px; }
.privacy { border: 1px solid var(--line-2); border-radius: var(--r-lg); background: var(--bg-soft); padding: 34px 32px; display: flex; flex-direction: column; }
.privacy .big { font-family: var(--font-mono); font-size: clamp(56px, 7vw, 84px); font-weight: 500; color: var(--accent); line-height: 1; letter-spacing: -0.04em; }
.privacy h3 { font-size: 21px; margin: 18px 0 10px; }
.privacy p { color: var(--muted); font-size: 14.5px; line-height: 1.65; }
.privacy ul { list-style: none; padding: 0; margin: 22px 0 0; display: flex; flex-direction: column; gap: 11px; }
.privacy li { font-size: 13.5px; color: var(--text); display: flex; gap: 10px; align-items: flex-start; }
.privacy li::before { content: "—"; color: var(--accent); }
.cta { text-align: center; position: relative; overflow: hidden; }
.cta::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(50% 80% at 50% 100%, var(--glow), transparent 70%); }
.cta-inner { position: relative; z-index: 1; }
.cta h2 { font-size: clamp(30px, 4.5vw, 52px); text-wrap: balance; max-width: 16ch; margin-inline: auto; }
.cta p { color: var(--muted); font-size: 17px; margin: 20px auto 36px; max-width: 50ch; }
.cta .cmd { margin-inline: auto; }
.cta-btns { margin-top: 26px; display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
footer { border-top: 1px solid var(--line); padding-block: 48px; }
.foot-inner { display: flex; justify-content: space-between; gap: 32px; flex-wrap: wrap; align-items: flex-start; }
.foot-brand { max-width: 280px; }
.foot-brand p { color: var(--faint); font-size: 13px; margin-top: 14px; line-height: 1.6; }
.foot-cols { display: flex; gap: 56px; flex-wrap: wrap; }
.foot-col h5 { font-family: var(--font-mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); margin: 0 0 14px; font-weight: 500; }
.foot-col a { display: block; color: var(--muted); font-size: 13.5px; padding: 4px 0; transition: color .15s; }
.foot-col a:hover { color: var(--accent); }
.foot-bottom { margin-top: 40px; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; color: var(--faint); font-size: 12.5px; font-family: var(--font-mono); }
@media (prefers-reduced-motion: no-preference) {
  .reveal { opacity: 0; transform: translateY(20px); transition: opacity .7s cubic-bezier(.2,.7,.3,1), transform .7s cubic-bezier(.2,.7,.3,1); }
  .reveal.in { opacity: 1; transform: none; }
}
@media (max-width: 940px) {
  .hero-grid { grid-template-columns: 1fr; }
  .terminal { order: 2; }
  .cap-grid { grid-template-columns: repeat(2, 1fr); }
  .flow { grid-template-columns: repeat(2, 1fr); gap: 32px 22px; }
  .trust-grid { grid-template-columns: 1fr; }
  .install-grid { grid-template-columns: 1fr; }
  .card-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 720px) {
  .wrap { padding-inline: 20px; }
  .nav-links { display: none; }
  .nav-toggle { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--r-sm); border: 1px solid var(--line-2); background: transparent; color: var(--text); cursor: pointer; }
  .gh-pill .gh-label { display: none; }
  .stats-inner { grid-template-columns: 1fr 1fr; gap: 28px 0; }
  .stat:nth-child(3)::before, .stat:nth-child(2)::before { content: none; }
  .stat:nth-child(odd) { padding-left: 0; }
  .tiers { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .cap-grid { grid-template-columns: 1fr; }
  .card-grid { grid-template-columns: 1fr; }
  .flow { grid-template-columns: 1fr; }
  .hero-cta { width: 100%; }
  .cmd { width: 100%; }
  .cmd code { white-space: normal; word-break: break-all; }
}
`;

const LANDING_JS = String.raw`
(function () {
  "use strict";

  /* nav stuck shadow */
  var nav = document.getElementById("nav");
  var onScroll = function () { if (nav) nav.setAttribute("data-stuck", window.scrollY > 8 ? "1" : "0"); };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  var navToggle = document.getElementById("navToggle");
  if (navToggle) {
    navToggle.addEventListener("click", function () { location.hash = "#capabilities"; });
  }

  /* clipboard with execCommand fallback for non-secure contexts */
  async function copyCommand(command) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(command);
        return true;
      } catch (error) {
        // fall through to the textarea fallback
      }
    }
    var textarea = document.createElement("textarea");
    textarea.value = command;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    var copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
    return copied;
  }

  function flashCopied(btn, copied, label) {
    btn.classList.toggle("copied", copied);
    btn.classList.toggle("copy-failed", !copied);
    var orig = label ? btn.textContent : null;
    if (label) btn.textContent = copied ? "已复制" : "Copy failed";
    if (!label) btn.title = copied ? "已复制" : "Copy failed";
    setTimeout(function () {
      btn.classList.remove("copied");
      btn.classList.remove("copy-failed");
      if (label && orig != null) btn.textContent = orig;
      if (!label) btn.title = "复制";
    }, 1400);
  }

  document.querySelectorAll("[data-copy]").forEach(function (box) {
    var btn = box.querySelector(".copy");
    if (!btn) return;
    btn.addEventListener("click", function () {
      copyCommand(box.getAttribute("data-copy")).then(function (copied) { flashCopied(btn, copied, false); });
    });
  });

  /* count-up stats */
  function countUp(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    var dur = 1400;
    var start = performance.now();
    var tick = function (now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    };
    requestAnimationFrame(tick);
  }

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  var statsSection = document.querySelector(".stats");
  if (statsSection && "IntersectionObserver" in window) {
    var statObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.querySelectorAll("[data-count]").forEach(function (n) {
            if (reduce) n.textContent = n.getAttribute("data-count");
            else countUp(n);
          });
          statObserver.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    statObserver.observe(statsSection);
  } else if (statsSection) {
    statsSection.querySelectorAll("[data-count]").forEach(function (n) { n.textContent = n.getAttribute("data-count"); });
  }

  /* featured tabs */
  var featTabs = document.querySelectorAll(".feat-tab");
  featTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var panel = tab.getAttribute("data-panel");
      featTabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      document.querySelectorAll(".feat-panel").forEach(function (p) {
        p.classList.toggle("active", p.getAttribute("data-panel") === panel);
      });
    });
  });

  /* install switcher */
  var INSTALL = {
    brew: {
      lines: [
        { pr: true, t: "brew install tt-a1i/tap/agents-market" },
        { cm: "# 从固定 commit 的 preview 源码归档构建" },
        { pr: true, t: "agents-market init --target all" }
      ],
      copy: "brew install tt-a1i/tap/agents-market",
      note: 'Formula 在 <a href="https://github.com/tt-a1i/homebrew-tap" target="_blank" rel="noopener">tt-a1i/homebrew-tap</a>，npm 发布后会切换到 registry tarball。'
    },
    npx: {
      lines: [
        { cm: "# 不写入任何全局文件，适合试用和 CI" },
        { pr: true, t: "npx github:tt-a1i/agents-market#preview-0.1.0 init --target all" },
        { pr: true, t: "npx github:tt-a1i/agents-market#preview-0.1.0 recommend" }
      ],
      copy: "npx github:tt-a1i/agents-market#preview-0.1.0 init --target all",
      note: "零安装、零残留。命令结束后机器上不留任何全局文件。"
    },
    sh: {
      lines: [
        { cm: "# 写入前校验 checksum，跳过 npm 生命周期脚本" },
        { pr: true, t: "curl -fsSL …/preview-0.1.0/install.sh | sh" },
        { cm: "# 要求 GitHub Artifact Attestation 验证" },
        { pr: true, t: "… | AGENTS_MARKET_REQUIRE_ATTESTATION=1 sh" }
      ],
      copy: "curl -fsSL https://github.com/tt-a1i/agents-market/releases/download/preview-0.1.0/install.sh | sh",
      note: "面向要求 checksum / attestation 验证的环境，安装用 <span style='font-family:var(--font-mono)'>--ignore-scripts</span> 跳过 npm 生命周期脚本。"
    },
    plugin: {
      lines: [
        { cm: "# 在 Claude Code 会话内，不碰项目文件" },
        { pr: true, t: "/plugin marketplace add tt-a1i/agents-market" },
        { pr: true, t: "/plugin install agents-market-installer@agents-market" }
      ],
      copy: "/plugin marketplace add tt-a1i/agents-market",
      note: "装好后让 Claude 推荐并安装 packs，走同样的 apply --json 预览 → 确认 → 安装流程。"
    }
  };

  var installBody = document.getElementById("installBody");
  var ivCopy = document.querySelector(".iv-copy");
  var currentInstall = "brew";

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderInstall(key) {
    currentInstall = key;
    var data = INSTALL[key];
    if (!installBody || !data) return;
    var html = "";
    data.lines.forEach(function (l) {
      if (l.cm) {
        html += '<div class="row"><span class="cm">' + escapeHtml(l.cm) + "</span></div>";
      } else {
        html += '<div class="row"><span class="pr">$</span><span>' + escapeHtml(l.t) + "</span></div>";
      }
    });
    html += '<div class="iv-note">' + data.note + "</div>";
    installBody.innerHTML = html;
  }

  document.querySelectorAll(".install-opt").forEach(function (opt) {
    opt.addEventListener("click", function () {
      document.querySelectorAll(".install-opt").forEach(function (o) { o.setAttribute("aria-selected", String(o === opt)); });
      renderInstall(opt.getAttribute("data-install"));
    });
  });
  if (ivCopy) {
    ivCopy.addEventListener("click", function () {
      copyCommand(INSTALL[currentInstall].copy).then(function (copied) { flashCopied(ivCopy, copied, true); });
    });
  }
  renderInstall("brew");

  /* terminal typing demo */
  var term = document.getElementById("term");
  if (term && !reduce) {
    var SEQ = [
      { type: "type", pre: "$ ", text: "agents-market apply --target all --json", flags: true, after: 400 },
      { type: "print", html: '<span class="dim">› 检测项目信号…  package.json · tsconfig.json · next.config.js</span>', after: 360 },
      { type: "print", html: '<span class="dim">› 推荐 pack:</span> <span class="ok">nextjs-pack</span> <span class="dim">(core)</span>', after: 320 },
      { type: "print", html: "&nbsp;", after: 120 },
      { type: "print", html: '<span class="key">"audit"</span>: { <span class="key">"risk"</span>: <span class="str">"low"</span>, <span class="key">"writes"</span>: <span class="ok">0</span> },', after: 220 },
      { type: "print", html: '<span class="key">"policy"</span>: { <span class="key">"preset"</span>: <span class="str">"balanced"</span>, <span class="key">"ok"</span>: <span class="ok">true</span> },', after: 220 },
      { type: "print", html: '<span class="key">"diff"</span>: <span class="ok">5</span> <span class="dim">files to create · </span><span class="warn">0</span> <span class="dim">modified</span>', after: 320 },
      { type: "print", html: "&nbsp;", after: 120 },
      { type: "print", html: '<span class="dim">nextCommands:</span>', after: 200 },
      { type: "print", html: '  <span class="ok">apply nextjs-pack --target all --yes</span>', after: 200 },
      { type: "print", html: '  <span class="ok">doctor --strict --json</span>', after: 500 },
      { type: "type", pre: "$ ", text: "agents-market apply nextjs-pack --yes", flags: false, after: 400 },
      { type: "print", html: '<span class="ok">✓</span> <span class="dim">wrote</span> .claude/agents/<span class="ok">5 files</span> <span class="dim">·</span> .codex <span class="dim">·</span> .opencode', after: 300 },
      { type: "print", html: '<span class="ok">✓</span> <span class="dim">manifest updated · doctor clean</span>', after: 0 }
    ];

    var idx = 0;
    var cursor = document.createElement("span");
    cursor.className = "cursor";

    var addLine = function () {
      var el = document.createElement("div");
      el.className = "ln";
      term.appendChild(el);
      return el;
    };
    var highlightFlags = function (text) {
      return escapeHtml(text).replace(/(--[a-z-]+)/g, '<span class="flag">$1</span>');
    };
    var ensureCursor = function (el) { el.appendChild(cursor); };

    var runStep = function () {
      if (idx >= SEQ.length) { cursor.remove(); return; }
      var step = SEQ[idx++];
      if (step.type === "type") {
        var el = addLine();
        var pre = step.pre ? '<span class="prompt">' + step.pre + "</span>" : "";
        var i = 0;
        var full = step.text;
        ensureCursor(el);
        var typeChar = function () {
          var shown = full.slice(0, i);
          var body = step.flags ? highlightFlags(shown) : escapeHtml(shown);
          el.innerHTML = pre + body;
          ensureCursor(el);
          i++;
          if (i <= full.length) {
            setTimeout(typeChar, 26 + Math.random() * 26);
          } else {
            setTimeout(runStep, step.after || 200);
          }
        };
        typeChar();
      } else {
        var lineEl = addLine();
        lineEl.innerHTML = step.html;
        ensureCursor(lineEl);
        setTimeout(runStep, step.after || 200);
      }
    };
    setTimeout(runStep, 600);
  } else if (term) {
    term.innerHTML =
      '<div class="ln"><span class="prompt">$ </span>agents-market apply <span class="flag">--target</span> all <span class="flag">--json</span></div>' +
      '<div class="ln"><span class="dim">› 推荐 pack:</span> <span class="ok">nextjs-pack</span> <span class="dim">(core)</span></div>' +
      '<div class="ln"><span class="key">"diff"</span>: <span class="ok">5</span> <span class="dim">files to create</span></div>' +
      '<div class="ln"><span class="ok">✓</span> <span class="dim">manifest updated · doctor clean</span></div>';
  }
})();
`;
