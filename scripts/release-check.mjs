import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const checks = [];

async function main() {
  run("npm", ["run", "lint"], "TypeScript typecheck");
  run("npm", ["run", "build"], "Build CLI");
  const registryLint = runJson("node", ["dist/index.js", "registry", "lint", "--strict", "--json"], "Registry quality lint");
  assert(registryLint.ok === true, "Registry quality lint failed.");
  assert(registryLint.score === 100, `Expected registry lint score 100, found ${registryLint.score}.`);
  assert(registryLint.promptQuality?.averageScore >= 90, `Expected prompt quality average >= 90, found ${registryLint.promptQuality?.averageScore}.`);
  assert(registryLint.promptQuality?.minScore >= 80, `Expected prompt quality minimum >= 80, found ${registryLint.promptQuality?.minScore}.`);
  const registryInfo = runJson("node", ["dist/index.js", "registry", "info", "--json"], "Registry info");
  assert(registryInfo.packCount >= 4, `Expected registry info to report at least four packs, found ${registryInfo.packCount}.`);
  assert(registryInfo.agentCount >= 10, `Expected registry info to report at least ten agents, found ${registryInfo.agentCount}.`);
  assert(registryInfo.changelog?.count >= 1, "Expected registry info to report at least one changelog entry.");
  assert(
    registryInfo.packs?.every((pack) => pack.requires?.agentsMarket),
    "Expected every registry info pack to include an Agents Market version requirement."
  );
  const list = runJson("node", ["dist/index.js", "list", "--agents", "--json"], "List registry JSON");
  assert(list.packCount === registryInfo.packCount, "Expected list --json pack count to match registry info.");
  assert(list.agentCount === registryInfo.agentCount, "Expected list --json agent count to match registry info.");
  assert(list.agents?.length === registryInfo.agentCount, "Expected list --agents --json to include agent records.");
  const installPlan = runJson(
    "node",
    ["dist/index.js", "plan", "security-pack", "--target", "claude", "--policy-preset", "balanced", "--json"],
    "Install plan JSON"
  );
  assert(installPlan.ready === true, "Expected security-pack install plan to be ready under balanced policy.");
  assert(installPlan.pack?.id === "security-pack", `Expected install plan pack security-pack, found ${installPlan.pack?.id}.`);
  assert(installPlan.audit?.risk === "medium", `Expected security-pack audit risk medium, found ${installPlan.audit?.risk}.`);
  assert(installPlan.plan?.fileCount === 4, `Expected security-pack Claude plan to include four files, found ${installPlan.plan?.fileCount}.`);
  assert(installPlan.changeSummary?.create === 4, `Expected security-pack plan to create four files, found ${installPlan.changeSummary?.create}.`);
  assert(installPlan.policy?.ok === true, "Expected security-pack plan policy check to pass.");
  assert(installPlan.nextCommands?.[0]?.includes("agents-market apply security-pack"), "Expected install plan to include apply preview command.");
  const blockedPlan = runJsonAllowFailure(
    "node",
    ["dist/index.js", "plan", "starter-dev-pack", "--target", "claude", "--policy-preset", "strict", "--json"],
    "Blocked install plan JSON"
  );
  assert(blockedPlan.status === 1, `Expected blocked install plan to exit 1, found ${blockedPlan.status}.`);
  assert(blockedPlan.json.ready === false, "Expected blocked install plan to be marked not ready.");
  assert(blockedPlan.json.policy?.ok === false, "Expected blocked install plan to include failing policy report.");
  const registryChangelog = runJson("node", ["dist/index.js", "registry", "changelog", "--json"], "Registry changelog");
  assert(registryChangelog.count >= 1, "Expected registry changelog to include at least one entry.");
  assert(registryChangelog.entries?.[0]?.version, "Expected registry changelog latest entry to include a version.");
  const registryReview = runJson(
    "node",
    ["dist/index.js", "registry", "review", "--registry", "./registry", "--json"],
    "Registry review"
  );
  assert(registryReview.ok === true, "Expected registry review to pass.");
  assert(registryReview.packs?.length === registryInfo.packCount, "Expected registry review to include every pack.");
  assert(registryReview.catalog?.ok === true, "Expected registry review catalog verification to pass.");
  await runRegistrySignatureSmoke();
  await runRegistrySubmissionGateSmoke();
  await runCiWorkflowSmoke();
  await runRepositoryAutomationSmoke();
  await runIntegrationPackageSmoke();
  await runReleaseArtifactsSmoke();
  await runReleaseWorkflowSmoke();
  run("npm", ["test"], "Unit tests");

  const siteDir = await mkdtemp(join(tmpdir(), "agents-market-release-site-"));
  try {
    run(
      "node",
      ["dist/index.js", "catalog", "build", "--out", siteDir, "--base-url", "https://example.com/agents-market"],
      "Catalog build"
    );
    const catalogVerify = runJson("node", ["dist/index.js", "catalog", "verify", "--dir", siteDir, "--json"], "Catalog verify");
    assert(catalogVerify.ok === true, "Catalog verification failed after build.");
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }

  await runLifecycleSmoke();

  const pack = run("npm", ["pack", "--dry-run", "--json"], "Package dry run");
  verifyTarball(parseNpmPackJson(pack.stdout));

  console.log(`\nRelease check passed (${checks.length} checks).`);
}

function run(command, args, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  checks.push(label);
  return result;
}

async function runLifecycleSmoke() {
  const projectDir = await mkdtemp(join(tmpdir(), "agents-market-release-lifecycle-"));
  try {
    const init = runJson(
      "node",
      ["dist/index.js", "init", "--cwd", projectDir, "--target", "claude", "--json"],
      "Lifecycle init"
    );
    assert(init.lockWritten === true, "Lifecycle init did not write a registry lock.");
    assert(init.recommendation?.packId, "Lifecycle init did not include a pack recommendation.");
    assert(
      init.nextCommands?.[0] === "agents-market apply starter-dev-pack --target claude --policy-preset balanced --json",
      `Lifecycle init should preview with apply, found: ${init.nextCommands?.[0]}.`
    );
    assert(
      init.nextCommands?.[1] === "agents-market apply starter-dev-pack --target claude --policy-preset balanced --yes",
      `Lifecycle init should install with apply --yes, found: ${init.nextCommands?.[1]}.`
    );
    assert(
      init.nextCommands?.[2] === "agents-market doctor --strict --json",
      `Lifecycle init should verify with strict doctor, found: ${init.nextCommands?.[2]}.`
    );
    assert(
      init.integrations?.some((file) => file.path === ".claude/skills/agents-market-installer/SKILL.md"),
      "Lifecycle init did not plan the Claude installer skill."
    );

    const lock = runJson("node", ["dist/index.js", "registry", "verify-lock", "--cwd", projectDir, "--json"], "Lifecycle verify lock");
    assert(lock.ok === true, "Lifecycle registry lock verification failed.");

    const policyInit = runJson(
      "node",
      ["dist/index.js", "policy", "init", "--cwd", projectDir, "--preset", "balanced", "--json"],
      "Lifecycle policy init"
    );
    assert(policyInit.written === true, "Lifecycle policy init did not write a policy file.");
    assert(policyInit.policy?.maxPermission === "command", "Lifecycle policy init did not use the balanced preset.");

    const policyCheck = runJson(
      "node",
      ["dist/index.js", "policy", "check", "starter-dev-pack", "--cwd", projectDir, "--target", "claude", "--json"],
      "Lifecycle policy check"
    );
    assert(policyCheck.ok === true, "Lifecycle policy check failed for starter-dev-pack under balanced policy.");

    const applyPreview = runJson(
      "node",
      ["dist/index.js", "apply", "--target", "claude", "--cwd", projectDir, "--json"],
      "Lifecycle apply preview"
    );
    assert(applyPreview.installed === false, "Lifecycle apply preview should not install without --yes.");
    assert(applyPreview.pack?.id === "starter-dev-pack", `Expected apply preview to recommend starter-dev-pack, found ${applyPreview.pack?.id}.`);
    assert(applyPreview.compatibility?.ok === true, "Lifecycle apply preview did not include a passing compatibility report.");
    assert(applyPreview.policy?.ok === true, "Lifecycle apply preview did not include a passing policy report.");
    assert(applyPreview.changes?.length === 4, `Expected apply preview to include four changes, found ${applyPreview.changes?.length}.`);
    assert(applyPreview.changeSummary?.create === 4, `Expected apply preview change summary to create four files, found ${applyPreview.changeSummary?.create}.`);
    assert(applyPreview.changeSummary?.total === 4, `Expected apply preview change summary total four files, found ${applyPreview.changeSummary?.total}.`);

    const blockedApply = runJsonAllowFailure(
      "node",
      ["dist/index.js", "apply", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--policy-preset", "strict", "--yes", "--json"],
      "Lifecycle blocked apply"
    );
    assert(blockedApply.status === 1, `Expected strict apply to exit 1, found ${blockedApply.status}.`);
    assert(blockedApply.json.installed === false, "Expected strict apply to avoid installing files.");
    assert(blockedApply.json.policy?.ok === false, "Expected strict apply to include a failing policy report.");

    const applyInstall = runJson(
      "node",
      ["dist/index.js", "apply", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--enforce-policy", "--yes", "--json"],
      "Lifecycle apply install"
    );
    assert(applyInstall.installed === true, "Expected apply --yes to install files after policy passed.");
    assert(applyInstall.compatibility?.ok === true, "Expected apply install to include a passing compatibility report.");
    assert(applyInstall.policy?.ok === true, "Expected apply install to include a passing policy report.");
    assert(applyInstall.changeSummary?.create === 4, `Expected apply install change summary to create four files, found ${applyInstall.changeSummary?.create}.`);
    assert(applyInstall.changeSummary?.total === 4, `Expected apply install change summary total four files, found ${applyInstall.changeSummary?.total}.`);

    const policyInstallPreview = runJson(
      "node",
      ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--dry-run", "--enforce-policy", "--json"],
      "Lifecycle policy install dry run"
    );
    assert(policyInstallPreview.compatibility?.ok === true, "Lifecycle policy install dry run did not include a passing compatibility report.");
    assert(policyInstallPreview.policy?.ok === true, "Lifecycle policy install dry run did not include a passing policy report.");

    const blockedInstallPreview = runJsonAllowFailure(
      "node",
      ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--dry-run", "--policy-preset", "strict", "--json"],
      "Lifecycle blocked policy install dry run"
    );
    assert(blockedInstallPreview.status === 1, `Expected strict policy install dry run to exit 1, found ${blockedInstallPreview.status}.`);
    assert(blockedInstallPreview.json.policy?.ok === false, "Expected strict policy install dry run to include a failing policy report.");

    run("node", ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--enforce-policy"], "Lifecycle install");

    const cleanStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle clean status");
    assert(cleanStatus.installCount === 1, `Expected one install after lifecycle install, found ${cleanStatus.installCount}.`);
    assert(cleanStatus.installs?.[0]?.packVersion === "0.1.0", "Expected lifecycle status to include installed pack version.");
    const cleanFiles = cleanStatus.installs?.[0]?.files ?? [];
    assert(cleanFiles.length === 4, `Expected four Claude agent files after lifecycle install, found ${cleanFiles.length}.`);
    assert(cleanFiles.every((file) => file.state === "clean"), "Expected all lifecycle-installed files to be clean.");

    const outdated = runJson("node", ["dist/index.js", "outdated", "--cwd", projectDir, "--json"], "Lifecycle outdated check");
    assert(outdated.outdatedCount === 0, `Expected no outdated packs, found ${outdated.outdatedCount}.`);
    assert(outdated.checks?.[0]?.status === "current", `Expected installed pack to be current, found ${outdated.checks?.[0]?.status}.`);

    const doctor = runJson("node", ["dist/index.js", "doctor", "--cwd", projectDir, "--strict", "--json"], "Lifecycle strict doctor");
    assert(doctor.health === "ok", `Expected strict doctor health to be ok, found ${doctor.health}.`);
    assert(
      doctor.checks?.some((check) => check.id === "policy-installed-packs" && check.severity === "pass"),
      "Expected strict doctor to verify installed packs against project policy."
    );

    await appendFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "\n<!-- local edit from release smoke -->\n", "utf8");

    const driftStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--diff", "--json"], "Lifecycle drift status");
    const driftFile = driftStatus.installs?.[0]?.files?.find((file) => file.path === ".claude/agents/code-reviewer.md");
    assert(driftFile?.state === "modified", `Expected code-reviewer drift state to be modified, found ${driftFile?.state}.`);
    assert(driftFile?.drift?.addedLines > 0, "Expected drift status to report added lines for the local edit.");

    const keepLocalResolve = runJson(
      "node",
      [
        "dist/index.js",
        "resolve",
        "starter-dev-pack",
        "--target",
        "claude",
        "--cwd",
        projectDir,
        "--strategy",
        "keep-local",
        "--yes",
        "--json"
      ],
      "Lifecycle resolve keep local"
    );
    assert(keepLocalResolve.recorded === 1, `Expected keep-local resolve to record one file, found ${keepLocalResolve.recorded}.`);
    assert(hasAction(keepLocalResolve.installs, "record-local"), "Expected keep-local resolve to report record-local.");

    const afterKeepLocalStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle status after keep local");
    const keptFile = afterKeepLocalStatus.installs?.[0]?.files?.find((file) => file.path === ".claude/agents/code-reviewer.md");
    assert(keptFile?.state === "clean", `Expected keep-local status to be clean, found ${keptFile?.state}.`);

    await appendFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "\n<!-- second local edit from release smoke -->\n", "utf8");

    const acceptRegistryResolve = runJson(
      "node",
      [
        "dist/index.js",
        "resolve",
        "starter-dev-pack",
        "--target",
        "claude",
        "--cwd",
        projectDir,
        "--strategy",
        "accept-registry",
        "--yes",
        "--json"
      ],
      "Lifecycle resolve accept registry"
    );
    assert(acceptRegistryResolve.written === 1, `Expected accept-registry resolve to write one file, found ${acceptRegistryResolve.written}.`);
    assert(hasAction(acceptRegistryResolve.installs, "write-registry"), "Expected accept-registry resolve to report write-registry.");

    const afterAcceptStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle status after accept registry");
    const acceptedFile = afterAcceptStatus.installs?.[0]?.files?.find((file) => file.path === ".claude/agents/code-reviewer.md");
    assert(acceptedFile?.state === "clean", `Expected accept-registry status to be clean, found ${acceptedFile?.state}.`);

    await appendFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "\n<!-- third local edit from release smoke -->\n", "utf8");

    const updateDryRun = runJson(
      "node",
      ["dist/index.js", "update", "starter-dev-pack", "--cwd", projectDir, "--dry-run", "--json"],
      "Lifecycle update dry run"
    );
    assert(updateDryRun.skipped === 1, `Expected update dry run to skip one modified file, found ${updateDryRun.skipped}.`);
    assert(hasAction(updateDryRun.updates, "skip-modified"), "Expected update dry run to report a skip-modified action.");

    const uninstallDryRun = runJson(
      "node",
      ["dist/index.js", "uninstall", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--dry-run", "--json"],
      "Lifecycle uninstall dry run"
    );
    assert(uninstallDryRun.removed === 3, `Expected uninstall dry run to remove three clean files, found ${uninstallDryRun.removed}.`);
    assert(uninstallDryRun.skipped === 1, `Expected uninstall dry run to skip one modified file, found ${uninstallDryRun.skipped}.`);
    assert(hasAction(uninstallDryRun.uninstalls, "skip-modified"), "Expected uninstall dry run to report a skip-modified action.");

    const uninstall = runJson(
      "node",
      ["dist/index.js", "uninstall", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--json"],
      "Lifecycle uninstall"
    );
    assert(uninstall.removed === 3, `Expected uninstall to remove three clean files, found ${uninstall.removed}.`);
    assert(uninstall.skipped === 1, `Expected uninstall to preserve one modified file, found ${uninstall.skipped}.`);

    const partialStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle partial status");
    assert(partialStatus.installCount === 1, "Expected skipped modified file to remain tracked after uninstall.");
    const remainingFiles = partialStatus.installs?.[0]?.files ?? [];
    assert(remainingFiles.length === 1, `Expected one remaining tracked file, found ${remainingFiles.length}.`);
    assert(remainingFiles[0]?.state === "modified", `Expected remaining file to be modified, found ${remainingFiles[0]?.state}.`);

    const forceUninstall = runJson(
      "node",
      ["dist/index.js", "uninstall", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--force", "--json"],
      "Lifecycle force uninstall"
    );
    assert(forceUninstall.removed === 1, `Expected force uninstall to remove the remaining file, found ${forceUninstall.removed}.`);
    assert(forceUninstall.skipped === 0, `Expected force uninstall to skip zero files, found ${forceUninstall.skipped}.`);

    const finalStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle final status");
    assert(finalStatus.installCount === 0, `Expected no installs after force uninstall, found ${finalStatus.installCount}.`);

    const registryBundlePath = join(projectDir, "hosted-registry.bundle.json");
    const manifestRegistryProject = await mkdtemp(join(projectDir, "manifest-registry-"));
    run("node", ["dist/index.js", "registry", "export", "--out", registryBundlePath], "Lifecycle export registry bundle");
    const manifestRegistryInstall = runJson(
      "node",
      ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", manifestRegistryProject, "--registry", registryBundlePath, "--json"],
      "Lifecycle manifest registry install"
    );
    assert(manifestRegistryInstall.installed === true, "Expected manifest registry install to complete.");

    const manifestRegistryUpdate = runJson(
      "node",
      ["dist/index.js", "update", "starter-dev-pack", "--cwd", manifestRegistryProject, "--dry-run", "--json"],
      "Lifecycle manifest registry update"
    );
    assert(
      manifestRegistryUpdate.updates?.[0]?.registry?.value === registryBundlePath,
      `Expected update to use install manifest registry ${registryBundlePath}, found ${manifestRegistryUpdate.updates?.[0]?.registry?.value}.`
    );

    checks.push("Lifecycle smoke assertions");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

async function runRegistrySubmissionGateSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-registry-gate-"));
  try {
    const summaryPath = join(dir, "registry-submission-summary.json");
    const summaryMarkdownPath = join(dir, "registry-submission-summary.md");
    run(
      "node",
      ["scripts/registry-submission-check.mjs", "--summary-json", summaryPath, "--summary-markdown", summaryMarkdownPath],
      "Registry submission gate"
    );
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    const markdown = await readFile(summaryMarkdownPath, "utf8");
    assert(summary.ok === true, "Expected registry submission summary to be ok.");
    assert(summary.lint?.score === 100, `Expected registry submission summary lint score 100, found ${summary.lint?.score}.`);
    assert(summary.packs?.length >= 4, `Expected registry submission summary to include at least four packs, found ${summary.packs?.length}.`);
    assert(
      summary.packs?.every((pack) => typeof pack.provenance?.withChecksum === "number"),
      "Expected registry submission summary packs to include checksum provenance coverage."
    );
    assert(summary.catalog?.ok === true, "Expected registry submission summary catalog verification to pass.");
    assert(markdown.includes("<!-- agents-market-registry-review -->"), "Expected registry submission Markdown to include a sticky comment marker.");
    assert(markdown.includes("| Pack | Version | Risk |"), "Expected registry submission Markdown to include the pack review table.");
    assert(markdown.includes("security-pack"), "Expected registry submission Markdown to include security-pack.");
    checks.push("Registry submission summary");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runIntegrationPackageSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-integrations-"));
  try {
    run("node", ["dist/index.js", "integrations", "package", "--target", "all", "--out", dir], "Integration package build");
    const required = [
      "agents-market-claude/.claude/skills/agents-market-installer/SKILL.md",
      "agents-market-codex/.codex-plugin/plugin.json",
      "agents-market-codex/skills/agents-market-installer/SKILL.md",
      "agents-market-opencode/.opencode/commands/agents-market.md"
    ];
    for (const file of required) {
      const content = await readFile(join(dir, file), "utf8");
      assert(content.length > 0, `Expected integration package file to be non-empty: ${file}`);
    }
    const manifest = JSON.parse(await readFile(join(dir, "agents-market-codex/.codex-plugin/plugin.json"), "utf8"));
    assert(manifest.name === "agents-market-installer", `Expected Codex plugin name agents-market-installer, found ${manifest.name}.`);
    assert(manifest.skills === "./skills/", `Expected Codex plugin skills path ./skills/, found ${manifest.skills}.`);
    checks.push("Integration package contents");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCiWorkflowSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-ci-"));
  try {
    const preview = runJson("node", ["dist/index.js", "ci", "diff", "--cwd", dir, "--json"], "CI workflow diff");
    assert(preview.changes?.[0]?.path === ".github/workflows/agents-market.yml", "Expected CI diff to preview the GitHub workflow path.");
    assert(preview.changes?.[0]?.state === "create", `Expected CI diff to create workflow, found ${preview.changes?.[0]?.state}.`);

    const init = runJson("node", ["dist/index.js", "ci", "init", "--cwd", dir, "--yes", "--json"], "CI workflow init");
    assert(init.written === 1, `Expected CI init to write one workflow, found ${init.written}.`);
    assert(init.strict === true, "Expected CI init to default to strict doctor checks.");
    assert(init.nextCommands?.includes("agents-market doctor --strict --json"), "Expected CI init to include strict doctor next command.");

    const workflow = await readFile(join(dir, ".github/workflows/agents-market.yml"), "utf8");
    assert(workflow.includes("npx --yes github:tt-a1i/agents-market status --diff --json"), "Expected CI workflow to check generated agent drift.");
    assert(workflow.includes("npx --yes github:tt-a1i/agents-market outdated --json"), "Expected CI workflow to check installed pack versions.");
    assert(workflow.includes("npx --yes github:tt-a1i/agents-market doctor --strict --json"), "Expected CI workflow to run strict doctor.");
    checks.push("CI workflow contents");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runRepositoryAutomationSmoke() {
  const dependabot = await readFile(".github/dependabot.yml", "utf8");
  assert(dependabot.includes("package-ecosystem: npm"), "Dependabot should monitor npm dependencies.");
  assert(dependabot.includes("package-ecosystem: github-actions"), "Dependabot should monitor GitHub Actions.");
  assert(dependabot.includes("interval: weekly"), "Dependabot should run on a weekly schedule.");
  assert(dependabot.includes("npm-minor-patch"), "Dependabot should group npm minor and patch updates.");
  assert(dependabot.includes("github-actions-minor-patch"), "Dependabot should group GitHub Actions minor and patch updates.");
  checks.push("Repository automation config");
}

async function runReleaseArtifactsSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-artifacts-"));
  try {
    const packageVersion = JSON.parse(await readFile("package.json", "utf8")).version;
    run(
      "node",
      ["scripts/build-release-artifacts.mjs", "--out", dir, "--catalog-base-url", "https://example.com/agents-market"],
      "Release artifact build"
    );
    const manifest = JSON.parse(await readFile(join(dir, "release-artifacts.json"), "utf8"));
    assert(manifest.packageSpec === "github:tt-a1i/agents-market", `Expected release artifact packageSpec github:tt-a1i/agents-market, found ${manifest.packageSpec}.`);
    assert(manifest.repositoryUrl === "https://github.com/tt-a1i/agents-market", `Expected release artifact repository URL, found ${manifest.repositoryUrl}.`);
    assert(manifest.releaseUrl?.endsWith(`/releases/tag/${manifest.releaseTag}`), `Expected release artifact release URL to match release tag, found ${manifest.releaseUrl}.`);
    const artifactPaths = new Set(manifest.artifacts?.map((artifact) => artifact.path));
    for (const required of [
      "registry.bundle.json",
      "catalog/index.html",
      "catalog/catalog.json",
      "catalog/registry.bundle.json",
      `agents-market-catalog-${packageVersion}.tgz`,
      "install.sh",
      `agents-market-claude-${packageVersion}.tgz`,
      `agents-market-codex-${packageVersion}.tgz`,
      `agents-market-opencode-${packageVersion}.tgz`,
      `npm/agents-market-cli-${packageVersion}.tgz`
    ]) {
      assert(artifactPaths.has(required), `Release artifacts are missing ${required}.`);
    }
    const checksums = await readFile(join(dir, "SHA256SUMS"), "utf8");
    assert(checksums.includes("registry.bundle.json"), "Release artifact checksums do not include registry.bundle.json.");
    const catalog = JSON.parse(await readFile(join(dir, "catalog", "catalog.json"), "utf8"));
    const bundle = JSON.parse(await readFile(join(dir, "registry.bundle.json"), "utf8"));
    const starterPack = catalog.packs?.find((pack) => pack.id === "starter-dev-pack");
    assert(catalog.packageSpec === "github:tt-a1i/agents-market", `Expected release catalog packageSpec github:tt-a1i/agents-market, found ${catalog.packageSpec}.`);
    assert(catalog.metadata?.repository === "https://github.com/tt-a1i/agents-market", `Expected release catalog repository metadata, found ${catalog.metadata?.repository}.`);
    assert(bundle.metadata?.repository === "https://github.com/tt-a1i/agents-market", `Expected release bundle repository metadata, found ${bundle.metadata?.repository}.`);
    assert(bundle.metadata?.packageSpec === "github:tt-a1i/agents-market", `Expected release bundle packageSpec metadata, found ${bundle.metadata?.packageSpec}.`);
    assert(
      starterPack?.previewCommand?.startsWith("npx github:tt-a1i/agents-market apply starter-dev-pack"),
      `Expected release catalog preview command to use GitHub npx package spec, found ${starterPack?.previewCommand}.`
    );
    const installScript = await readFile(join(dir, "install.sh"), "utf8");
    assert(installScript.includes("Checksum mismatch"), "Release install script should verify checksums before installing.");
    assert(installScript.includes("npm install -g"), "Release install script should install the npm tarball.");
    run("sh", ["-n", join(dir, "install.sh")], "Release install script syntax");
    checks.push("Release artifact contents");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runReleaseWorkflowSmoke() {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  assert(workflow.includes("Resolve release tag"), "Release workflow should resolve one release tag for tag pushes and manual dispatch.");
  assert(workflow.includes("tag=${{ inputs.version }}"), "Release workflow should use the manual dispatch version as the release tag.");
  assert(workflow.includes("tag=${GITHUB_REF_NAME}"), "Release workflow should use the pushed tag name as the release tag.");
  assert(workflow.includes('--release-tag "${{ steps.release.outputs.tag }}"'), "Release workflow should stamp artifacts with the resolved release tag.");
  assert(
    workflow.includes("startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'"),
    "Release workflow should attach artifacts for both tag pushes and manual dispatch."
  );
  assert(workflow.includes("release-artifacts/*.tgz"), "Release workflow should upload top-level release tarballs.");
  assert(workflow.includes("release-artifacts/npm/*.tgz"), "Release workflow should upload the npm package tarball.");
  assert(workflow.includes("release-artifacts/registry.bundle.json"), "Release workflow should upload the registry bundle.");
  assert(workflow.includes("npm publish --provenance"), "Release workflow should publish the npm package with provenance.");
  checks.push("Release workflow upload coverage");
}

async function runRegistrySignatureSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-signature-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPath = join(dir, "registry-private.pem");
    const publicKeyPath = join(dir, "registry-public.pem");
    const bundlePath = join(dir, "registry.bundle.json");
    await writeFile(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    await writeFile(publicKeyPath, publicKey.export({ format: "pem", type: "spki" }).toString(), "utf8");

    run(
      "node",
      [
        "dist/index.js",
        "registry",
        "export",
        "--out",
        bundlePath,
        "--private-key",
        privateKeyPath,
        "--key-id",
        "release-test"
      ],
      "Signed registry export"
    );
    const verified = runJson(
      "node",
      [
        "dist/index.js",
        "registry",
        "verify",
        "--registry",
        bundlePath,
        "--public-key",
        publicKeyPath,
        "--key-id",
        "release-test",
        "--json"
      ],
      "Signed registry verify"
    );
    assert(verified.ok === true, "Signed registry verification failed.");
    assert(verified.signatures?.verified?.ok === true, "Expected signed registry verification result to be ok.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runJson(command, args, label) {
  const result = run(command, args, label);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} did not return valid JSON: ${message}`);
  }
}

function runJsonAllowFailure(command, args, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  try {
    checks.push(label);
    return {
      status: result.status,
      json: JSON.parse(result.stdout)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} did not return valid JSON: ${message}`);
  }
}

function hasAction(summaries, action) {
  return summaries?.some((summary) => summary.changes?.some((change) => change.action === action)) ?? false;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyTarball(packOutput) {
  const [tarball] = packOutput;
  if (!tarball?.files) {
    throw new Error("npm pack --json output did not include file metadata.");
  }
  const files = new Set(tarball.files.map((file) => file.path));
  const required = [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "LICENSE",
    "dist/index.js",
    "dist/compatibility.js",
    "dist/constants.js",
    "dist/catalog.js",
    "dist/audit.js",
    "dist/doctor.js",
    "dist/drift.js",
    "dist/resolve.js",
    "dist/policy.js",
    "dist/pack.js",
    "dist/prompt-quality.js",
    "dist/version.js",
    "registry/agents/code-reviewer.json",
    "registry/changelog.json",
    "registry/packs/starter-dev-pack.json",
    "docs/agent-native.md",
    "docs/contributing-agents.md",
    "docs/policy.md",
    "integrations/codex-skill/SKILL.md"
  ];
  const missing = required.filter((file) => !files.has(file));
  if (missing.length > 0) {
    throw new Error(`Package dry run is missing required files: ${missing.join(", ")}`);
  }
  checks.push("Package contents");
}

function parseNpmPackJson(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("npm pack --json output did not contain a JSON array.");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nRelease check failed: ${message}`);
  process.exitCode = 1;
});
