import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRegistryBundle } from "./registry.js";
import type { Registry } from "./types.js";

export interface CatalogOptions {
  outDir: string;
  version: string;
  title?: string;
}

export async function buildCatalog(registry: Registry, options: CatalogOptions): Promise<string[]> {
  const title = options.title ?? "Agents Market";
  await mkdir(options.outDir, { recursive: true });

  const bundle = createRegistryBundle(registry, options.version, "agents-market");
  const catalog = {
    title,
    generatedAt: new Date().toISOString(),
    packCount: registry.packs.length,
    agentCount: registry.agents.length,
    packs: registry.packs.map((pack) => ({
      ...pack,
      agents: pack.agents.map((id) => registry.agents.find((agent) => agent.id === id)).filter(Boolean)
    })),
    agents: registry.agents
  };

  const files = [
    {
      name: "registry.bundle.json",
      content: `${JSON.stringify(bundle, null, 2)}\n`
    },
    {
      name: "catalog.json",
      content: `${JSON.stringify(catalog, null, 2)}\n`
    },
    {
      name: "index.html",
      content: renderHtml(title, registry, "registry.bundle.json")
    }
  ];

  for (const file of files) {
    await writeFile(join(options.outDir, file.name), file.content, "utf8");
  }

  return files.map((file) => join(options.outDir, file.name));
}

function renderHtml(title: string, registry: Registry, bundlePath: string): string {
  const packs = registry.packs
    .map((pack) => {
      const agents = pack.agents
        .map((id) => registry.agents.find((agent) => agent.id === id))
        .filter((agent) => agent !== undefined)
        .map((agent) => `<li><code>${escapeHtml(agent.id)}</code> ${escapeHtml(agent.description)}</li>`)
        .join("");
      return `<article class="card" data-search="${escapeHtml(`${pack.id} ${pack.name} ${pack.description} ${pack.tags.join(" ")}`)}">
        <div class="eyebrow">${escapeHtml(pack.tags.join(" / ") || "pack")}</div>
        <h2>${escapeHtml(pack.name)}</h2>
        <p>${escapeHtml(pack.description)}</p>
        <pre>agents-market install ${escapeHtml(pack.id)} --target all --registry ${escapeHtml(bundlePath)}</pre>
        <ul>${agents}</ul>
      </article>`;
    })
    .join("\n");

  const agents = registry.agents
    .map(
      (agent) => `<tr data-search="${escapeHtml(`${agent.id} ${agent.name} ${agent.description} ${agent.tags.join(" ")}`)}">
        <td><code>${escapeHtml(agent.id)}</code></td>
        <td>${escapeHtml(agent.category)}</td>
        <td>${escapeHtml(agent.permission)}</td>
        <td>${escapeHtml(agent.description)}</td>
      </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #172026; --muted: #5f6b76; --line: #d7dde3; --fill: #f6f8fa; --accent: #0f766e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fff; }
    header { padding: 48px 24px 28px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, #f8fbfb 0%, #fff 100%); }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 24px 64px; }
    .hero { max-width: 1120px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-size: 40px; line-height: 1.05; letter-spacing: 0; }
    h2 { margin: 8px 0 10px; font-size: 22px; }
    p { color: var(--muted); line-height: 1.6; }
    .toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 24px 0; }
    input { min-width: min(100%, 360px); height: 40px; border: 1px solid var(--line); border-radius: 6px; padding: 0 12px; font: inherit; }
    a.button { display: inline-flex; align-items: center; height: 40px; border-radius: 6px; background: var(--ink); color: white; text-decoration: none; padding: 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid var(--line); border-radius: 8px; padding: 18px; background: #fff; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    pre { overflow-x: auto; padding: 12px; border-radius: 6px; background: var(--fill); border: 1px solid var(--line); font-size: 13px; }
    ul { padding-left: 20px; }
    li { margin: 8px 0; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 12px 8px; }
    th { color: var(--muted); font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .section { margin-top: 36px; }
    @media (max-width: 640px) { h1 { font-size: 32px; } header { padding-top: 32px; } }
  </style>
</head>
<body>
  <header>
    <div class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p>Curated, cross-tool subagent packs for Claude Code, Codex, and OpenCode. Preview, lock, install, update, and uninstall with one CLI.</p>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search packs and agents" aria-label="Search packs and agents">
        <a class="button" href="${escapeHtml(bundlePath)}">Download registry bundle</a>
      </div>
    </div>
  </header>
  <main>
    <section>
      <h2>Packs</h2>
      <div class="grid">${packs}</div>
    </section>
    <section class="section">
      <h2>Agents</h2>
      <table>
        <thead><tr><th>ID</th><th>Category</th><th>Permission</th><th>Description</th></tr></thead>
        <tbody>${agents}</tbody>
      </table>
    </section>
  </main>
  <script>
    const input = document.querySelector("#search");
    const searchable = [...document.querySelectorAll("[data-search]")];
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      for (const item of searchable) {
        item.style.display = !query || item.dataset.search.toLowerCase().includes(query) ? "" : "none";
      }
    });
  </script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
