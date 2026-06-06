import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
  await runImportJsonSmoke();
  await runCiWorkflowSmoke();
  await runRepositoryAutomationSmoke();
  await runSecurityWorkflowSmoke();
  await runCodeownersSmoke();
  await runContributionTemplatesSmoke();
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
    const catalogHtml = await readFile(join(siteDir, "index.html"), "utf8");
    assert(
      catalogHtml.includes('const itemTargets = item.dataset.targets || "";'),
      "Catalog target filter should tolerate searchable entries without target metadata."
    );
    assert(
      catalogHtml.includes('document.execCommand("copy")') && catalogHtml.includes("Copy failed"),
      "Catalog copy controls should include a clipboard fallback for non-secure contexts or denied permissions."
    );
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }

  await runLifecycleSmoke();

  const pack = run("npm", ["pack", "--dry-run", "--json"], "Package dry run");
  verifyTarball(parseNpmPackJson(pack.stdout));
  await runPackageInstallSmoke();

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
      init.nextCommands?.includes("agents-market registry verify-lock --json"),
      "Lifecycle init should verify the registry lock before follow-up commands."
    );
    assert(
      init.nextCommands?.includes("agents-market apply starter-dev-pack --target claude --policy-preset balanced --json"),
      `Lifecycle init should preview with apply, found: ${JSON.stringify(init.nextCommands)}.`
    );
    assert(
      init.nextCommands?.includes("agents-market apply starter-dev-pack --target claude --policy-preset balanced --yes"),
      `Lifecycle init should install with apply --yes, found: ${JSON.stringify(init.nextCommands)}.`
    );
    assert(
      init.nextCommands?.includes("agents-market doctor --strict --json"),
      `Lifecycle init should verify with strict doctor, found: ${JSON.stringify(init.nextCommands)}.`
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

    const rollbackRegistryDir = join(projectDir, "rollback-registry");
    await cp("registry", rollbackRegistryDir, { recursive: true });
    const rollbackAgentPath = join(rollbackRegistryDir, "agents", "code-reviewer.json");
    const rollbackAgent = JSON.parse(await readFile(rollbackAgentPath, "utf8"));
    rollbackAgent.prompt = `${rollbackAgent.prompt}\nRollback smoke marker.`;
    await writeFile(rollbackAgentPath, `${JSON.stringify(rollbackAgent, null, 2)}\n`, "utf8");
    const rollbackPackPath = join(rollbackRegistryDir, "packs", "starter-dev-pack.json");
    const rollbackPack = JSON.parse(await readFile(rollbackPackPath, "utf8"));
    rollbackPack.version = "0.1.1";
    await writeFile(rollbackPackPath, `${JSON.stringify(rollbackPack, null, 2)}\n`, "utf8");

    const strictOutdated = runJsonAllowFailure(
      "node",
      ["dist/index.js", "outdated", "--cwd", projectDir, "--registry", rollbackRegistryDir, "--fail-on-outdated", "--json"],
      "Lifecycle strict outdated check"
    );
    assert(strictOutdated.status === 1, `Expected strict outdated check to exit 1, found ${strictOutdated.status}.`);
    assert(strictOutdated.json.outdatedCount === 1, `Expected strict outdated check to find one outdated pack, found ${strictOutdated.json.outdatedCount}.`);

    const updateForRollback = runJson(
      "node",
      ["dist/index.js", "update", "starter-dev-pack", "--cwd", projectDir, "--registry", rollbackRegistryDir, "--json"],
      "Lifecycle update for rollback"
    );
    assert(updateForRollback.written >= 1, `Expected update for rollback to write files, found ${updateForRollback.written}.`);
    assert(updateForRollback.updates?.[0]?.toVersion === "0.1.1", `Expected rollback update target version 0.1.1, found ${updateForRollback.updates?.[0]?.toVersion}.`);
    const updatedCodeReviewer = await readFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "utf8");
    assert(updatedCodeReviewer.includes("Rollback smoke marker."), "Expected update for rollback to write the modified agent prompt.");

    const rollbackPreview = runJson(
      "node",
      ["dist/index.js", "rollback", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--json"],
      "Lifecycle rollback preview"
    );
    assert(rollbackPreview.dryRun === true, "Expected rollback without --yes to be a preview.");
    assert(rollbackPreview.restored >= 1, `Expected rollback preview to restore files, found ${rollbackPreview.restored}.`);
    const rollbackInstallManifest = JSON.parse(await readFile(join(projectDir, ".agents-market", "manifest.json"), "utf8"));
    assert(rollbackInstallManifest.installs?.[0]?.history?.length === 1, "Expected rollback preview to leave update history intact.");

    const rollback = runJson(
      "node",
      ["dist/index.js", "rollback", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--yes", "--json"],
      "Lifecycle rollback"
    );
    assert(rollback.dryRun === false, "Expected rollback --yes to write changes.");
    assert(rollback.restored >= 1, `Expected rollback to restore files, found ${rollback.restored}.`);
    const rolledBackCodeReviewer = await readFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "utf8");
    assert(!rolledBackCodeReviewer.includes("Rollback smoke marker."), "Expected rollback to restore the previous agent prompt.");
    const rolledBackManifest = JSON.parse(await readFile(join(projectDir, ".agents-market", "manifest.json"), "utf8"));
    assert(rolledBackManifest.installs?.[0]?.packVersion === "0.1.0", `Expected rollback to restore pack version 0.1.0, found ${rolledBackManifest.installs?.[0]?.packVersion}.`);
    assert(!rolledBackManifest.installs?.[0]?.history, "Expected rollback to consume the update history entry.");

    await appendFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "\n<!-- third local edit from release smoke -->\n", "utf8");

    const updateDryRun = runJson(
      "node",
      ["dist/index.js", "update", "starter-dev-pack", "--cwd", projectDir, "--dry-run", "--json"],
      "Lifecycle update dry run"
    );
    assert(updateDryRun.skipped === 1, `Expected update dry run to skip one modified file, found ${updateDryRun.skipped}.`);
    assert(hasAction(updateDryRun.updates, "skip-modified"), "Expected update dry run to report a skip-modified action.");

    const strictUpdateDryRun = runJsonAllowFailure(
      "node",
      ["dist/index.js", "update", "starter-dev-pack", "--cwd", projectDir, "--dry-run", "--fail-on-skipped", "--json"],
      "Lifecycle strict update dry run"
    );
    assert(strictUpdateDryRun.status === 1, `Expected strict update dry run to exit 1, found ${strictUpdateDryRun.status}.`);
    assert(strictUpdateDryRun.json.blockedCount === 1, `Expected strict update dry run to report one blocked change, found ${strictUpdateDryRun.json.blockedCount}.`);

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
    assert(markdown.includes("| Checksummed | Committed |"), "Expected registry submission Markdown to include provenance commit coverage.");
    assert(markdown.includes("security-pack"), "Expected registry submission Markdown to include security-pack.");
    checks.push("Registry submission summary");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runImportJsonSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-import-"));
  try {
    const sourceDir = join(dir, "community-agents");
    const agentsDir = join(dir, "registry", "agents");
    const packsDir = join(dir, "registry", "packs");
    await mkdir(join(sourceDir, "nested"), { recursive: true });
    await writeFile(
      join(sourceDir, "reviewer.md"),
      `---
name: imported-reviewer
description: Reviews code for regressions, maintainability, test gaps, and security issues.
tools: Read, Grep
---

You are an imported code reviewer. Inspect the relevant files before making claims, prioritize regressions and missing tests, and return concise findings with file references.
`,
      "utf8"
    );
    await writeFile(
      join(sourceDir, "nested", "debugger.md"),
      `---
name: imported-debugger
description: Investigates failing tests, runtime errors, logs, and stack traces.
tools: Read, Grep, Bash
---

You are an imported debugger. Inspect failing tests, logs, stack traces, and related source files, then identify the smallest credible root cause with verification steps.
`,
      "utf8"
    );

    const report = runJson(
      "node",
      [
        "dist/index.js",
        "import",
        "directory",
        sourceDir,
        "--target",
        "claude",
        "--out",
        agentsDir,
        "--pack",
        "community-pack",
        "--pack-out",
        packsDir,
        "--source-repo",
        "example/community-agents",
        "--source-license",
        "MIT",
        "--json"
      ],
      "Import directory JSON"
    );
    assert(report.importedCount === 2, `Expected import JSON to report two imported agents, found ${report.importedCount}.`);
    assert(report.skippedCount === 0, `Expected import JSON to report zero skipped files, found ${report.skippedCount}.`);
    assert(report.pack?.id === "community-pack", `Expected import JSON pack community-pack, found ${report.pack?.id}.`);
    assert(
      report.imported?.every((agent) => agent.provenance?.sourceSha256?.length === 64),
      "Expected import JSON summaries to include source SHA-256 provenance."
    );
    assert(
      !JSON.stringify(report.imported).includes("You are an imported"),
      "Import JSON summaries should not include full prompt bodies."
    );
    const lint = runJson("node", ["dist/index.js", "registry", "lint", "--registry", join(dir, "registry"), "--json"], "Imported registry lint");
    assert(lint.errorCount === 0, "Expected imported registry lint to avoid errors.");
    checks.push("Import JSON smoke assertions");
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
    assert(workflow.includes("npx --yes @agents-market/cli@0.1.0 registry verify-lock --json"), "Expected CI workflow to verify the registry lock with a pinned npm package.");
    assert(workflow.includes("npx --yes @agents-market/cli@0.1.0 status --diff --json"), "Expected CI workflow to check generated agent drift with a pinned npm package.");
    assert(workflow.includes("npx --yes @agents-market/cli@0.1.0 outdated --fail-on-outdated --json"), "Expected CI workflow to fail on outdated installed pack versions.");
    assert(workflow.includes("npx --yes @agents-market/cli@0.1.0 update --dry-run --fail-on-skipped --json"), "Expected CI workflow to fail on blocked update previews.");
    assert(workflow.includes("npx --yes @agents-market/cli@0.1.0 doctor --strict --json"), "Expected CI workflow to run strict doctor with a pinned npm package.");
    assert(workflow.includes("group: agents-market-${{ github.ref }}"), "Expected CI workflow to cancel superseded runs by ref.");
    assert(workflow.includes("cancel-in-progress: true"), "Expected CI workflow to cancel superseded runs.");
    assert(workflow.includes("timeout-minutes: 10"), "Expected CI workflow to define a job timeout.");
    assert(workflow.includes("persist-credentials: false"), "Expected CI workflow to avoid persisting checkout credentials.");
    checks.push("CI workflow contents");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runRepositoryAutomationSmoke() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert(packageJson.files?.includes("CHANGELOG.md"), "npm package files should include CHANGELOG.md.");
  assert(packageJson.files?.includes("PRIVACY.md"), "npm package files should include PRIVACY.md.");
  assert(packageJson.files?.includes("SUPPORT.md"), "npm package files should include SUPPORT.md.");

  const changelog = await readFile("CHANGELOG.md", "utf8");
  for (const required of ["## 0.1.0 - Preview", "preview-0.1.0", "Signed registry bundles", "GitHub Artifact Attestations"]) {
    assert(changelog.includes(required), `Package changelog is missing ${required}.`);
  }

  const privacy = await readFile("PRIVACY.md", "utf8");
  for (const required of ["does not include telemetry", "Network Access", "catalog verify --url", "GitHub repository imports", "SECURITY.md"]) {
    assert(privacy.includes(required), `Privacy documentation is missing ${required}.`);
  }

  const support = await readFile("SUPPORT.md", "utf8");
  for (const required of ["Agent And Pack Proposals", "Bug", "Security Reports", "Privacy", "Release And npm Issues"]) {
    assert(support.includes(required), `Support documentation is missing ${required}.`);
  }

  const readme = await readFile("README.md", "utf8");
  assert(readme.includes("no telemetry or analytics"), "README should mention the no-telemetry privacy posture.");
  assert(readme.includes("CHANGELOG.md"), "README should link to CHANGELOG.md.");
  assert(readme.includes("PRIVACY.md"), "README should link to PRIVACY.md.");
  assert(readme.includes("SUPPORT.md"), "README should link to SUPPORT.md.");

  const security = await readFile("SECURITY.md", "utf8");
  assert(security.includes("PRIVACY.md"), "SECURITY.md should link to PRIVACY.md.");
  assert(security.includes("SUPPORT.md"), "SECURITY.md should link to SUPPORT.md.");

  const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert(ciWorkflow.includes("permissions:\n  contents: read"), "CI workflow should declare read-only contents permission.");
  assert(ciWorkflow.includes("group: ci-${{ github.ref }}"), "CI workflow should cancel superseded runs by ref.");
  assert(ciWorkflow.includes("cancel-in-progress: true"), "CI workflow should cancel superseded runs.");
  assert(ciWorkflow.includes("timeout-minutes: 20"), "CI workflow should define a job timeout.");
  assert(ciWorkflow.includes("persist-credentials: false"), "CI workflow should avoid persisting checkout credentials.");

  const registryReviewWorkflow = await readFile(".github/workflows/registry-review.yml", "utf8");
  assert(registryReviewWorkflow.includes("contents: read"), "Registry Review workflow should keep read-only contents permission.");
  assert(registryReviewWorkflow.includes("pull-requests: write"), "Registry Review workflow should be allowed to update PR comments.");
  assert(registryReviewWorkflow.includes("group: registry-review-${{ github.ref }}"), "Registry Review workflow should cancel superseded runs by ref.");
  assert(registryReviewWorkflow.includes("cancel-in-progress: true"), "Registry Review workflow should cancel superseded runs.");
  assert(registryReviewWorkflow.includes("timeout-minutes: 20"), "Registry Review workflow should define a job timeout.");
  assert(registryReviewWorkflow.includes("persist-credentials: false"), "Registry Review workflow should avoid persisting checkout credentials.");

  const dependabot = await readFile(".github/dependabot.yml", "utf8");
  assert(dependabot.includes("package-ecosystem: npm"), "Dependabot should monitor npm dependencies.");
  assert(dependabot.includes("package-ecosystem: github-actions"), "Dependabot should monitor GitHub Actions.");
  assert(dependabot.includes("interval: weekly"), "Dependabot should run on a weekly schedule.");
  assert(dependabot.includes("npm-minor-patch"), "Dependabot should group npm minor and patch updates.");
  assert(dependabot.includes("github-actions-minor-patch"), "Dependabot should group GitHub Actions minor and patch updates.");
  checks.push("Repository automation config");
}

async function runSecurityWorkflowSmoke() {
  const workflow = await readFile(".github/workflows/security.yml", "utf8");
  assert(workflow.includes("github/codeql-action/init@v4"), "Security workflow should initialize CodeQL with the current major action.");
  assert(workflow.includes("github/codeql-action/analyze@v4"), "Security workflow should analyze CodeQL results with the current major action.");
  assert(workflow.includes("actions/dependency-review-action@v5"), "Security workflow should run the current major dependency review action.");
  assert(workflow.includes("ossf/scorecard-action@v2"), "Security workflow should run OpenSSF Scorecard.");
  assert(workflow.includes("github/codeql-action/upload-sarif@v4"), "Security workflow should upload Scorecard SARIF results.");
  assert(workflow.includes("languages: javascript-typescript"), "Security workflow should scan JavaScript and TypeScript.");
  assert(workflow.includes("security-events: write"), "Security workflow should be allowed to upload CodeQL results.");
  assert(workflow.includes("id-token: write"), "Security workflow should allow Scorecard result publishing through OIDC.");
  assert(workflow.includes("pull-requests: read"), "Security workflow should be allowed to inspect pull request dependency changes.");
  assert(workflow.includes("group: security-${{ github.ref }}"), "Security workflow should cancel superseded runs by ref.");
  assert(workflow.includes("cancel-in-progress: true"), "Security workflow should cancel superseded runs.");
  assert(workflow.includes("fail-on-severity: high"), "Dependency review should fail high-severity dependency changes.");
  assert(workflow.includes("publish_results: true"), "Security workflow should publish OpenSSF Scorecard results.");
  assert(workflow.includes("timeout-minutes: 15"), "Security workflow should define timeouts for long-running scan jobs.");
  assert(workflow.includes("timeout-minutes: 10"), "Security workflow should define a timeout for dependency review.");
  assert(workflow.includes("persist-credentials: false"), "Security workflow should avoid persisting checkout credentials.");
  assert(workflow.includes("cron:"), "Security workflow should run on a schedule.");
  assert(workflow.includes("workflow_dispatch:"), "Security workflow should support manual runs.");
  checks.push("Security workflow config");
}

async function runCodeownersSmoke() {
  const codeowners = await readFile(".github/CODEOWNERS", "utf8");
  for (const required of [
    "* @tt-a1i",
    "/registry/ @tt-a1i",
    "/.github/workflows/ @tt-a1i",
    "/scripts/build-release-artifacts.mjs @tt-a1i",
    "/scripts/release-check.mjs @tt-a1i",
    "/scripts/verify-release-artifacts.mjs @tt-a1i",
    "/package.json @tt-a1i",
    "/SECURITY.md @tt-a1i"
  ]) {
    assert(codeowners.includes(required), `CODEOWNERS is missing ${required}.`);
  }
  checks.push("CODEOWNERS coverage");
}

async function runContributionTemplatesSmoke() {
  const submission = await readFile(".github/ISSUE_TEMPLATE/agent_pack_submission.yml", "utf8");
  for (const required of [
    "id: contribution_type",
    "New native agent",
    "Imported third-party agent",
    "id: target_tools",
    "Claude Code",
    "Codex",
    "OpenCode",
    "id: source",
    "id: license",
    "id: permissions",
    "id: risk_review",
    "id: validation",
    "docs/contributing-agents.md"
  ]) {
    assert(submission.includes(required), `Agent submission template is missing ${required}.`);
  }

  const bugReport = await readFile(".github/ISSUE_TEMPLATE/bug_report.yml", "utf8");
  for (const required of ["SECURITY.md", "id: reproduce", "id: expected", "id: version"]) {
    assert(bugReport.includes(required), `Bug report template is missing ${required}.`);
  }

  const issueConfig = await readFile(".github/ISSUE_TEMPLATE/config.yml", "utf8");
  assert(issueConfig.includes("security/advisories/new"), "Issue template config should route security reports to private advisories.");

  const pullRequestTemplate = await readFile(".github/pull_request_template.md", "utf8");
  for (const required of [
    "Source/provenance",
    "Source license",
    "Target support",
    "Permission/tool changes",
    "Safety and policy notes",
    "registry review --registry ./registry",
    "Imported GitHub agents include source commit and source checksum provenance",
    "Registry Review workflow summary or PR comment matches the evidence above"
  ]) {
    assert(pullRequestTemplate.includes(required), `Pull request template is missing ${required}.`);
  }
  checks.push("Contribution templates");
}

async function runReleaseArtifactsSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-artifacts-"));
  const signedDir = await mkdtemp(join(tmpdir(), "agents-market-release-artifacts-signed-"));
  const keyDir = await mkdtemp(join(tmpdir(), "agents-market-release-keys-"));
  try {
    const packageVersion = JSON.parse(await readFile("package.json", "utf8")).version;
    run(
      "node",
      [
        "scripts/build-release-artifacts.mjs",
        "--out",
        dir,
        "--catalog-base-url",
        "https://example.com/agents-market",
        "--release-tag",
        "preview-0.1.0",
        "--package",
        "github:tt-a1i/agents-market#preview-0.1.0"
      ],
      "Release artifact build"
    );
    const artifactVerification = runJson("node", ["scripts/verify-release-artifacts.mjs", "--dir", dir, "--json"], "Release artifact verification");
    assert(artifactVerification.ok === true, "Release artifact verifier failed.");
    assert(artifactVerification.sbom?.format === "SPDX-2.3", "Release artifact verifier did not validate the SPDX SBOM.");
    const manifest = JSON.parse(await readFile(join(dir, "release-artifacts.json"), "utf8"));
    assert(
      manifest.packageSpec === "github:tt-a1i/agents-market#preview-0.1.0",
      `Expected release artifact packageSpec github:tt-a1i/agents-market#preview-0.1.0, found ${manifest.packageSpec}.`
    );
    assert(manifest.repositoryUrl === "https://github.com/tt-a1i/agents-market", `Expected release artifact repository URL, found ${manifest.repositoryUrl}.`);
    assert(manifest.releaseUrl?.endsWith(`/releases/tag/${manifest.releaseTag}`), `Expected release artifact release URL to match release tag, found ${manifest.releaseUrl}.`);
    const artifactPaths = new Set(manifest.artifacts?.map((artifact) => artifact.path));
    const completeArchiveName = `agents-market-release-artifacts-${packageVersion}.tgz`;
    assert(!artifactPaths.has(completeArchiveName), "Complete release artifact archive should not be listed inside its own manifest.");
    for (const required of [
      "registry.bundle.json",
      "catalog/index.html",
      "catalog/catalog.json",
      "catalog/favicon.svg",
      "catalog/registry.bundle.json",
      "catalog/robots.txt",
      "catalog/site.webmanifest",
      "sbom.spdx.json",
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
    assert(!checksums.includes(completeArchiveName), "Complete release artifact archive should not be listed inside its own SHA256SUMS.");
    const completeArchiveListing = run("tar", ["-tzf", join(dir, completeArchiveName)], "Complete release artifact archive listing").stdout;
    for (const required of [
      "release-artifacts.json",
      "SHA256SUMS",
      "catalog/index.html",
      "catalog/site.webmanifest",
      `npm/agents-market-cli-${packageVersion}.tgz`
    ]) {
      assert(completeArchiveListing.includes(required), `Complete release artifact archive is missing ${required}.`);
    }
    const completeArchiveVerification = runJson(
      "node",
      ["scripts/verify-release-artifacts.mjs", "--archive", join(dir, completeArchiveName), "--json"],
      "Complete release artifact archive verification"
    );
    assert(completeArchiveVerification.ok === true, "Complete release artifact archive verifier failed.");
    const cliArchiveVerification = runJson(
      "node",
      ["dist/index.js", "release", "verify-artifacts", "--archive", join(dir, completeArchiveName), "--json"],
      "CLI complete release artifact archive verification"
    );
    assert(cliArchiveVerification.ok === true, "CLI complete release artifact archive verifier failed.");
    assert(cliArchiveVerification.version === packageVersion, "CLI release artifact verifier should report the package version.");
    const catalog = JSON.parse(await readFile(join(dir, "catalog", "catalog.json"), "utf8"));
    const bundle = JSON.parse(await readFile(join(dir, "registry.bundle.json"), "utf8"));
    const starterPack = catalog.packs?.find((pack) => pack.id === "starter-dev-pack");
    assert(
      catalog.packageSpec === "github:tt-a1i/agents-market#preview-0.1.0",
      `Expected release catalog packageSpec github:tt-a1i/agents-market#preview-0.1.0, found ${catalog.packageSpec}.`
    );
    assert(catalog.metadata?.repository === "https://github.com/tt-a1i/agents-market", `Expected release catalog repository metadata, found ${catalog.metadata?.repository}.`);
    assert(bundle.metadata?.repository === "https://github.com/tt-a1i/agents-market", `Expected release bundle repository metadata, found ${bundle.metadata?.repository}.`);
    assert(bundle.metadata?.packageSpec === "github:tt-a1i/agents-market#preview-0.1.0", `Expected release bundle packageSpec metadata, found ${bundle.metadata?.packageSpec}.`);
    assert(
      starterPack?.previewCommand?.startsWith("npx github:tt-a1i/agents-market#preview-0.1.0 apply starter-dev-pack"),
      `Expected release catalog preview command to use tag-pinned GitHub npx package spec, found ${starterPack?.previewCommand}.`
    );
    const installScript = await readFile(join(dir, "install.sh"), "utf8");
    assert(installScript.includes("Checksum mismatch"), "Release install script should verify checksums before installing.");
    assert(installScript.includes("Install requires curl."), "Release install script should check for curl before downloading assets.");
    assert(installScript.includes("Install requires npm."), "Release install script should check for npm before installing assets.");
    assert(
      installScript.includes("Install requires sha256sum or shasum."),
      "Release install script should check for a SHA-256 checksum command."
    );
    assert(installScript.includes("AGENTS_MARKET_REQUIRE_ATTESTATION"), "Release install script should support required GitHub attestation verification.");
    assert(installScript.includes("gh attestation verify \"${TMP_DIR}/SHA256SUMS\" --repo \"${REPO}\""), "Release install script should verify SHA256SUMS attestations.");
    assert(installScript.includes("gh attestation verify \"${TMP_DIR}/${TARBALL}\" --repo \"${REPO}\""), "Release install script should verify npm tarball attestations.");
    assert(
      installScript.indexOf("Install requires curl.") < installScript.indexOf("curl -fsSL"),
      "Release install script should check for curl before the first download."
    );
    assert(
      installScript.indexOf("gh attestation verify") < installScript.indexOf("EXPECTED_SHA="),
      "Release install script should verify attestations before trusting SHA256SUMS."
    );
    assert(
      installScript.indexOf("Install requires npm.") < installScript.indexOf("npm install -g"),
      "Release install script should check for npm before installing the tarball."
    );
    assert(installScript.includes("npm install -g --ignore-scripts"), "Release install script should install the npm tarball without running npm lifecycle scripts.");
    const sbom = JSON.parse(await readFile(join(dir, "sbom.spdx.json"), "utf8"));
    assert(sbom.spdxVersion === "SPDX-2.3", `Expected SPDX 2.3 SBOM, found ${sbom.spdxVersion}.`);
    assert(sbom.name === `@agents-market/cli@${packageVersion}`, `Expected SBOM package name @agents-market/cli@${packageVersion}, found ${sbom.name}.`);
    assert(sbom.packages?.length >= 1, "Expected SBOM to include package records.");
    assert(artifactPaths.has("sbom.spdx.json"), "Release artifacts are missing sbom.spdx.json.");
    assert(checksums.includes("sbom.spdx.json"), "Release artifact checksums do not include sbom.spdx.json.");
    run("sh", ["-n", join(dir, "install.sh")], "Release install script syntax");
    checks.push("Release artifact contents");

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPath = join(keyDir, "registry-private.pem");
    const publicKeyPath = join(keyDir, "registry-public-source.pem");
    await writeFile(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    await writeFile(publicKeyPath, publicKey.export({ format: "pem", type: "spki" }).toString(), "utf8");
    run(
      "node",
      [
        "scripts/build-release-artifacts.mjs",
        "--out",
        signedDir,
        "--catalog-base-url",
        "https://example.com/agents-market",
        "--private-key",
        privateKeyPath,
        "--public-key",
        publicKeyPath,
        "--key-id",
        "release-artifact-test"
      ],
      "Signed release artifact build"
    );
    const signedArtifactVerification = runJson(
      "node",
      ["scripts/verify-release-artifacts.mjs", "--dir", signedDir, "--json"],
      "Signed release artifact verification"
    );
    assert(signedArtifactVerification.ok === true, "Signed release artifact verifier failed.");
    assert(
      signedArtifactVerification.signatures?.registry?.ok === true &&
        signedArtifactVerification.signatures?.registry?.keyId === "release-artifact-test",
      "Signed release artifact verifier should verify the root registry bundle signature."
    );
    assert(
      signedArtifactVerification.signatures?.catalog?.ok === true &&
        signedArtifactVerification.signatures?.catalog?.keyId === "release-artifact-test",
      "Signed release artifact verifier should verify the catalog registry bundle signature."
    );
    const signedManifest = JSON.parse(await readFile(join(signedDir, "release-artifacts.json"), "utf8"));
    const signedArtifactPaths = new Set(signedManifest.artifacts?.map((artifact) => artifact.path));
    assert(signedArtifactPaths.has("registry-public.pem"), "Signed release artifacts should include registry-public.pem.");
    assert(signedArtifactPaths.has("catalog/registry-public.pem"), "Signed release catalog should include catalog/registry-public.pem.");
    const signedBundle = JSON.parse(await readFile(join(signedDir, "registry.bundle.json"), "utf8"));
    assert(signedBundle.signatures?.some((signature) => signature.keyId === "release-artifact-test"), "Signed release bundle is missing the expected key id.");
    const signedCatalogBundle = JSON.parse(await readFile(join(signedDir, "catalog", "registry.bundle.json"), "utf8"));
    const signedCatalog = JSON.parse(await readFile(join(signedDir, "catalog", "catalog.json"), "utf8"));
    assert(
      signedCatalogBundle.signatures?.some((signature) => signature.keyId === "release-artifact-test"),
      "Signed release catalog bundle is missing the expected key id."
    );
    assert(
      signedCatalog.registryWorkflows?.some((workflow) =>
        workflow.command?.includes("--public-key https://example.com/agents-market/registry-public.pem --key-id release-artifact-test")
      ),
      "Signed release catalog should include a hosted registry signature verification command."
    );
    assert(
      signedCatalog.registryWorkflows?.some((workflow) =>
        workflow.command?.includes("registry lock --registry https://example.com/agents-market/registry.bundle.json --public-key https://example.com/agents-market/registry-public.pem --key-id release-artifact-test")
      ),
      "Signed release catalog should include a signature-aware registry lock command."
    );
    const signedVerification = runJson(
      "node",
      [
        "dist/index.js",
        "registry",
        "verify",
        "--registry",
        join(signedDir, "registry.bundle.json"),
        "--public-key",
        join(signedDir, "registry-public.pem"),
        "--key-id",
        "release-artifact-test",
        "--json"
      ],
      "Signed release artifact verify"
    );
    assert(signedVerification.ok === true, "Signed release artifact verification failed.");
    assert(signedVerification.signatures?.verified?.ok === true, "Signed release artifact signature should verify.");
    const signedCatalogVerification = runJson(
      "node",
      [
        "dist/index.js",
        "registry",
        "verify",
        "--registry",
        join(signedDir, "catalog", "registry.bundle.json"),
        "--public-key",
        join(signedDir, "catalog", "registry-public.pem"),
        "--key-id",
        "release-artifact-test",
        "--json"
      ],
      "Signed release catalog verify"
    );
    assert(signedCatalogVerification.ok === true, "Signed release catalog verification failed.");
    assert(signedCatalogVerification.signatures?.verified?.ok === true, "Signed release catalog signature should verify.");
    await withStaticServer(join(signedDir, "catalog"), async (catalogBaseUrl) => {
      const hostedCatalogVerification = runJson(
        "node",
        ["dist/index.js", "catalog", "verify", "--url", `${catalogBaseUrl}/catalog.json`, "--json"],
        "Hosted signed catalog verify"
      );
      assert(hostedCatalogVerification.ok === true, "Hosted signed catalog verification failed.");
      assert(hostedCatalogVerification.source?.kind === "url", "Hosted signed catalog verification should report a URL source.");
      assert(hostedCatalogVerification.signatures?.registry?.ok === true, "Hosted signed catalog registry signature should verify.");
    });
    await withStaticServer(signedDir, async (baseUrl) => {
      const remoteKeyVerification = runJson(
        "node",
        [
          "dist/index.js",
          "registry",
          "verify",
          "--registry",
          join(signedDir, "registry.bundle.json"),
          "--public-key",
          `${baseUrl}/registry-public.pem`,
          "--key-id",
          "release-artifact-test",
          "--json"
        ],
        "Signed release artifact verify with public key URL"
      );
      assert(remoteKeyVerification.ok === true, "Signed release artifact verification with public key URL failed.");
      assert(remoteKeyVerification.signatures?.verified?.ok === true, "Signed release artifact URL signature should verify.");
      const signedLockProject = join(signedDir, "signed-lock-project");
      await mkdir(signedLockProject, { recursive: true });
      run(
        "node",
        [
          "dist/index.js",
          "registry",
          "lock",
          "--cwd",
          signedLockProject,
          "--registry",
          join(signedDir, "registry.bundle.json"),
          "--public-key",
          `${baseUrl}/registry-public.pem`,
          "--key-id",
          "release-artifact-test"
        ],
        "Signed registry lock with public key URL"
      );
      const signedLock = runJson(
        "node",
        ["dist/index.js", "registry", "verify-lock", "--cwd", signedLockProject, "--json"],
        "Signed registry verify lock"
      );
      assert(signedLock.ok === true, "Signed registry lock verification failed.");
      assert(signedLock.lock?.signature?.publicKey === `${baseUrl}/registry-public.pem`, "Signed registry lock should record the public key URL.");
      assert(signedLock.lock?.signature?.keyId === "release-artifact-test", "Signed registry lock should record the key id.");
    });
    checks.push("Signed release artifact contents");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(signedDir, { recursive: true, force: true });
    await rm(keyDir, { recursive: true, force: true });
  }
}

async function runReleaseWorkflowSmoke() {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  const pagesWorkflow = await readFile(".github/workflows/pages.yml", "utf8");
  assert(workflow.includes("Resolve release tag"), "Release workflow should resolve one release tag for tag pushes and manual dispatch.");
  assert(workflow.includes('- "preview-*"'), "Release workflow should run for preview tags.");
  assert(workflow.includes("tag=${{ inputs.version }}"), "Release workflow should use the manual dispatch version as the release tag.");
  assert(workflow.includes("tag=${GITHUB_REF_NAME}"), "Release workflow should use the pushed tag name as the release tag.");
  assert(workflow.includes('expected_preview="preview-${package_version}"'), "Release workflow should allow manual preview versions that match package.json.");
  assert(workflow.includes('!= "$expected_release"') && workflow.includes('!= "$expected_preview"'), "Release workflow should reject manual versions unless they match the release or preview tag.");
  assert(workflow.includes('--release-tag "${{ steps.release.outputs.tag }}"'), "Release workflow should stamp artifacts with the resolved release tag.");
  assert(workflow.includes('case "${{ steps.release.outputs.tag }}" in'), "Release workflow should select the release package spec by tag type.");
  assert(workflow.includes('package_spec="github:tt-a1i/agents-market#${{ steps.release.outputs.tag }}"'), "Release workflow should use the tag-pinned GitHub package spec for preview artifacts.");
  assert(workflow.includes('--package "${package_spec}"'), "Release workflow should build artifacts with the selected package spec.");
  assert(
    pagesWorkflow.includes('--package "github:tt-a1i/agents-market#preview-0.1.0"'),
    "Pages workflow should use a tag-pinned GitHub package spec before npm publication."
  );
  assert(workflow.includes("concurrency:"), "Release workflow should serialize release runs.");
  assert(workflow.includes("group: release-${{ github.ref_name || inputs.version }}"), "Release workflow should serialize by release ref or manual version.");
  assert(workflow.includes("cancel-in-progress: false"), "Release workflow should not cancel an in-progress publish.");
  assert(workflow.includes("timeout-minutes: 30"), "Release artifact job should define a timeout.");
  assert(workflow.includes("timeout-minutes: 10"), "Release publish job should define a timeout.");
  assert(workflow.includes("release-artifacts:"), "Release workflow should build and upload artifacts in a dedicated job.");
  assert(workflow.includes("publish-npm:"), "Release workflow should publish npm from a dedicated protected job.");
  assert(workflow.includes("needs: release-artifacts"), "NPM publishing should wait for release artifact verification and upload.");
  assert(workflow.includes("environment: npm-release"), "Release workflow should use the protected npm-release environment for npm publishing.");
  assert(
    workflow.indexOf("release-artifacts:") < workflow.indexOf("publish-npm:") &&
      workflow.indexOf("publish-npm:") < workflow.indexOf("environment: npm-release"),
    "Release workflow should keep preview artifact publishing outside the npm-release environment."
  );
  assert(workflow.includes("persist-credentials: false"), "Release workflow checkout should not persist GitHub credentials.");
  assert(pagesWorkflow.includes("timeout-minutes: 20"), "Pages build job should define a timeout.");
  assert(pagesWorkflow.includes("timeout-minutes: 10"), "Pages deploy job should define a timeout.");
  assert(pagesWorkflow.includes("persist-credentials: false"), "Pages workflow checkout should not persist GitHub credentials.");
  assert(pagesWorkflow.includes("if: github.ref == 'refs/heads/main'"), "Pages workflow should deploy only from main while allowing branch build verification.");
  assert(
    workflow.includes("startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'"),
    "Release workflow should attach artifacts for both tag pushes and manual dispatch."
  );
  assert(workflow.includes("Built from ${GITHUB_SHA}."), "Release workflow should stamp GitHub Release notes with the source commit.");
  assert(workflow.includes("gh release edit"), "Release workflow should update existing GitHub Release metadata on refresh.");
  assert(workflow.includes('--target "${GITHUB_SHA}"'), "Release workflow should align GitHub Release metadata with the source commit.");
  assert(workflow.includes("preview-*) release_flags+=(--prerelease)"), "Release workflow should mark preview releases as prereleases.");
  assert(workflow.includes("npm run release:verify-artifacts -- --dir ./release-artifacts"), "Release workflow should verify generated artifacts before upload or publish.");
  assert(workflow.includes("attestations: write"), "Release workflow should be allowed to write artifact attestations.");
  assert(workflow.includes("actions/attest@v4"), "Release workflow should create GitHub Artifact Attestations.");
  assert(workflow.includes("subject-checksums: ./release-artifacts/SHA256SUMS"), "Release workflow should attest the generated SHA256SUMS subjects.");
  assert(workflow.includes("Attest complete release artifact archive"), "Release workflow should separately attest the complete artifact archive.");
  assert(
    workflow.includes("subject-path: ./release-artifacts/agents-market-release-artifacts-*.tgz"),
    "Release workflow should attest the complete release artifact archive subject."
  );
  assert(
    workflow.indexOf("npm run release:verify-artifacts -- --dir ./release-artifacts") < workflow.indexOf("subject-checksums: ./release-artifacts/SHA256SUMS"),
    "Release workflow should attest artifacts after local artifact verification."
  );
  assert(
    workflow.indexOf("subject-checksums: ./release-artifacts/SHA256SUMS") <
      workflow.indexOf("subject-path: ./release-artifacts/agents-market-release-artifacts-*.tgz"),
    "Release workflow should attest the complete archive after checksum-subject attestations."
  );
  assert(workflow.includes("release-artifacts/*.tgz"), "Release workflow should upload top-level release tarballs.");
  assert(workflow.includes("release-artifacts/npm/*.tgz"), "Release workflow should upload the npm package tarball.");
  assert(workflow.includes("release-artifacts/registry.bundle.json"), "Release workflow should upload the registry bundle.");
  assert(workflow.includes("release-artifacts/sbom.spdx.json"), "Release workflow should upload the SPDX SBOM.");
  assert(workflow.includes("REGISTRY_SIGNING_PRIVATE_KEY"), "Release workflow should support the registry signing private key secret.");
  assert(workflow.includes("REGISTRY_SIGNING_PUBLIC_KEY"), "Release workflow should support the registry signing public key secret.");
  assert(workflow.includes("REGISTRY_SIGNING_KEY_ID"), "Release workflow should support the registry signing key id secret.");
  assert(workflow.includes("release-artifacts/registry-public.pem"), "Release workflow should upload the registry public key when present.");
  assert(pagesWorkflow.includes("REGISTRY_SIGNING_PRIVATE_KEY"), "Pages workflow should support the registry signing private key secret.");
  assert(pagesWorkflow.includes("REGISTRY_SIGNING_PUBLIC_KEY"), "Pages workflow should support the registry signing public key secret.");
  assert(pagesWorkflow.includes("REGISTRY_SIGNING_KEY_ID"), "Pages workflow should support the registry signing key id secret.");
  assert(pagesWorkflow.includes("--private-key registry-private.pem --public-key registry-public.pem --key-id"), "Pages workflow should sign the hosted catalog registry bundle when signing secrets are present.");
  assert(workflow.includes("npm publish --provenance"), "Release workflow should publish the npm package with provenance.");
  assert(workflow.includes("if: startsWith(needs.release-artifacts.outputs.tag, 'v')"), "Release workflow should publish to npm only for v-prefixed release tags.");
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

async function withStaticServer(rootDir, callback) {
  const server = spawn(
    "node",
    [
      "-e",
      `
const { createServer } = require("node:http");
const { createReadStream } = require("node:fs");
const { join, basename } = require("node:path");
const root = process.argv[1];
const server = createServer((request, response) => {
  const name = basename(new URL(request.url || "/", "http://127.0.0.1").pathname);
  createReadStream(join(root, name))
    .on("error", () => {
      response.statusCode = 404;
      response.end("not found");
    })
    .pipe(response);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
});
`,
      rootDir
    ],
    { stdio: ["ignore", "pipe", "inherit"] }
  );
  try {
    const port = await new Promise((resolve, reject) => {
      let output = "";
      server.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/\d+/);
        if (match) resolve(match[0]);
      });
      server.on("error", reject);
      server.on("exit", (code) => {
        if (!output) reject(new Error(`Static server exited before reporting a port: ${code ?? "unknown"}`));
      });
    });
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.kill();
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
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "PRIVACY.md",
    "SUPPORT.md",
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
    "docs/operations.md",
    "docs/policy.md",
    "integrations/codex-skill/SKILL.md"
  ];
  const missing = required.filter((file) => !files.has(file));
  if (missing.length > 0) {
    throw new Error(`Package dry run is missing required files: ${missing.join(", ")}`);
  }
  checks.push("Package contents");
}

async function runPackageInstallSmoke() {
  const packDir = await mkdtemp(join(tmpdir(), "agents-market-package-pack-"));
  const installDir = await mkdtemp(join(tmpdir(), "agents-market-package-install-"));
  try {
    const pack = run("npm", ["pack", "--pack-destination", packDir, "--json"], "Package install smoke pack");
    const [tarball] = parseNpmPackJson(pack.stdout);
    assert(tarball?.filename, "Package install smoke did not produce an npm tarball filename.");
    const tarballPath = join(packDir, tarball.filename);
    run("npm", ["install", "--prefix", installDir, tarballPath], "Package install smoke install");
    const binPath = join(installDir, "node_modules", ".bin", "agents-market");
    const version = run(binPath, ["--version"], "Package install smoke version").stdout.trim();
    assert(version === "0.1.0", `Expected installed package version 0.1.0, found ${version}.`);
    const list = runJson(binPath, ["list", "--json"], "Package install smoke list");
    assert(list.packCount >= 4, `Expected installed package to list at least four packs, found ${list.packCount}.`);
    assert(list.agentCount >= 10, `Expected installed package to list at least ten agents, found ${list.agentCount}.`);
    checks.push("Package install smoke");
  } finally {
    await rm(packDir, { recursive: true, force: true });
    await rm(installDir, { recursive: true, force: true });
  }
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
